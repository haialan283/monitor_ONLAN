const crypto = require('crypto');

const IV_LENGTH = 16;

function createCrypto(getSecretKey) {
    function getKey() {
        const raw = getSecretKey();
        return crypto.createHash('sha256').update(raw).digest();
    }

    function encryptPayload(dataObj) {
        const text = JSON.stringify(dataObj);
        const iv = crypto.randomBytes(IV_LENGTH);
        const key = getKey();
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return iv.toString('hex') + ':' + encrypted;
    }

    function decryptPayload(text) {
        const parts = text.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = Buffer.from(parts.join(':'), 'base64');
        const key = getKey();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    }

    return { encryptPayload, decryptPayload };
}

module.exports = { createCrypto, IV_LENGTH };
