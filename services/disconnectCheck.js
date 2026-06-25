/**
 * Định kỳ đánh dấu thiết bị mất kết nối (quá 7s không heartbeat) và broadcast.
 * onDisconnect(deviceName) được gọi cho mỗi thiết bị vừa mất kết nối (để gửi Discord, v.v.).
 */
const INTERVAL_MS = 2000;

function startDisconnectCheck(store, broadcast, onDisconnect, options = {}) {
    const getMs =
        typeof options.getDisconnectMs === 'function'
            ? options.getDisconnectMs
            : () =>
                  typeof options.disconnectMs === 'number' && options.disconnectMs >= 3000
                      ? options.disconnectMs
                      : 5000;
    function checkDisconnect() {
        const now = Date.now();
        const timeNow = new Date().toLocaleTimeString('vi-VN');
        let hasChange = false;
        const disconnectMs = getMs();

        store.devices.forEach((d) => {
            if (d.status !== 'disconnected' && (now - (d.lastSeen || 0) > disconnectMs)) {
                d.status = 'disconnected';
                hasChange = true;
                if (typeof onDisconnect === 'function') onDisconnect(d.deviceName || d.deviceId);

                store.updateAlerts((alerts) => {
                    const openAlert = alerts.find((a) => a.deviceId === d.deviceId && !a.endTime);
                    if (openAlert) openAlert.endTime = `${timeNow} (Lost)`;
                });
            }
        });

        if (hasChange) {
            store.trimAlertsIfNeeded();
            broadcast.broadcastFull();
        }
    }

    const intervalId = setInterval(checkDisconnect, INTERVAL_MS);
    return {
        stop() {
            clearInterval(intervalId);
        },
    };
}

module.exports = { startDisconnectCheck };
