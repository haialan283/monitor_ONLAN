const https = require('https');
const http = require('http');

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
        if (res.statusCode >= 400) {
            console.error('[Discord] Webhook error:', res.statusCode, res.statusMessage);
        }
    });
    req.on('error', (err) => console.error('[Discord] Request error:', err.message));
    req.setTimeout(5000, () => {
        req.destroy();
        console.error('[Discord] Request timeout');
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
        if (res.statusCode >= 400) console.error('[Discord] Webhook error:', res.statusCode);
    });
    req.on('error', (err) => console.error('[Discord] Request error:', err.message));
    req.setTimeout(5000, () => { req.destroy(); });
    req.write(payload);
    req.end();
}

/**
 * Gửi yêu cầu đọc TTS tới Discord Voice Bot (bot vào kênh thoại và đọc).
 * @param {string} baseUrl - URL bot (vd. http://localhost:3001)
 * @param {string|null} secret - BOT_SECRET (header X-Bot-Secret), null = không gửi
 * @param {'violation'|'disconnect'} type
 * @param {string} deviceName
 * @param {string} [app] - Chỉ khi type === 'violation'
 */
function announceToVoiceBot(baseUrl, secret, type, deviceName, app) {
    if (!baseUrl || !baseUrl.startsWith('http')) return;

    const url = new URL('/announce', baseUrl);
    const payload = JSON.stringify({ type, deviceName, app: app || '' });
    const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload, 'utf8'),
        },
    };
    if (secret) options.headers['X-Bot-Secret'] = secret;

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
        if (res.statusCode >= 400) console.error('[VoiceBot] Error:', res.statusCode);
    });
    req.on('error', (err) => console.error('[VoiceBot] Request error:', err.message));
    req.setTimeout(5000, () => { req.destroy(); });
    req.write(payload);
    req.end();
}

module.exports = { notifyViolation, notifyDisconnect, announceToVoiceBot };
