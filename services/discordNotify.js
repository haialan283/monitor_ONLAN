const https = require('https');
const http = require('http');

const DISCORD_WEBHOOK_TIMEOUT_MS = parseInt(process.env.DISCORD_WEBHOOK_TIMEOUT_MS, 10) || 20000;

/**
 * Gá»­i thĂ´ng bĂ¡o vi pháº¡m lĂªn Discord qua Webhook.
 * Khi cĂ³ thiáº¿t bá»‹ vi pháº¡m (app khĂ´ng trong whitelist), gá»i hĂ m nĂ y Ä‘á»ƒ nháº¯c trá»ng tĂ i trong kĂªnh.
 * @param {string} webhookUrl - URL webhook Discord (tá»« DISCORD_WEBHOOK_URL). Náº¿u rá»—ng thĂ¬ bá» qua.
 * @param {string} deviceName - TĂªn thiáº¿t bá»‹
 * @param {string} app - Package/app Ä‘ang vi pháº¡m
 */
function notifyViolation(webhookUrl, deviceName, app) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) return;

    const payload = JSON.stringify({
        content: null,
        embeds: [
            {
                title: 'â ï¸ Vi pháº¡m thiáº¿t bá»‹',
                description: `**Thiáº¿t bá»‹:** ${deviceName || 'N/A'}\n**App:** \`${app || 'N/A'}\``,
                color: 0xff6600,
                footer: { text: 'ArenaPulse â€¢ GiĂ¡m sĂ¡t giáº£i Ä‘áº¥u' },
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
 * Gá»­i thĂ´ng bĂ¡o thiáº¿t bá»‹ máº¥t káº¿t ná»‘i lĂªn Discord.
 */
function notifyDisconnect(webhookUrl, deviceName) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) return;

    const payload = JSON.stringify({
        content: null,
        embeds: [
            {
                title: 'đŸ”Œ Máº¥t káº¿t ná»‘i thiáº¿t bá»‹',
                description: `**Thiáº¿t bá»‹:** ${deviceName || 'N/A'}`,
                color: 0x666666,
                footer: { text: 'ArenaPulse' },
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
