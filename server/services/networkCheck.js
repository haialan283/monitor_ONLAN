const dns = require('dns').promises;
const net = require('net');

function oneLineErr(err) {
    if (!err) return '';
    const code = err.code || '';
    const msg = (err.message || String(err)).replace(/\r?\n/g, ' ').trim();
    const s = [code, msg].filter(Boolean).join(': ').trim();
    return s.slice(0, 500);
}

/**
 * Probe song song DNS lookup + TCP handshake tới host:port (giống phiên bản cũ).
 * tcp fail = không kết nối được tới cổng (từ chối, timeout 300ms, reset, …).
 * port 0 = bỏ qua TCP, chỉ coi DNS.
 */
async function probeTarget(host, port) {
    const start = Date.now();
    const timeNow = new Date().toLocaleTimeString('vi-VN');

    const dnsPromise = dns
        .lookup(host)
        .then(() => ({ ok: true, detail: '' }))
        .catch((e) => ({ ok: false, detail: oneLineErr(e) }));

    const tcpPromise = port
        ? new Promise((res) => {
              const s = new net.Socket();
              let settled = false;
              const done = (payload) => {
                  if (settled) return;
                  settled = true;
                  res(payload);
              };
              s.setTimeout(300);
              s.once('connect', () => {
                  s.destroy();
                  done({ ok: true, detail: '' });
              });
              s.once('error', (err) => {
                  s.destroy();
                  done({ ok: false, detail: oneLineErr(err) });
              });
              s.once('timeout', () => {
                  s.destroy();
                  done({ ok: false, detail: 'ETIMEDOUT: no TCP handshake within 300ms' });
              });
              try {
                  s.connect(port, host);
              } catch (e) {
                  s.destroy();
                  done({ ok: false, detail: oneLineErr(e) });
              }
          })
        : Promise.resolve({ ok: true, detail: '(TCP skipped: port 0)' });

    const [dnsRes, tcpRes] = await Promise.all([dnsPromise, tcpPromise]);
    const dnsOk = dnsRes.ok;
    const tcpOk = tcpRes.ok;
    const dnsDetail = dnsRes.detail || '';
    const tcpDetail = tcpRes.detail || '';

    return {
        dns: dnsOk,
        tcp: tcpOk,
        latency: Date.now() - start,
        time: timeNow,
        dnsDetail,
        tcpDetail,
    };
}

/**
 * Khởi tạo và chạy kiểm tra mạng định kỳ. Trả về hàm stop() để dừng.
 */
function startNetworkCheck(store, broadcast) {
    let netHistory = [];
    let netHistoryRemote = [];
    const intervalMs = parseInt(process.env.NET_CHECK_INTERVAL_MS, 10) || 5000;

    async function checkOne(netConfig, historyArr, alertDeviceId, alertName, broadcastType, lineLabel) {
        const host = netConfig && String(netConfig.dns || '').trim();
        if (!host) return;

        const portNum = Number(netConfig.port) || 0;
        const result = await probeTarget(host, portNum);
        const { dns: dnsOk, tcp: tcpOk, latency, time: timeNow } = result;

        const alerts = store.getAlerts();
        if (!dnsOk || !tcpOk) {
            const summary = `DNS:${dnsOk ? 'OK' : 'FAIL'}|TCP:${tcpOk ? 'OK' : 'FAIL'}`;
            const open = alerts.find((a) => a.deviceId === alertDeviceId && !a.endTime);
            if (!open) {
                store.updateAlerts((arr) => {
                    arr.push({
                        deviceId: alertDeviceId,
                        deviceName: alertName,
                        app: summary,
                        netDnsOk: dnsOk,
                        netTcpOk: tcpOk,
                        netDnsDetail: result.dnsDetail || '',
                        netTcpDetail: result.tcpDetail || '',
                        startTime: timeNow,
                        endTime: null,
                    });
                });
            } else {
                store.updateAlerts((arr) => {
                    const o = arr.find((a) => a.deviceId === alertDeviceId && !a.endTime);
                    if (o) {
                        o.app = summary;
                        o.netDnsOk = dnsOk;
                        o.netTcpOk = tcpOk;
                        o.netDnsDetail = result.dnsDetail || '';
                        o.netTcpDetail = result.tcpDetail || '';
                    }
                });
            }
        } else {
            store.updateAlerts((arr) => {
                arr.filter((a) => a.deviceId === alertDeviceId && !a.endTime).forEach((a) => (a.endTime = timeNow));
            });
        }

        historyArr.push(latency);
        if (historyArr.length > 40) historyArr.shift();
        broadcast.broadcast({
            type: broadcastType,
            line: lineLabel,
            host,
            port: portNum,
            intervalMs,
            ...result,
            history: historyArr.slice(),
        });
    }

    async function checkNetwork() {
        const primary = store.getNetConfig();
        const remote = store.getNetConfigRemote();
        await checkOne(primary, netHistory, 'SYSTEM_NET', 'NETWORK ERROR', 'net_status', 'LAN');
        await checkOne(remote, netHistoryRemote, 'SYSTEM_NET_REMOTE', 'NETWORK REMOTE', 'net_status_remote', 'WAN');
    }
    const intervalId = setInterval(checkNetwork, intervalMs);
    void checkNetwork();

    return {
        stop() {
            clearInterval(intervalId);
        },
        /** Gọi ngay sau khi client SET — không phải đợi hết chu kỳ interval */
        runNow() {
            void checkNetwork();
        },
    };
}

module.exports = { startNetworkCheck };
