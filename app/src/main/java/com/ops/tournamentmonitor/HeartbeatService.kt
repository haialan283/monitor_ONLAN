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

class HeartbeatService : Service() {

    companion object {
        /** Key mã hóa WebSocket — phải trùng với SECRET_KEY trên server (.env). */
        private const val WS_SECRET_KEY = "MonitorTournamentSecretKey2026!"
        private const val LOCAL_IP_CACHE_MS = 20_000L
        private const val RECONNECT_MAX_SEC = 30
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
            refreshInstalledAppsList() // Quét danh sách app 1 lần lúc bật
            
            val filter = IntentFilter("com.ops.tournamentmonitor.ACTION_TOGGLE_FTP")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(ftpReceiver, filter, RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(ftpReceiver, filter)
            }

            scheduler.scheduleWithFixedDelay({ sendHeartbeat() }, 0, 2, TimeUnit.SECONDS)
            scheduler.scheduleWithFixedDelay({ checkActiveOverlayRoutine() }, 5, 15, TimeUnit.SECONDS)
            scheduler.scheduleWithFixedDelay({ refreshInstalledAppsList() }, 5, 5, TimeUnit.MINUTES)
        }
        return START_STICKY
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

    private fun sendHeartbeat() {
        try {
            val now = System.currentTimeMillis()
            val events = usageStatsManager.queryEvents(now - 15000, now)
            val event = UsageEvents.Event()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                @Suppress("Deprecation")
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    lastDetectedApp = event.packageName
                }
            }

            val finalAppReport = if (cachedOverlayApp.isNotEmpty()) "OVERLAY: $cachedOverlayApp" else lastDetectedApp

            val json = JSONObject().apply {
                put("type", "hb")
                put("deviceId", deviceId)
                put("deviceName", deviceName)
                put("battery", getBatteryLevel())
                put("isCharging", isDeviceCharging())
                put("isScreenOn", isScreenOn())
                put("currentApp", finalAppReport)
                put("ramInfo", getRamStatus()) // Đính kèm thông tin RAM
                put("rssi", getWifiRssi()) // Đính kèm cường độ WiFi
                put("isFtpOpen", isFtpOpen) // Đính kèm trạng thái FTP
                put("localIp", getLocalIpAddressCached()) // IP nội bộ (cache 20s để giảm tải)
            }
            
            val encryptedPayload = aesEncrypt(json.toString())
            if (encryptedPayload.isNotEmpty()) {
                webSocket?.send(encryptedPayload)
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
        client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
        val request = Request.Builder().url("ws://$serverIp:$serverPort").build()
        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectDelaySec = 2
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
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