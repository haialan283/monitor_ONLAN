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
            const msgEncrypted = encryptPayload(data);
            const msgPlain = JSON.stringify(data);
            wss.clients.forEach(c => {
                if (c.readyState !== WebSocket.OPEN) return;
                if (c._alanPlainWs === true) c.send(msgPlain);
                else c.send(msgEncrypted);
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
