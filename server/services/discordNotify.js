const https = require('https');
const http = require('http');

const DISCORD_WEBHOOK_TIMEOUT_MS = parseInt(process.env.DISCORD_WEBHOOK_TIMEOUT_MS, 10) || 20000;

/**
 * Gửi thông báo vi phạm lên Discord qua Webhook.
 * Khi có thiết bị vi phạm (app không trong whitelist), gọi hàm này để nhắc trọng tài trong kênh.
 * @param {string} webhookUrl - URL webhook Discord (từ DISCORD_WEBHOOK_URL). Nếu rỗng thì bỏ qua.
 * @param {string} deviceName - Tên thiết bị
 * @param {string} app - Package/app đang vi phạm
 */
function notifyViolation(webhookUrl, deviceName, app) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) return;

    const payload = JSON.stringify({
        content: null,
        embeds: [
            {
                title: '⚠️ Vi phạm thiết bị',
                description: `**Thiết bị:** ${deviceName || 'N/A'}\n**App:** \`${app || 'N/A'}\``,
                color: 0xff6600,
                footer: { text: 'ALAN Monitor • Giám sát giải đấu' },
                timestamp: new Date().toISOString(),
            },
        ],
    });

    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload, 'utf8'),
        },
    };

    const req = (isHttps ? https : http).request(options, (res) => {
        clearTimeout(timer);
        res.resume();
        if (res.statusCode >= 400) {
            console.error('[Discord] Webhook error:', res.statusCode, res.statusMessage);
        }
    });
    const timer = setTimeout(() => {
        req.destroy();
        console.error('[Discord] Request timeout (webhook violation)');
    }, DISCORD_WEBHOOK_TIMEOUT_MS);
    req.on('error', (err) => {
        clearTimeout(timer);
        console.error('[Discord] Request error:', err.message);
    });
    req.write(payload);
    req.end();
}

/**
 * Gửi thông báo thiết bị mất kết nối lên Discord.
 */
function notifyDisconnect(webhookUrl, deviceName) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) return;

    const payload = JSON.stringify({
        content: null,
        embeds: [
            {
                title: '🔌 Mất kết nối thiết bị',
                description: `**Thiết bị:** ${deviceName || 'N/A'}`,
                color: 0x666666,
                footer: { text: 'ALAN Monitor' },
                timestamp: new Date().toISOString(),
            },
        ],
    });

    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload, 'utf8'),
        },
    };

    const req = (isHttps ? https : http).request(options, (res) => {
        clearTimeout(timer);
        res.resume();
        if (res.statusCode >= 400) console.error('[Discord] Webhook error:', res.statusCode);
    });
    const timer = setTimeout(() => {
        req.destroy();
        console.error('[Discord] Request timeout (webhook disconnect)');
    }, DISCORD_WEBHOOK_TIMEOUT_MS);
    req.on('error', (err) => {
        clearTimeout(timer);
        console.error('[Discord] Request error:', err.message);
    });
    req.write(payload);
    req.end();
}

module.exports = { notifyViolation, notifyDisconnect };
