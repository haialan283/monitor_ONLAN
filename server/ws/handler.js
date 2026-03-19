const WebSocket = require('ws');

const WHITELIST_APPS = [
    'com.dts.freefireth',
    'com.dts.freefiremax',
    'com.android.chrome',
    'com.ops.tournamentmonitor',
    'com.sec.android.app.launcher',
	'com.garena.game.fcmobilevn',
//launcher samsung
    '',
];
const NOISE_PACKAGES = [
    // Chỉ lọc "noise" thực sự (System UI, dịch vụ nền).
    // Không lọc theo vendor/launcher (oppo/samsung/miui/...) vì khi người dùng thoát app whitelist
    // về launcher, ta muốn coi đó là "đã rời whitelist" => warning.
    'com.android.systemui',
    'com.google.android.permissioncontroller',
    'com.android.permissioncontroller',
];

function normalizePackageName(input) {
    const raw = (input || '').toString().trim().toLowerCase();
    if (!raw) return '';

    // Android app có thể gửi "OVERLAY: <package>" khi phát hiện app overlay.
    // Chuẩn hóa để chỉ còn package name.
    const overlayMatch = raw.match(/^overlay\s*:\s*([a-z0-9._]+)\s*$/i);
    if (overlayMatch && overlayMatch[1]) return overlayMatch[1].toLowerCase();

    // Một số trường hợp có thể có nhiều token/dấu phẩy; lấy token đầu tiên trông như package.
    const firstToken = raw.split(/[,\s]+/).find(Boolean) || '';
    const pkgMatch = firstToken.match(/[a-z][a-z0-9_]*(\.[a-z0-9_]+)+/);
    return pkgMatch ? pkgMatch[0] : raw;
}

/**
 * Gắn xử lý WebSocket: init khi kết nối, xử lý message (hb, assign_slot, ...).
 * onViolation(deviceName, app) được gọi khi có vi phạm mới (để gửi Discord, v.v.).
 */
function attachWsHandler(wss, store, broadcast, decryptPayload, encryptPayload, onViolation) {
    wss.on('connection', (ws) => {
        try {
            const initData = {
                type: 'init',
                devices: store.devices,
                alerts: store.getAlerts(),
                tableNames: store.getTableNames(),
                netConfig: store.getNetConfig(),
            };
            ws.send(encryptPayload(initData));
        } catch (e) {
            console.error('Init Send Error:', e);
        }

        ws.on('message', (message) => {
            try {
                const data = decryptPayload(message.toString());
                const timeNow = new Date().toLocaleTimeString('vi-VN');
                let deviceInfo = null;
                let alertsChanged = false;

                if (data.type === 'hb') {
                    const {
                        deviceId,
                        deviceName,
                        battery,
                        currentApp,
                        isScreenOn,
                        isCharging,
                        ramInfo,
                        rssi,
                        isFtpOpen,
                        seatLayout: dataSeatLayout,
                    } = data;
                    const rawApp = normalizePackageName(currentApp);
                    const cleanApp = NOISE_PACKAGES.some((p) => rawApp.includes(p.toLowerCase())) ? '' : rawApp;

                    let status = 'online';
                    if (!isScreenOn) status = 'lock';
                    else if (cleanApp !== '' && !WHITELIST_APPS.includes(cleanApp)) status = 'warning';
                    if (process.env.DEBUG_HB === '1') {
                        console.log('[HB]', deviceName || deviceId, {
                            currentApp,
                            rawApp,
                            cleanApp,
                            isScreenOn,
                            status,
                            isWhitelisted: cleanApp !== '' && WHITELIST_APPS.includes(cleanApp),
                        });
                    }

                    const rawIp = ws._socket.remoteAddress || '';
                    let wsIp = rawIp.includes('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
                    if (wsIp === '::1' || wsIp === '1' || wsIp === '') wsIp = '127.0.0.1';
                    const ipAddress = data.localIp && data.localIp.length > 5 ? data.localIp : wsIp;

                    const idx = store.devices.findIndex((d) => d.deviceId === deviceId);
                    const prev = idx !== -1 ? store.devices[idx] : null;
                    deviceInfo = {
                        deviceId,
                        deviceName: deviceName || deviceId,
                        battery,
                        isCharging,
                        status,
                        currentApp: cleanApp,
                        ramInfo: ramInfo || 'N/A',
                        rssi: rssi ?? -100,
                        isFtpOpen: isFtpOpen || false,
                        ipAddress,
                        slotId: prev ? prev.slotId : null,
                        seatLayout: { x: 0, y: 0, w: 1, ...(prev ? prev.seatLayout : {}), ...(dataSeatLayout || {}) },
                        lastSeen: Date.now(),
                    };
                    if (idx !== -1) store.devices[idx] = deviceInfo;
                    else store.devices.push(deviceInfo);

                    const alerts = store.getAlerts();
                    let openAlert = alerts.find((a) => a.deviceId === deviceId && !a.endTime);

                    if (status === 'warning') {
                        if (!openAlert || openAlert.app !== cleanApp) {
                            if (openAlert) openAlert.endTime = timeNow;
                            store.updateAlerts((arr) => {
                                arr.push({
                                    deviceId,
                                    deviceName: deviceInfo.deviceName,
                                    app: cleanApp,
                                    startTime: timeNow,
                                    endTime: null,
                                });
                            });
                            alertsChanged = true;
                            if (typeof onViolation === 'function') {
                                onViolation(deviceInfo.deviceName, cleanApp);
                            }
                        }
                    } else if (openAlert) {
                        openAlert.endTime = timeNow;
                        store.setAlerts(alerts);
                        alertsChanged = true;
                    }

                    const beforeTrim = store.getAlerts().length;
                    store.trimAlertsIfNeeded();
                    if (store.getAlerts().length !== beforeTrim) alertsChanged = true;
                }

                if (data.type === 'update_net_config') {
                    const nc = { dns: data.dns, port: parseInt(data.port, 10) || 0 };
                    store.setNetConfig(nc);
                }
                if (data.type === 'assign_slot') {
                    const dev = store.devices.find((d) => d.deviceId === data.deviceId);
                    if (dev) {
                        // Với slot thông thường (bàn/ghế), mỗi slot chỉ 1 thiết bị → clear thiết bị cũ.
                        // Riêng slot 'arena' là bản đồ tự do, cho phép nhiều thiết bị cùng lúc.
                        if (data.slotId !== 'arena') {
                            store.devices.forEach((d) => {
                                if (d.slotId === data.slotId) d.slotId = null;
                            });
                        }
                        dev.slotId = data.slotId;
                        broadcast.broadcast({ type: 'slot_assigned', deviceId: data.deviceId, slotId: data.slotId });
                    }
                }
                if (data.type === 'update_seat_layout') {
                    const dev = store.devices.find((d) => d.deviceId === data.deviceId);
                    if (dev) {
                        dev.seatLayout = { ...dev.seatLayout, ...data.seatLayout };
                        broadcast.broadcast({ type: 'seat_layout_updated', deviceId: data.deviceId, seatLayout: dev.seatLayout });
                    }
                }
                if (data.type === 'update_table_name') {
                    store.updateTableNames((names) => {
                        names[data.tableId] = data.name;
                    });
                    broadcast.broadcast({ type: 'table_name_updated', tableNames: store.getTableNames() });
                }
                if (data.type === 'clear_logs') {
                    store.setAlerts([]);
                    broadcast.broadcast({ type: 'alerts_cleared' });
                }

                if (deviceInfo) {
                    broadcast.broadcast({ type: 'device_updated', device: deviceInfo });
                    if (alertsChanged) broadcast.broadcast({ type: 'alerts_updated', alerts: store.getAlerts() });
                }
            } catch (e) {
                console.error('WS MSG Error:', e.message);
            }
        });
    });
}

module.exports = { attachWsHandler };
