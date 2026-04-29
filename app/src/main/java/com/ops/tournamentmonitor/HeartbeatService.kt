package com.ops.tournamentmonitor

import android.app.*
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.Context.RECEIVER_NOT_EXPORTED
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.*
import android.provider.Settings
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.TrafficStats
import android.os.Process
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.*
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.util.concurrent.ScheduledFuture

class HeartbeatService : Service() {

    companion object {
        /** Key mã hóa WebSocket — phải trùng với SECRET_KEY trên server (.env). */
        private const val WS_SECRET_KEY = "MonitorTournamentSecretKey2026!"
        private const val LOCAL_IP_CACHE_MS = 20_000L
        // Giới hạn backoff reconnect để giảm thời gian server phát hiện re-connect.
        private const val RECONNECT_MAX_SEC = 10
        private const val OFFLINE_RECORD_WINDOW_MS = 120_000L // 2 phút
    }

    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var deviceName: String = ""
    private var serverIp: String = ""
    private var serverPort: String = "3000"
    private var lastDetectedApp: String = ""
    private val logTag = "TOURNAMENT_LOG"
    
    private var isFtpOpen: Boolean = false

    private var cachedLocalIp: String = ""
    private var cachedLocalIpTimeMs: Long = 0

    @Suppress("SpellCheckingInspection")
    private val whitelistPackages = listOf(
        "com.dts.freefireth", "com.dts.freefiremax",
        "com.android.chrome", "com.ops.tournamentmonitor"
    )

    private val systemNoise = listOf(
        "com.coloros.backuprestore", "com.oppo.launcher",
        "com.android.systemui", "com.google.android.permissioncontroller"
    )

    private val deviceId: String by lazy {
        @Suppress("HardwareIds")
        Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "UnknownID"
    }

    private val scheduler = Executors.newSingleThreadScheduledExecutor()

    private var heartbeatTask: ScheduledFuture<*>? = null
    private var overlayTask: ScheduledFuture<*>? = null
    private var installedAppsTask: ScheduledFuture<*>? = null
    private var isWsConnected: Boolean = false

    // Buffer các heartbeat đã mã hóa khi WebSocket mất kết nối.
    // Khi reconnect thành công (trong vòng 2 phút) sẽ gửi lại để server có timeline đầy đủ.
    private val offlineEncryptedQueue = ArrayList<String>(128)
    private var recordingUntilMs: Long = 0L
    private var disconnectStartMs: Long = 0L
    private var disconnectIntent: String = "unknown" // ước lượng: intentional/accidental/unknown
    private var reconnectEnabled: Boolean = true
    private var hbLogCounter: Int = 0

    // Delta bytes theo UID để ước lượng lượng dữ liệu app đang dùng (WiFi vs Cellular).
    private var lastTxBytes: Long = -1L
    private var lastRxBytes: Long = -1L
    private var lastNetSampleMs: Long = 0L

    // --- Caching System Services ---
    private val activityManager by lazy { getSystemService(ActivityManager::class.java) }
    private val usageStatsManager by lazy { getSystemService(UsageStatsManager::class.java) }
    private val batteryManager by lazy { getSystemService(BatteryManager::class.java) }
    private val powerManager by lazy { getSystemService(PowerManager::class.java) }
    private val appOpsManager by lazy { getSystemService(AppOpsManager::class.java) }
    private val wifiManager by lazy { applicationContext.getSystemService(WifiManager::class.java) }

    // Dữ liệu cache để không loop mỗi nhịp
    private var cachedOverlayApp: String = ""
    private var cachedInstalledApps: List<ApplicationInfo> = emptyList()

    private val ftpReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.ops.tournamentmonitor.ACTION_TOGGLE_FTP") {
                val shouldOpen = intent.getBooleanExtra("IS_OPEN", false)
                isFtpOpen = shouldOpen
                if (shouldOpen) {
                    Log.d(logTag, "ADB File Transfer Enabled")
                } else {
                    Log.d(logTag, "ADB File Transfer Disabled")
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        serverIp = intent?.getStringExtra("IP") ?: ""
        serverPort = intent?.getStringExtra("PORT") ?: "3000"
        deviceName = intent?.getStringExtra("DEVICE_NAME") ?: "Device"
        val initialFtpOpen = intent?.getBooleanExtra("FTP_OPEN", false) ?: false

        if (serverIp.isNotEmpty()) {
            if (initialFtpOpen && !isFtpOpen) {
                isFtpOpen = true
                Log.d(logTag, "ADB File Transfer Enabled automatically on startCommand.")
            }

            startForegroundService()
            connectWebSocket()
            // Chỉ bắt đầu các job nặng (UsageStats/Overlay/App list) khi WebSocket đã connect.
            // Tránh việc server tắt vẫn tốn tài nguyên thu thập dữ liệu.
            
            val filter = IntentFilter("com.ops.tournamentmonitor.ACTION_TOGGLE_FTP")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(ftpReceiver, filter, RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(ftpReceiver, filter)
            }
        }
        return START_STICKY
    }

    private fun stopHeartbeatJobs() {
        heartbeatTask?.cancel(false)
        overlayTask?.cancel(false)
        installedAppsTask?.cancel(false)
        heartbeatTask = null
        overlayTask = null
        installedAppsTask = null
    }

    private fun startHeartbeatJobs() {
        // Reset job để tránh trùng lịch nếu onOpen được gọi lại.
        stopHeartbeatJobs()

        // Overlay check cần danh sách app đã filter.
        refreshInstalledAppsList()

        heartbeatTask = scheduler.scheduleWithFixedDelay({ sendHeartbeat() }, 0, 2, TimeUnit.SECONDS)
        overlayTask = scheduler.scheduleWithFixedDelay({ checkActiveOverlayRoutine() }, 5, 15, TimeUnit.SECONDS)
        installedAppsTask = scheduler.scheduleWithFixedDelay({ refreshInstalledAppsList() }, 5, 5, TimeUnit.MINUTES)
    }

    private fun areHeartbeatJobsRunning(): Boolean = heartbeatTask != null || overlayTask != null || installedAppsTask != null

    private fun estimateDisconnectIntent(): String {
        return try {
            // Nếu bật chế độ máy bay thì coi như "cố ý" (heuristic).
            val airplaneOn = Settings.Global.getInt(contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1
            if (airplaneOn) return "intentional"

            // Kiểm tra transport/internet capability để suy đoán user có tắt WiFi hay không.
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val nw = cm.activeNetwork
            val caps = nw?.let { cm.getNetworkCapabilities(it) }

            val hasInternet = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
            val hasWifiTransport = caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            val hasCellTransport = caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true

            // Một số máy: wifiManager.isWifiEnabled không phản ánh kịp thời lúc mất kết nối,
            // nên dùng thêm hasWifiTransport như fallback.
            val wifiEnabled = try { wifiManager.isWifiEnabled } catch (_: Exception) { hasWifiTransport }

            // Nếu WiFi bị tắt (radio) hoặc hệ thống không còn thấy WiFi transport,
            // khả năng cao là user chủ động thao tác.
            if (!wifiEnabled || !hasWifiTransport) {
                return if (hasCellTransport) "likely_intentional" else "likely_intentional"
            }

            // WiFi vẫn bật nhưng không có internet: có thể do lỗi mạng/thoáng qua.
            if (!hasInternet) return "accidental_or_unknown"

            // Có internet nhưng vẫn disconnect → nhiều khả năng server unreachable hoặc tạm chặn.
            "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }

    private fun startOfflineRecording(nowMs: Long) {
        if (!reconnectEnabled) return

        // Nếu đang có recording khác chưa hết hạn thì không reset lại disconnectStartMs.
        if (recordingUntilMs > nowMs) return

        disconnectStartMs = nowMs
        disconnectIntent = estimateDisconnectIntent()
        recordingUntilMs = nowMs + OFFLINE_RECORD_WINDOW_MS

        // Nếu chưa có job đang chạy (ví dụ mới vừa connect fail ngay), thì bật job để thu thập trong 2 phút.
        if (!areHeartbeatJobsRunning()) startHeartbeatJobs()

        // Hết 2 phút mà vẫn chưa reconnect được → ngừng thu thập + dừng reconnect.
        scheduler.schedule({
            val stillDisconnected = !isWsConnected
            if (stillDisconnected) {
                offlineEncryptedQueue.clear()
                recordingUntilMs = 0L
                disconnectStartMs = 0L
                disconnectIntent = "unknown"
                reconnectEnabled = false
                stopHeartbeatJobs()
                // Không thể kết nối lại sau 2 phút → ngừng service để tiết kiệm tài nguyên.
                stopSelf()
            }
        }, OFFLINE_RECORD_WINDOW_MS, TimeUnit.MILLISECONDS)
    }

    private fun flushOfflineQueue() {
        // Gửi tóm tắt disconnect (nếu có) + flush các hb buffered.
        if (webSocket == null || !isWsConnected) return

        val nowMs = System.currentTimeMillis()
        if (disconnectStartMs > 0L) {
            val evt = JSONObject().apply {
                put("type", "net_event")
                put("eventType", "disconnect_summary")
                put("deviceId", deviceId)
                put("deviceName", deviceName)
                put("intent", disconnectIntent)
                put("startTimeMs", disconnectStartMs)
                put("endTimeMs", nowMs)
            }
            val enc = aesEncrypt(evt.toString())
            if (enc.isNotEmpty()) webSocket?.send(enc)
        }

        for (payload in offlineEncryptedQueue) {
            if (payload.isNotEmpty()) webSocket?.send(payload)
        }
        offlineEncryptedQueue.clear()

        // Reset trạng thái recording.
        recordingUntilMs = 0L
        disconnectStartMs = 0L
        disconnectIntent = "unknown"
        reconnectEnabled = true
    }

    // Hàm lấy thông tin RAM (Free/Total)
    private fun getRamStatus(): String {
        return try {
            val memoryInfo = ActivityManager.MemoryInfo()
            activityManager.getMemoryInfo(memoryInfo)
            val freeRam = memoryInfo.availMem / (1024 * 1024)
            val totalRam = memoryInfo.totalMem / (1024 * 1024)
            "$freeRam/$totalRam" // Trả về định dạng "Trống/Tổng" MB
        } catch (_: Exception) { "0/0" }
    }

    private fun getNetworkTransportAndDataDelta(nowMs: Long): Pair<String, Long> {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val nw = cm.activeNetwork
            val caps = nw?.let { cm.getNetworkCapabilities(it) }

            val netTransport = when {
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WIFI"
                caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "CELLULAR"
                else -> "UNKNOWN"
            }

            val uid = Process.myUid()
            val tx = TrafficStats.getUidTxBytes(uid)
            val rx = TrafficStats.getUidRxBytes(uid)

            // TrafficStats có thể trả về -1 nếu chưa có dữ liệu.
            if (tx < 0L || rx < 0L) {
                if (lastNetSampleMs == 0L) {
                    lastTxBytes = tx
                    lastRxBytes = rx
                    lastNetSampleMs = nowMs
                }
                return netTransport to 0L
            }

            if (lastNetSampleMs == 0L) {
                lastTxBytes = tx
                lastRxBytes = rx
                lastNetSampleMs = nowMs
                return netTransport to 0L
            }

            val dTx = (tx - lastTxBytes).coerceAtLeast(0L)
            val dRx = (rx - lastRxBytes).coerceAtLeast(0L)

            lastTxBytes = tx
            lastRxBytes = rx
            lastNetSampleMs = nowMs

            netTransport to (dTx + dRx)
        } catch (_: Exception) {
            "UNKNOWN" to 0L
        }
    }

    private fun sendHeartbeat() {
        try {
            val now = System.currentTimeMillis()
            val clientTimeMs = now
            val (netTransport, dataBytesDelta) = getNetworkTransportAndDataDelta(now)
            val events = usageStatsManager.queryEvents(now - 15000, now)
            val event = UsageEvents.Event()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                @Suppress("Deprecation")
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    lastDetectedApp = event.packageName
                }
            }

            val foregroundAppReport = lastDetectedApp
            val overlayAppReport = cachedOverlayApp
            val finalAppReport = if (overlayAppReport.isNotEmpty()) "OVERLAY: $overlayAppReport" else foregroundAppReport

            val json = JSONObject().apply {
                put("type", "hb")
                put("deviceId", deviceId)
                put("deviceName", deviceName)
                put("clientTimeMs", clientTimeMs)
                put("netTransport", netTransport)
                put("dataBytesDelta", dataBytesDelta)
                // Tách bạch để server quyết định vi phạm overlay độc lập với foreground.
                put("foregroundApp", foregroundAppReport)
                put("overlayApp", overlayAppReport)
                put("battery", getBatteryLevel())
                put("isCharging", isDeviceCharging())
                put("isScreenOn", isScreenOn())
                put("currentApp", finalAppReport)
                put("ramInfo", getRamStatus()) // Đính kèm thông tin RAM
                put("rssi", getWifiRssi()) // Đính kèm cường độ WiFi
                put("isFtpOpen", isFtpOpen) // Đính kèm trạng thái FTP
                put("localIp", getLocalIpAddressCached()) // IP nội bộ (cache 20s để giảm tải)
            }

            // Kích thước JSON trước mã hóa + kích thước chuỗi đã mã hóa
            // để ước lượng băng thông WebSocket.
            val jsonStr = json.toString()
            val jsonSizeBytes = jsonStr.toByteArray(Charsets.UTF_8).size

            val encryptedPayload = aesEncrypt(jsonStr)
            if (encryptedPayload.isNotEmpty()) {
                val encryptedSizeBytes = encryptedPayload.toByteArray(Charsets.UTF_8).size
                hbLogCounter += 1
                if (hbLogCounter % 10 == 0) {
                    Log.d(
                        logTag,
                        "HB sizes: json=${jsonSizeBytes}B encStr=${encryptedSizeBytes}B wsConnected=${
                            isWsConnected
                        } queue=${offlineEncryptedQueue.size}"
                    )
                }
                if (isWsConnected && webSocket != null) {
                    webSocket?.send(encryptedPayload)
                } else {
                    // Trong lúc mất kết nối: buffer để gửi lại khi reconnect (tối đa 2 phút).
                    if (offlineEncryptedQueue.size > 200) offlineEncryptedQueue.removeAt(0)
                    offlineEncryptedQueue.add(encryptedPayload)
                }
            }
        } catch (e: Exception) { Log.e(logTag, "HB Error: ${e.message}") }
    }

    private fun getWifiRssi(): Int {
        return try {
            @Suppress("Deprecation")
            val wifiInfo: WifiInfo? = wifiManager.connectionInfo
            wifiInfo?.rssi ?: -100
        } catch (_: Exception) { -100 }
    }

    private fun aesEncrypt(data: String): String {
        try {
            val md = MessageDigest.getInstance("SHA-256")
            val keyBytes = md.digest(WS_SECRET_KEY.toByteArray(Charsets.UTF_8))
            val secretKey = SecretKeySpec(keyBytes, "AES")

            val ivBytes = ByteArray(16)
            SecureRandom().nextBytes(ivBytes)
            val ivSpec = IvParameterSpec(ivBytes)

            val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec)

            val encryptedBytes = cipher.doFinal(data.toByteArray(Charsets.UTF_8))
            
            val ivHex = ivBytes.joinToString("") { "%02x".format(it) }
            val encryptedBase64 = Base64.encodeToString(encryptedBytes, Base64.NO_WRAP)
            
            return "$ivHex:$encryptedBase64"
        } catch (e: Exception) {
            Log.e(logTag, "Encrypt Error: ${e.message}")
            return ""
        }
    }

    @Suppress("DiscouragedApi")
    private fun refreshInstalledAppsList() {
        try {
            val packages = packageManager.getInstalledApplications(PackageManager.GET_META_DATA)
            cachedInstalledApps = packages.filter { app ->
                (app.flags and ApplicationInfo.FLAG_SYSTEM) == 0 &&
                !whitelistPackages.contains(app.packageName) &&
                !systemNoise.contains(app.packageName)
            }
        } catch (e: Exception) { Log.e(logTag, "Refresh App Error: ${e.message}") }
    }

    private fun checkActiveOverlayRoutine() {
        try {
            for (app in cachedInstalledApps) {
                @Suppress("Deprecation")
                val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    appOpsManager.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, app.uid, app.packageName)
                } else {
                    appOpsManager.checkOpNoThrow(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, app.uid, app.packageName)
                }
                if (mode == AppOpsManager.MODE_ALLOWED) {
                    cachedOverlayApp = app.packageName
                    return
                }
            }
            cachedOverlayApp = "" // Reset if no overlay found
        } catch (e: Exception) { Log.e(logTag, "Overlay Error: ${e.message}") }
    }

    private fun startForegroundService() {
        val channelId = "monitor_silent_channel"
        val channel = NotificationChannel(channelId, "System Sync", NotificationManager.IMPORTANCE_MIN)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Hệ thống đang đồng bộ")
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true).build()
        startForeground(1, notification)
    }

    private var reconnectDelaySec = 2

    private fun connectWebSocket() {
        if (!reconnectEnabled || isWsConnected) return
        client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
        // Khi dùng ngrok/HTTPS (port 443) phải dùng wss://; LAN dùng ws://
        val wsUrl = if (serverPort == "443") "wss://$serverIp" else "ws://$serverIp:$serverPort"
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectDelaySec = 2
                isWsConnected = true
                // Nếu đang trong offline recording thì job đã chạy sẵn.
                if (!areHeartbeatJobsRunning()) startHeartbeatJobs()
                flushOfflineQueue()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isWsConnected = false
                val nowMs = System.currentTimeMillis()
                startOfflineRecording(nowMs)

                if (!reconnectEnabled) return
                val delay = reconnectDelaySec
                scheduler.schedule({ connectWebSocket() }, delay.toLong(), TimeUnit.SECONDS)
                if (reconnectDelaySec < RECONNECT_MAX_SEC) reconnectDelaySec = (reconnectDelaySec * 2).coerceAtMost(RECONNECT_MAX_SEC)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isWsConnected = false
                val nowMs = System.currentTimeMillis()
                startOfflineRecording(nowMs)

                if (!reconnectEnabled) return
                val delay = reconnectDelaySec
                scheduler.schedule({ connectWebSocket() }, delay.toLong(), TimeUnit.SECONDS)
                if (reconnectDelaySec < RECONNECT_MAX_SEC) reconnectDelaySec = (reconnectDelaySec * 2).coerceAtMost(RECONNECT_MAX_SEC)
            }
        })
    }

    private fun getBatteryLevel(): Int = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    private fun isDeviceCharging(): Boolean {
        val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        return status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    }
    private fun isScreenOn(): Boolean = powerManager.isInteractive

    private fun getLocalIpAddressCached(): String {
        val now = System.currentTimeMillis()
        if (cachedLocalIp.isNotEmpty() && (now - cachedLocalIpTimeMs) < LOCAL_IP_CACHE_MS) {
            return cachedLocalIp
        }
        cachedLocalIp = getLocalIpAddress()
        cachedLocalIpTimeMs = now
        return cachedLocalIp
    }

    private fun getLocalIpAddress(): String {
        try {
            val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                val addresses = networkInterface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val address = addresses.nextElement()
                    if (!address.isLoopbackAddress && (address.hostAddress?.indexOf(':') ?: 0) < 0) {
                        val ip = address.hostAddress ?: ""
                        if (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.")) {
                            return ip
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return ""
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(ftpReceiver)
        } catch (_: Exception) {}
    }
}