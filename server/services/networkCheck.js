const dns = require('dns').promises;
const net = require('net');

/**
 * Khởi tạo và chạy kiểm tra mạng định kỳ. Trả về hàm stop() để dừng.
 */
function startNetworkCheck(store, broadcast) {
    let netHistory = [];

    async function checkNetwork() {
        const netConfig = store.getNetConfig();
        if (!netConfig.dns) return;

        const start = Date.now();
        const timeNow = new Date().toLocaleTimeString('vi-VN');

        const dnsPromise = dns.lookup(netConfig.dns).then(() => true).catch(() => false);
        const tcpPromise = netConfig.port
            ? new Promise((res) => {
                  const s = new net.Socket();
                  s.setTimeout(300);
                  s.on('connect', () => {
                      s.destroy();
                      res(true);
                  });
                  s.on('error', () => {
                      s.destroy();
                      res(false);
                  });
                  s.on('timeout', () => {
                      s.destroy();
                      res(false);
                  });
                  s.connect(netConfig.port, netConfig.dns);
              })
            : Promise.resolve(true);

        const [dnsOk, tcpOk] = await Promise.all([dnsPromise, tcpPromise]);
        const result = { dns: dnsOk, tcp: tcpOk, latency: Date.now() - start, time: timeNow };

        const alerts = store.getAlerts();
        if (!dnsOk || !tcpOk) {
            if (!alerts.find((a) => a.deviceId === 'SYSTEM_NET' && !a.endTime)) {
                store.updateAlerts((arr) => {
                    arr.push({
                        deviceId: 'SYSTEM_NET',
                        deviceName: 'NETWORK ERROR',
                        app: `DNS:${dnsOk ? 'OK' : 'FAIL'}|TCP:${tcpOk ? 'OK' : 'FAIL'}`,
                        startTime: timeNow,
                        endTime: null,
                    });
                });
            }
        } else {
            store.updateAlerts((arr) => {
                arr.filter((a) => a.deviceId === 'SYSTEM_NET' && !a.endTime).forEach((a) => (a.endTime = timeNow));
            });
        }

        netHistory.push(result.latency);
        if (netHistory.length > 40) netHistory.shift();
        broadcast.broadcast({ type: 'net_status', ...result, history: netHistory });
    }

    const intervalMs = parseInt(process.env.NET_CHECK_INTERVAL_MS, 10) || 5000;
    const intervalId = setInterval(checkNetwork, intervalMs);
    return {
        stop() {
            clearInterval(intervalId);
        },
    };
}

module.exports = { startNetworkCheck };
