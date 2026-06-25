const util = require('util');
const { exec } = require('child_process');

const execPromise = util.promisify(exec);

function parseDeviceIp(ipAddress) {
    if (!ipAddress || typeof ipAddress !== 'string') return null;
    const raw = ipAddress.trim();
    if (!raw || raw === '127.0.0.1' || raw === '::1') return null;
    if (raw.includes('::ffff:')) return raw.replace('::ffff:', '').split(':')[0];
    return raw.split(':')[0];
}

async function connectAdbDevice(adbPath, ip, port = 5555) {
    const host = parseDeviceIp(ip) || (typeof ip === 'string' ? ip.trim() : '');
    if (!host) return { ip: host, ok: false, error: 'Invalid IP' };
    const endpoint = `${host}:${port || 5555}`;
    try {
        const connectRes = await execPromise(`"${adbPath}" connect ${endpoint}`, {
            maxBuffer: 1024 * 1024 * 10,
        });
        const combined = `${connectRes.stdout || ''}\n${connectRes.stderr || ''}`.toLowerCase();
        const ok =
            combined.includes('connected to') ||
            combined.includes('already connected to') ||
            (!combined.includes('failed') && !combined.includes('refused') && combined.includes(endpoint));
        return {
            ip: host,
            port: port || 5555,
            endpoint,
            ok,
            detail: (connectRes.stdout || connectRes.stderr || '').trim(),
        };
    } catch (e) {
        return {
            ip: host,
            port: port || 5555,
            endpoint,
            ok: false,
            error: e.message,
            detail: `${e.stdout || ''}\n${e.stderr || ''}`.trim(),
        };
    }
}

async function reconnectAllFromDevices(connectFn, devices, store) {
    const connect = typeof connectFn === 'function' ? connectFn : null;
    if (!connect) return { total: 0, okCount: 0, results: [] };
    const seen = new Set();
    const targets = [];

    (devices || []).forEach((d) => {
        const ip = parseDeviceIp(d && d.ipAddress);
        if (!ip || seen.has(ip)) return;
        seen.add(ip);
        targets.push({
            ip,
            port: 5555,
            deviceId: d.deviceId,
            deviceName: d.deviceName || d.deviceId,
        });
    });

    if (store && typeof store.getAdbEndpoints === 'function') {
        const endpoints = store.getAdbEndpoints();
        Object.entries(endpoints || {}).forEach(([deviceId, ep]) => {
            const ip = parseDeviceIp(ep && ep.ip);
            if (!ip || seen.has(ip)) return;
            seen.add(ip);
            targets.push({
                ip,
                port: (ep && ep.port) || 5555,
                deviceId,
                deviceName: deviceId,
            });
        });
    }

    const results = [];
    for (const t of targets) {
        const r = await connect(t.ip, t.port);
        results.push({
            ...r,
            deviceId: t.deviceId,
            deviceName: t.deviceName,
        });
    }

    return {
        total: targets.length,
        okCount: results.filter((r) => r.ok).length,
        results,
    };
}

function createAdbConnectService(adbPath, adbQueue) {
    const queue = adbQueue || { enqueue: (fn) => fn() };
    const connectQueued = (ip, port) => queue.enqueue(() => connectAdbDevice(adbPath, ip, port));
    return {
        connectAdbDevice: connectQueued,
        reconnectAll: (devices, storeRef) => reconnectAllFromDevices(connectQueued, devices, storeRef),
    };
}

module.exports = {
    createAdbConnectService,
    connectAdbDevice,
    reconnectAllFromDevices,
    parseDeviceIp,
};
