package com.ops.tournamentmonitor

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var edtName: EditText
    private lateinit var edtIp: EditText
    private lateinit var edtPort: EditText
    private lateinit var edtTournamentCode: EditText
    private lateinit var btnConnect: Button
    private lateinit var txtStatus: TextView
    private lateinit var switchFtp: Switch
    private lateinit var sectionTournament: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        edtName = findViewById(R.id.edtDeviceName)
        edtIp = findViewById(R.id.edtIp)
        edtPort = findViewById(R.id.edtPort)
        edtTournamentCode = findViewById(R.id.edtTournamentCode)
        btnConnect = findViewById(R.id.btnConnect)
        txtStatus = findViewById(R.id.txtStatus)
        switchFtp = findViewById(R.id.switchFtp)
        sectionTournament = findViewById(R.id.sectionTournament)

        checkPermissions()

        val sharedPref = getSharedPreferences("MonitorConfig", Context.MODE_PRIVATE)
        edtName.setText(sharedPref.getString("last_name", ""))
        edtIp.setText(sharedPref.getString("last_ip", ""))
        edtPort.setText(sharedPref.getString("last_port", "3000"))
        edtTournamentCode.setText(sharedPref.getString("last_tournament_code", ""))

        edtPort.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                applyLiveUi(isLivePort(s?.toString()))
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        applyLiveUi(isLivePort(edtPort.text.toString()))

        btnConnect.setOnClickListener { handleStartService() }

        switchFtp.setOnCheckedChangeListener { _, isChecked ->
            val intent = Intent("com.ops.tournamentmonitor.ACTION_TOGGLE_FTP")
            intent.setPackage(packageName)
            intent.putExtra("IS_OPEN", isChecked)
            sendBroadcast(intent)
        }
    }

    private fun isLivePort(port: String?) = port?.trim() == "443"

    private fun applyLiveUi(live: Boolean) {
        sectionTournament.visibility = if (live) View.VISIBLE else View.GONE
        switchFtp.visibility = if (live) View.GONE else View.VISIBLE
        if (live) switchFtp.isChecked = false
    }

    private fun handleStartService() {
        val name = edtName.text.toString().trim()
        val ip = edtIp.text.toString().trim()
        val port = edtPort.text.toString().trim()
        val tournamentCode = edtTournamentCode.text.toString().trim().uppercase()
        val live = isLivePort(port)

        if (name.isEmpty() || ip.isEmpty() || port.isEmpty()) {
            Toast.makeText(this, R.string.toast_fill_all, Toast.LENGTH_SHORT).show()
            return
        }
        if (live && tournamentCode.isEmpty()) {
            Toast.makeText(this, R.string.toast_tournament_required, Toast.LENGTH_LONG).show()
            return
        }

        val sharedPref = getSharedPreferences("MonitorConfig", Context.MODE_PRIVATE)
        with(sharedPref.edit()) {
            putString("last_name", name)
            putString("last_ip", ip)
            putString("last_port", port)
            putString("last_tournament_code", tournamentCode)
            apply()
        }

        if (!hasUsageStatsPermission()) {
            Toast.makeText(this, "Vui lòng cấp quyền truy cập dữ liệu sử dụng!", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            return
        }
        if (!hasOverlayPermission()) {
            Toast.makeText(this, "Vui lòng cấp quyền hiển thị trên ứng dụng khác (Overlay)!", Toast.LENGTH_LONG).show()
            requestOverlayPermission()
            return
        }

        val serviceIntent = Intent(this, HeartbeatService::class.java).apply {
            putExtra("DEVICE_NAME", name)
            putExtra("IP", ip)
            putExtra("PORT", port)
            putExtra("FTP_OPEN", if (live) false else switchFtp.isChecked)
            putExtra("TOURNAMENT_CODE", if (live) tournamentCode else "")
            putExtra("CERT_PIN_SHA256", BuildConfig.TLS_PIN_SHA256.trim().takeIf { it.isNotEmpty() } ?: "")
        }

        try {
            ContextCompat.startForegroundService(this, serviceIntent)
            txtStatus.text = getString(R.string.status_connecting)
            txtStatus.setTextColor(ContextCompat.getColor(this, R.color.monitor_success))
            btnConnect.isEnabled = false
            btnConnect.alpha = 0.5f
            Toast.makeText(this, "Đã khởi động giám sát!", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Lỗi: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun hasOverlayPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else true
    }

    private fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:$packageName")))
        }
    }

    private fun checkPermissions() {
        if (!hasUsageStatsPermission()) {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }
    }
}
