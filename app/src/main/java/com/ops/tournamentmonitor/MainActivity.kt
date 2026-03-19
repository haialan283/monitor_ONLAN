package com.ops.tournamentmonitor

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.Environment
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import android.net.Uri
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var edtName: EditText
    private lateinit var edtIp: EditText
    private lateinit var edtPort: EditText
    private lateinit var btnConnect: Button
    private lateinit var txtStatus: TextView
    private lateinit var switchFtp: Switch

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 1. Ánh xạ các View từ XML
        edtName = findViewById(R.id.edtDeviceName)
        edtIp = findViewById(R.id.edtIp)
        edtPort = findViewById(R.id.edtPort)
        btnConnect = findViewById(R.id.btnConnect)
        txtStatus = findViewById(R.id.txtStatus)
        switchFtp = findViewById(R.id.switchFtp)

        // 2. Kiểm tra và yêu cầu quyền (Cực kỳ quan trọng để giám sát App)
        checkPermissions()

        // 3. Tải lại cấu hình đã lưu lần trước (nếu có)
        val sharedPref = getSharedPreferences("MonitorConfig", Context.MODE_PRIVATE)
        edtName.setText(sharedPref.getString("last_name", ""))
        edtIp.setText(sharedPref.getString("last_ip", ""))
        edtPort.setText(sharedPref.getString("last_port", "3000"))

        btnConnect.setOnClickListener {
            handleStartService()
        }

        switchFtp.setOnCheckedChangeListener { _, isChecked ->
            // ADB Mode: Không cần truy cập SAF hay mở File Server.
            // Chỉ cần báo trạng thái gạt nút về cho Node.js biết là "KTV đã cho phép kết nối LAN".
            val intent = Intent("com.ops.tournamentmonitor.ACTION_TOGGLE_FTP")
            intent.setPackage(packageName)
            intent.putExtra("IS_OPEN", isChecked)
            sendBroadcast(intent)
        }
    }

    private fun handleStartService() {
        val name = edtName.text.toString().trim()
        val ip = edtIp.text.toString().trim()
        val port = edtPort.text.toString().trim()

        if (name.isEmpty() || ip.isEmpty() || port.isEmpty()) {
            Toast.makeText(this, "Vui lòng nhập đầy đủ thông tin!", Toast.LENGTH_SHORT).show()
            return
        }

        // Lưu cấu hình để lần sau không phải nhập lại
        val sharedPref = getSharedPreferences("MonitorConfig", Context.MODE_PRIVATE)
        with(sharedPref.edit()) {
            putString("last_name", name)
            putString("last_ip", ip)
            putString("last_port", port)
            apply()
        }

        // Kiểm tra lại quyền trước khi khởi động
        if (!hasUsageStatsPermission()) {
            Toast.makeText(this, "Vui lòng cấp quyền truy cập dữ liệu sử dụng!", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            return
        }

        // Khởi động Foreground Service
        val serviceIntent = Intent(this, HeartbeatService::class.java).apply {
            putExtra("DEVICE_NAME", name)
            putExtra("IP", ip)
            putExtra("PORT", port)
            putExtra("FTP_OPEN", switchFtp.isChecked)
        }

        try {
            // Android 8.0 trở lên phải dùng startForegroundService
            ContextCompat.startForegroundService(this, serviceIntent)

            // Cập nhật giao diện
            txtStatus.text = "Trạng thái: Đang kết nối..."
            txtStatus.setTextColor(ContextCompat.getColor(this, android.R.color.holo_green_light))
            btnConnect.isEnabled = false
            btnConnect.alpha = 0.5f

            Toast.makeText(this, "Đã khởi động giám sát!", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Lỗi: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun checkPermissions() {
        // 1. Quyền Usage Stats (Để lấy currentApp, history10s)
        if (!hasUsageStatsPermission()) {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }

        // 2. Quyền Thông báo (Dành cho Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 101)
        }
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
        } else {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    // Tùy chọn: Thêm hàm để giải phóng nút Connect khi Service bị dừng (nếu cần)
    override fun onResume() {
        super.onResume()
        // Bạn có thể thêm logic kiểm tra xem Service còn chạy không để cập nhật lại UI
    }
}