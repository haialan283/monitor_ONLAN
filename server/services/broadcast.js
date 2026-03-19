const WebSocket = require('ws');

/**
 * Tạo đối tượng broadcast: gửi payload đã mã hóa tới mọi client WebSocket.
 * @param {WebSocket.Server} wss
 * @param {Function} encryptPayload
 * @param {Function} getState - () => ({ devices, alerts, tableNames })
 */
function createBroadcast(wss, encryptPayload, getState) {
    function broadcast(data) {
        try {
            const msg = encryptPayload(data);
            wss.clients.forEach(c => {
                if (c.readyState === WebSocket.OPEN) c.send(msg);
            });
        } catch (e) {
            console.error('Broadcast encryption error:', e);
        }
    }

    function broadcastFull() {
        const state = getState();
        broadcast({
            type: 'update_all',
            devices: state.devices,
            alerts: state.alerts,
            tableNames: state.tableNames,
        });
    }

    return { broadcast, broadcastFull };
}

module.exports = { createBroadcast };
