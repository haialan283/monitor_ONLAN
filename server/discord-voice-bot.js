/**
 * Bot Discord tham gia kênh thoại và đọc TTS khi có vi phạm / mất kết nối.
 * Chạy riêng: npm run voice-bot (cần DISCORD_BOT_TOKEN, DISCORD_VOICE_CHANNEL_ID trong .env).
 * Server chính gửi POST đến BOT_HTTP_PORT (mặc định 3001) để yêu cầu đọc.
 * Yêu cầu: FFmpeg cài trên máy (để phát MP3 trong Discord). Xem docs/DISCORD_VOICE_BOT.md.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const googleTTS = require('google-tts-api');

const BOT_HTTP_PORT = parseInt(process.env.BOT_HTTP_PORT, 10) || 3001;
const BOT_SECRET = process.env.BOT_SECRET && process.env.BOT_SECRET.trim() ? process.env.BOT_SECRET.trim() : null;
const TTS_LANG = 'vi';

let voiceChannelId = null;
let guildId = null;
let audioPlayer = null;
let client = null;

function getTempMp3Path() {
    return path.join(os.tmpdir(), `alan-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
}

function buildAnnounceText(type, deviceName, app) {
    const name = deviceName || 'Không rõ';
    if (type === 'violation') {
        return `Cảnh báo vi phạm. Thiết bị ${name}. Ứng dụng ${app || 'không rõ'}.`;
    }
    if (type === 'disconnect') {
        return `Thiết bị ${name} mất kết nối.`;
    }
    return `Thông báo. Thiết bị ${name}.`;
}

async function getTTSBuffer(text) {
    if (!text || text.length > 200) {
        const chunks = [];
        for (let i = 0; i < text.length; i += 200) chunks.push(text.slice(i, i + 200));
        const bases = await Promise.all(
            chunks.map((chunk) => googleTTS.getAudioBase64(chunk, { lang: TTS_LANG, timeout: 8000 }))
        );
        return Buffer.concat(bases.map((b) => Buffer.from(b, 'base64')));
    }
    const base64 = await googleTTS.getAudioBase64(text, { lang: TTS_LANG, timeout: 8000 });
    return Buffer.from(base64, 'base64');
}

function playTTS(text) {
    return new Promise(async (resolve, reject) => {
        const connection = getVoiceConnection(guildId);
        if (!connection || !audioPlayer) {
            reject(new Error('Chưa kết nối voice'));
            return;
        }

        let tmpPath = null;
        try {
            const buffer = await getTTSBuffer(text);
            tmpPath = getTempMp3Path();
            fs.writeFileSync(tmpPath, buffer);

            const resource = createAudioResource(tmpPath, { inlineVolume: true });
            if (resource.volume) resource.volume.setVolume(0.8);

            const onFinish = () => {
                audioPlayer.removeListener(AudioPlayerStatus.Idle, onFinish);
                if (tmpPath && fs.existsSync(tmpPath)) {
                    try { fs.unlinkSync(tmpPath); } catch (_) {}
                }
                resolve();
            };
            audioPlayer.once(AudioPlayerStatus.Idle, onFinish);
            audioPlayer.play(resource);
        } catch (err) {
            if (tmpPath && fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch (_) {}
            }
            reject(err);
        }
    });
}

async function getVoiceChannel() {
    let channel = client.channels.cache.get(voiceChannelId);
    if (!channel) channel = await client.channels.fetch(voiceChannelId).catch(() => null);
    return channel;
}

function ensureInVoice() {
    const connection = getVoiceConnection(guildId);
    if (connection) return Promise.resolve(connection);
    return Promise.reject(new Error('Chưa có kết nối voice'));
}

async function handleAnnounce(body) {
    const { type, deviceName, app } = body;
    const text = buildAnnounceText(type, deviceName, app);
    await ensureInVoice();
    await playTTS(text);
}

function main() {
    const token = process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN.trim();
    const channelId = process.env.DISCORD_VOICE_CHANNEL_ID && process.env.DISCORD_VOICE_CHANNEL_ID.trim();
    if (!token || !channelId) {
        console.error('Cần đặt DISCORD_BOT_TOKEN và DISCORD_VOICE_CHANNEL_ID trong .env. Thoát.');
        process.exit(1);
    }

    voiceChannelId = channelId;
    client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    audioPlayer = createAudioPlayer();

    const onReady = async () => {
        const channel = await getVoiceChannel();
        if (!channel) {
            console.error('Không tìm thấy kênh với ID:', voiceChannelId, '- Kiểm tra: bot đã được mời vào server chưa? ID có đúng là kênh thoại (Voice) không?');
            return;
        }
        if (channel.type !== ChannelType.GuildVoice) {
            console.error('ID không phải kênh thoại (Voice). Chuột phải kênh thoại trong Discord → Sao chép ID.');
            return;
        }
        guildId = channel.guild.id;
        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });
            connection.subscribe(audioPlayer);
            console.log('Bot đã vào kênh thoại:', channel.name);
        } catch (e) {
            console.error('Lỗi vào kênh thoại:', e.message);
        }
    };
    client.once('clientReady', onReady);

    const httpServer = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/announce') {
            res.writeHead(404);
            res.end();
            return;
        }
        if (BOT_SECRET) {
            const auth = req.headers['x-bot-secret'] || req.headers['authorization'];
            const secret = (typeof auth === 'string' && auth.startsWith('Bearer ')) ? auth.slice(7) : auth;
            if (secret !== BOT_SECRET) {
                res.writeHead(401);
                res.end();
                return;
            }
        }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            let data;
            try {
                data = JSON.parse(body);
            } catch (_) {
                res.writeHead(400);
                res.end();
                return;
            }
            handleAnnounce(data)
                .then(() => {
                    res.writeHead(200);
                    res.end();
                })
                .catch((err) => {
                    console.error('Announce error:', err.message);
                    res.writeHead(500);
                    res.end();
                });
        });
    });

    httpServer.listen(BOT_HTTP_PORT, '127.0.0.1', () => {
        console.log('Discord Voice Bot HTTP đang lắng trên port', BOT_HTTP_PORT);
    });

    client.login(token).catch((err) => {
        console.error('Đăng nhập Discord thất bại:', err.message);
        process.exit(1);
    });
}

main();
