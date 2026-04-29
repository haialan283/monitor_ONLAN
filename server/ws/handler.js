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

// Whitelist cho các app "overlay/pip" (draw-over) mà bạn muốn coi là hợp lệ.
// Ví dụ: Samsung Deskin (tên package thực tế có thể là một biến thể khác tùy ROM/model).
// Nếu overlay app thuộc danh sách này thì sẽ KHÔNG ghi vi phạm overlay.
const OVERLAY_WHITELIST_APPS = [
];
const NOISE_PACKAGES = [
    // Chỉ lọc "noise" thực sự (System UI, dịch vụ nền).
    // Không lọc theo vendor/launcher (oppo/samsung/miui/...) vì khi người dùng thoát app whitelist
    // về launcher, ta muốn coi đó là "đã rời whitelist" => warning.
    'com.android.systemui',
    'com.google.android.permissioncontroller',
	'com.asus.launcher',
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
function attachWsHandler(wss, store, broadcast, decryptPayload, encryptPayload, onViolation, getRoleFromReq, runNetworkCheckNow) {
    const scheduleNetCheck = typeof runNetworkCheckNow === 'function' ? runNetworkCheckNow : () => {};
    wss.on('connection', (ws, req) => {
        const reqUrl = (req && req.url) ? String(req.url) : '/';
        const isPlainWs = reqUrl.includes('enc=0');
        ws._alanPlainWs = isPlainWs;
        ws._alanRole = typeof getRoleFromReq === 'function' ? (getRoleFromReq(req) || null) : null;
        try {
            const initData = {
                type: 'init',
                devices: store.devices,
                alerts: store.getAlerts(),
                tableNames: store.getTableNames(),
                netConfig: store.getNetConfig(),
                netConfigRemote: store.getNetConfigRemote(),
            };
            ws.send(isPlainWs ? JSON.stringify(initData) : encryptPayload(initData));
        } catch (e) {
            console.error('Init Send Error:', e);
        }

        ws.on('message', (message) => {
            try {
                const raw = message.toString();
                const data = isPlainWs ? JSON.parse(raw) : decryptPayload(raw);
                const writeTypes = new Set([
                    'update_net_config',
                    'update_net_config_remote',
                    'update_net_config_both',
                    'assign_slot',
                    'update_seat_layout',
                    'update_table_name',
                    'backup_stage_state',
                    'restore_stage_state',
                    'clear_logs',
                ]);
                if (data && writeTypes.has(data.type) && ws._alanRole !== 'admin') {
                    return;
                }
                const serverTimeNowStr = new Date().toLocaleTimeString('vi-VN');
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
                        netTransport,
                        dataBytesDelta,
                        clientTimeMs,
                        foregroundApp,
                        overlayApp,
                        seatLayout: dataSeatLayout,
                    } = data;

                    const currentAppStr = typeof currentApp === 'string' ? currentApp : '';
                    const hasOverlayPrefix = /^overlay\s*:\s*/i.test(currentAppStr);
                    const overlayFallback = hasOverlayPrefix ? normalizePackageName(currentAppStr) : '';
                    const foregroundFallback = !hasOverlayPrefix ? normalizePackageName(currentAppStr) : '';

                    const rawForegroundApp = normalizePackageName(foregroundApp || foregroundFallback || '');
                    const cleanForegroundApp = NOISE_PACKAGES.some((p) => rawForegroundApp.includes(p.toLowerCase())) ? '' : rawForegroundApp;

                    const overlayNormalized = normalizePackageName(overlayApp || overlayFallback || '');
                    const isOverlayViolation = !!overlayNormalized && !OVERLAY_WHITELIST_APPS.includes(overlayNormalized);

                    const isForegroundViolation =
                        cleanForegroundApp !== '' && !WHITELIST_APPS.includes(cleanForegroundApp);
                    const isForegroundWhitelisted =
                        cleanForegroundApp !== '' && WHITELIST_APPS.includes(cleanForegroundApp);

                    // App keys dùng cho violation logs (có thể lưu đồng thời cả overlay và foreground).
                    const overlayAppKey = isOverlayViolation ? `OVERLAY:${overlayNormalized}` : null;
                    const foregroundAppKey = isForegroundViolation ? cleanForegroundApp : null;

                    // Giá trị hiển thị cho dashboard:
                    // - currentApp: foreground app (để operator biết user đang mở gì)
                    // - overlayApp: chỉ hiển thị khi overlay thực sự bị coi là vi phạm
                    const foregroundAppDisplay = cleanForegroundApp || '';
                    const overlayAppDisplay = isOverlayViolation ? overlayNormalized : '';

                    // Dùng timestamp từ client nếu có để ghi log đúng mốc thời gian
                    const hbTimeNowStr =
                        typeof clientTimeMs === 'number' ? new Date(clientTimeMs).toLocaleTimeString('vi-VN') : serverTimeNowStr;

                    let status = 'online';
                    if (!isScreenOn) status = 'lock';
                    else if (isOverlayViolation && isForegroundViolation) status = 'warning'; // đỏ: cả 2 đều vi phạm
                    else if (isOverlayViolation || isForegroundViolation) status = 'partial_warning'; // vàng: chỉ 1 trong 2 vi phạm
                    if (process.env.DEBUG_HB === '1') {
                        console.log('[HB]', deviceName || deviceId, {
                            currentApp,
                            rawForegroundApp,
                            cleanForegroundApp,
                            overlayApp,
                            isOverlayViolation,
                            isForegroundViolation,
                            isForegroundWhitelisted,
                            overlayAppKey,
                            foregroundAppKey,
                            foregroundAppDisplay,
                            overlayAppDisplay,
                            isScreenOn,
                            status,
                            isWhitelisted: !isOverlayViolation && isForegroundWhitelisted,
                        });
                    }

                    const rawIp = ws._socket.remoteAddress || '';
                    let wsIp = rawIp.includes('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;
                    if (wsIp === '::1' || wsIp === '1' || wsIp === '') wsIp = '127.0.0.1';
                    const ipAddress = data.localIp && data.localIp.length > 5 ? data.localIp : wsIp;

                    const idx = store.devices.findIndex((d) => d.deviceId === deviceId);
                    const prev = idx !== -1 ? store.devices[idx] : null;
                    const persisted = typeof store.getStageStateForDevice === 'function'
                        ? store.getStageStateForDevice(deviceId)
                        : null;

                    const deltaBytes = typeof dataBytesDelta === 'number' ? dataBytesDelta : 0;
                    const transport = typeof netTransport === 'string' ? netTransport : 'UNKNOWN';
                    const prevMobileBytesTotal = prev && typeof prev.mobileBytesTotal === 'number' ? prev.mobileBytesTotal : 0;
                    const prevWifiBytesTotal = prev && typeof prev.wifiBytesTotal === 'number' ? prev.wifiBytesTotal : 0;

                    let mobileBytesTotal = prevMobileBytesTotal;
                    let wifiBytesTotal = prevWifiBytesTotal;
                    if (transport === 'CELLULAR') mobileBytesTotal += deltaBytes;
                    if (transport === 'WIFI') wifiBytesTotal += deltaBytes;

                    deviceInfo = {
                        deviceId,
                        deviceName: deviceName || deviceId,
                        battery,
                        isCharging,
                        status,
                        currentApp: foregroundAppDisplay,
                        overlayApp: overlayAppDisplay,
                        foregroundViolation: isForegroundViolation,
                        overlayViolation: isOverlayViolation,
                        foregroundIsWhitelisted: isForegroundWhitelisted,
                        ramInfo: ramInfo || 'N/A',
                        rssi: rssi ?? -100,
                        isFtpOpen: isFtpOpen || false,
                        ipAddress,
                        netTransport: transport,
                        mobileBytesTotal,
                        wifiBytesTotal,
                        slotId: prev ? prev.slotId : (persisted ? persisted.slotId : null),
                        seatLayout: {
                            x: 0,
                            y: 0,
                            w: 1,
                            ...(persisted && persisted.seatLayout ? persisted.seatLayout : {}),
                            ...(prev ? prev.seatLayout : {}),
                            ...(dataSeatLayout || {}),
                        },
                        lastSeen: Date.now(),
                    };
                    if (idx !== -1) store.devices[idx] = deviceInfo;
                    else store.devices.push(deviceInfo);

                    const alerts = store.getAlerts();
                    let modified = false;

                    const overlayOpenAlerts = alerts.filter(
                        (a) => a.deviceId === deviceId && !a.endTime && typeof a.app === 'string' && a.app.startsWith('OVERLAY:')
                    );
                    const fgOpenAlerts = alerts.filter(
                        (a) =>
                            a.deviceId === deviceId &&
                            !a.endTime &&
                            typeof a.app === 'string' &&
                            !a.app.startsWith('OVERLAY:') &&
                            !a.app.startsWith('DISCONNECTED')
                    );

                    // Overlay alerts
                    if (!isOverlayViolation) {
                        overlayOpenAlerts.forEach((a) => {
                            a.endTime = hbTimeNowStr;
                            modified = true;
                        });
                    } else {
                        overlayOpenAlerts.forEach((a) => {
                            if (a.app !== overlayAppKey) {
                                a.endTime = hbTimeNowStr;
                                modified = true;
                            }
                        });
                        const overlayAlreadyOpen = alerts.find(
                            (a) => a.deviceId === deviceId && a.app === overlayAppKey && !a.endTime
                        );
                        if (!overlayAlreadyOpen) {
                            alerts.push({
                                deviceId,
                                deviceName: deviceInfo.deviceName,
                                app: overlayAppKey,
                                startTime: hbTimeNowStr,
                                endTime: null,
                            });
                            modified = true;
                            if (typeof onViolation === 'function') onViolation(deviceInfo.deviceName, overlayAppKey);
                        }
                    }

                    // Foreground alerts
                    if (!isForegroundViolation) {
                        fgOpenAlerts.forEach((a) => {
                            a.endTime = hbTimeNowStr;
                            modified = true;
                        });
                    } else {
                        fgOpenAlerts.forEach((a) => {
                            if (a.app !== foregroundAppKey) {
                                a.endTime = hbTimeNowStr;
                                modified = true;
                            }
                        });
                        const fgAlreadyOpen = alerts.find(
                            (a) => a.deviceId === deviceId && a.app === foregroundAppKey && !a.endTime
                        );
                        if (!fgAlreadyOpen) {
                            alerts.push({
                                deviceId,
                                deviceName: deviceInfo.deviceName,
                                app: foregroundAppKey,
                                startTime: hbTimeNowStr,
                                endTime: null,
                            });
                            modified = true;
                            if (typeof onViolation === 'function') onViolation(deviceInfo.deviceName, foregroundAppKey);
                        }
                    }

                    if (modified) {
                        store.setAlerts(alerts);
                        alertsChanged = true;
                    }

                    const beforeTrim = store.getAlerts().length;
                    store.trimAlertsIfNeeded();
                    if (store.getAlerts().length !== beforeTrim) alertsChanged = true;
                }

                // Khi app reconnect sau disconnect tạm thời, nó có thể gửi 1 sự kiện tổng hợp.
                if (data.type === 'net_event' && data.eventType === 'disconnect_summary') {
                    const deviceId = data.deviceId;
                    if (deviceId) {
                        const deviceName = data.deviceName || deviceId;
                        const intent = data.intent || 'unknown';
                        const startMs = typeof data.startTimeMs === 'number' ? data.startTimeMs : Date.now();
                        const endMs = typeof data.endTimeMs === 'number' ? data.endTimeMs : Date.now();

                        store.updateAlerts((arr) => {
                            arr.push({
                                deviceId,
                                deviceName,
                                app: `DISCONNECTED (${intent})`,
                                startTime: new Date(startMs).toLocaleTimeString('vi-VN'),
                                endTime: new Date(endMs).toLocaleTimeString('vi-VN'),
                            });
                        });
                        store.trimAlertsIfNeeded();
                        broadcast.broadcast({ type: 'alerts_updated', alerts: store.getAlerts() });
                    }
                }

                if (data.type === 'update_net_config') {
                    const nc = { dns: String(data.dns || '').trim(), port: parseInt(data.port, 10) || 0 };
                    store.setNetConfig(nc);
                    scheduleNetCheck();
                }
                if (data.type === 'update_net_config_remote') {
                    const nc = { dns: String(data.dns || '').trim(), port: parseInt(data.port, 10) || 0 };
                    store.setNetConfigRemote(nc);
                    scheduleNetCheck();
                }
                if (data.type === 'update_net_config_both') {
                    store.setNetConfig({ dns: String(data.dns || '').trim(), port: parseInt(data.port, 10) || 0 });
                    store.setNetConfigRemote({
                        dns: String(data.dnsRemote || '').trim(),
                        port: parseInt(data.portRemote, 10) || 0,
                    });
                    scheduleNetCheck();
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
                        if (typeof store.setDeviceSlot === 'function') {
                            store.setDeviceSlot(data.deviceId, data.slotId);
                        }
                        broadcast.broadcast({ type: 'slot_assigned', deviceId: data.deviceId, slotId: data.slotId });
                    }
                }
                if (data.type === 'update_seat_layout') {
                    const dev = store.devices.find((d) => d.deviceId === data.deviceId);
                    if (dev) {
                        dev.seatLayout = { ...dev.seatLayout, ...data.seatLayout };
                        if (typeof store.setDeviceSeatLayout === 'function') {
                            store.setDeviceSeatLayout(data.deviceId, data.seatLayout);
                        }
                        broadcast.broadcast({ type: 'seat_layout_updated', deviceId: data.deviceId, seatLayout: dev.seatLayout });
                    }
                }
                if (data.type === 'update_table_name') {
                    store.updateTableNames((names) => {
                        names[data.tableId] = data.name;
                    });
                    broadcast.broadcast({ type: 'table_name_updated', tableNames: store.getTableNames() });
                }
                if (data.type === 'backup_stage_state') {
                    if (typeof store.backupStageState === 'function') store.backupStageState();
                }
                if (data.type === 'restore_stage_state') {
                    const ok = typeof store.restoreStageStateBackup === 'function' ? store.restoreStageStateBackup() : false;
                    if (ok) {
                        const s = typeof store.getStageState === 'function' ? store.getStageState() : {};
                        store.devices.forEach((d) => {
                            const st = s && d && d.deviceId ? s[d.deviceId] : null;
                            if (!st) return;
                            if (typeof st.slotId !== 'undefined') d.slotId = st.slotId;
                            if (st.seatLayout && typeof st.seatLayout === 'object') {
                                d.seatLayout = { ...(d.seatLayout || {}), ...st.seatLayout };
                            }
                        });
                        broadcast.broadcast({
                            type: 'update_all',
                            devices: store.devices,
                            alerts: store.getAlerts(),
                            tableNames: store.getTableNames(),
                            netConfig: store.getNetConfig(),
                            netConfigRemote: store.getNetConfigRemote(),
                        });
                    }
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
