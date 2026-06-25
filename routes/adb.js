const path = require('path');
const fs = require('fs');
const util = require('util');
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const { connectAdbDevice } = require('../services/adbConnect');
const { createAdbQueue } = require('../services/adbQueue');

const execPromise = util.promisify(exec);

/**
 * Táº¡o router ADB (list, download, upload, delete, reconnect). Cáº§n uploadDir vĂ  adbPath.
 */
function createAdbRouter(uploadDir, adbPath, store, adbService, adbQueue) {
    const router = express.Router();
    const queue = adbQueue || createAdbQueue();
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const upload = multer({ dest: uploadDir });

    function escapeForSingleQuotes(s) {
        // NhĂºng chuá»—i vĂ o '...': escape dáº¥u ' Ä‘á»ƒ shell khĂ´ng vá»¡ cĂº phĂ¡p.
        return String(s).replace(/'/g, `'\\''`);
    }

    /** Tá»« chá»‘i path nguy hiá»ƒm / khĂ´ng há»£p lá»‡ trÆ°á»›c khi Ä‘Æ°a vĂ o shell. */
    function assertSafeDevicePath(p) {
        const raw = String(p || '').trim();
        if (!raw) return { ok: false, error: 'Empty path' };
        if (raw.includes('\0')) return { ok: false, error: 'Invalid path' };
        if (raw.includes('..')) return { ok: false, error: 'Path traversal not allowed' };
        if (!raw.startsWith('/')) return { ok: false, error: 'Path must be absolute' };
        return { ok: true, path: raw };
    }

    async function runAdbCommand(ip, command) {
        return queue.enqueue(() => runAdbCommandInner(ip, command));
    }

    async function runAdbCommandInner(ip, command) {
        try {
            const connectRes = await connectAdbDevice(adbPath, ip, 5555);
            if (!connectRes.ok) {
                return {
                    success: false,
                    error: connectRes.error || 'ADB connect failed',
                    detail: connectRes.detail || '',
                    stdout: '',
                    stderr: connectRes.detail || '',
                    exitCode: null,
                };
            }
            const host = connectRes.ip;
            try {
                const { stdout, stderr } = await execPromise(`"${adbPath}" -s ${host}:5555 ${command}`, {
                    maxBuffer: 1024 * 1024 * 50,
                });
                return { success: true, stdout, stderr };
            } catch (e2) {
                const errText = `${e2.stderr || ''}\n${e2.stdout || ''}\n${e2.message || ''}`.toLowerCase();
                if (errText.includes('device offline') || errText.includes('offline')) {
                    try {
                        await execPromise(`"${adbPath}" disconnect ${host}:5555`);
                        await connectAdbDevice(adbPath, host, 5555);
                        const { stdout, stderr } = await execPromise(`"${adbPath}" -s ${host}:5555 ${command}`, {
                            maxBuffer: 1024 * 1024 * 50,
                        });
                        return { success: true, stdout, stderr };
                    } catch (_) {
                        // fall through
                    }
                }
                throw e2;
            }
        } catch (e) {
            console.error('ADB Error:', e);
            return {
                success: false,
                error: e.message,
                stdout: e.stdout || '',
                stderr: e.stderr || '',
                exitCode: e.code || null,
            };
        }
    }

    router.get('/list', async (req, res) => {
        const { ip, dir } = req.query;
        if (!ip) return res.status(400).json({ error: 'Missing ip' });
        const targetDir = dir || '/storage/emulated/0';

        const result = await runAdbCommand(ip, `shell "ls -1p '${targetDir}'"`);
        if (!result.success) {
            return res.status(500).json({
                error: 'ADB list failed',
                detail: result.error || 'Unknown error',
                stdout: result.stdout || '',
                stderr: result.stderr || '',
                exitCode: result.exitCode || null,
            });
        }

        const out = (result.stdout || '').toString();
        const lines = out.trim() ? out.trim().split(/\r?\n/) : [];
        const files = [];
        lines.forEach((line) => {
            if (!line.trim() || line.includes('No such file')) return;
            const isDir = line.endsWith('/');
            const name = isDir ? line.slice(0, -1) : line;
            if (name === '.' || name === '..') return;
            const filePath = targetDir.endsWith('/') ? `${targetDir}${name}` : `${targetDir}/${name}`;
            files.push({ name, isDir, path: filePath, size: 0 });
        });
        res.json(files);
    });

    // Check thÆ° má»¥c cĂ³ tá»“n táº¡i hay khĂ´ng (khĂ´ng tá»± táº¡o).
    router.get('/check-dir', async (req, res) => {
        const { ip, dir } = req.query;
        if (!ip || !dir) return res.status(400).json({ exists: false, error: 'Missing ip/dir' });

        const targetDir = String(dir);
        const dirEsc = escapeForSingleQuotes(targetDir);
        // DĂ¹ng ls -ld thay cho test -d Ä‘á»ƒ trĂ¡nh false-negative do quyá»n thá»±c thi.
        // Äá»“ng thá»i thĂªm `|| true` Ä‘á»ƒ lá»‡nh "khĂ´ng tá»“n táº¡i" váº«n tráº£ exit code 0,
        // trĂ¡nh runAdbCommand coi lĂ  lá»—i vĂ  tráº£ 500.
        const cmd = `shell "ls -ld '${dirEsc}' 2>&1 || true"`;

        const result = await runAdbCommand(ip, cmd);
        const out = `${result.stdout || ''}\n${result.stderr || ''}`.toString().trim();
        const lower = out.toLowerCase();
        const notFound = lower.includes('no such file') || lower.includes('not found');
        const exists = !notFound;
        // Always return structured response; treat unknown/empty output as "not found" so push won't happen.
        if (!out) {
            return res.json({ exists: false, detail: result.error || 'ADB error (no output)' });
        }
        return res.json({ exists, detail: out });
    });

    router.get('/download', async (req, res) => {
        const { ip, file } = req.query;
        if (!ip || !file) return res.status(400).send('Missing parameter');

        const fileName = path.basename(file);
        const tempPath = path.join(uploadDir, `dl_${Date.now()}_${fileName}`);

        const result = await runAdbCommand(ip, `pull "${file}" "${tempPath}"`);
        if (!result.success) return res.status(500).send(`Pull error: ${result.error}`);

        res.download(tempPath, fileName, (err) => {
            if (err) console.error('Download Error:', err);
            fs.unlink(tempPath, () => {});
        });
    });

    router.post('/upload', upload.single('file'), async (req, res) => {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Viewer mode: read-only' });
        }
        const { ip, dir } = req.body;
        const file = req.file;
        if (!ip || !dir || !file) return res.status(400).send('Missing param');

        const targetPath = dir.endsWith('/') ? `${dir}${file.originalname}` : `${dir}/${file.originalname}`;

        const result = await runAdbCommand(ip, `push "${file.path}" "${targetPath}"`);
        fs.unlink(file.path, () => {});

        if (!result.success) return res.status(500).json({ status: 'error', message: result.error });
        res.json({ status: 'success', path: targetPath });
    });

    /**
     * XĂ³a file hoáº·c thÆ° má»¥c trĂªn thiáº¿t bá»‹ (adb shell rm). Chá»‰ admin.
     * Nháº­n tham sá»‘ tá»« query (DELETE) hoáº·c JSON body (POST) â€” POST dĂ¹ng cho proxy/IIS hay client khĂ´ng gá»­i DELETE.
     */
    async function adbDeleteHandler(req, res) {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Viewer mode: read-only' });
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const ip = (req.query.ip || body.ip || '').toString().trim();
        const devicePath = (req.query.path || body.path || '').toString();
        const isDirRaw = req.query.isDir !== undefined ? req.query.isDir : body.isDir;
        if (!ip || !devicePath) {
            return res.status(400).json({ status: 'error', message: 'Missing ip or path' });
        }
        const safe = assertSafeDevicePath(devicePath);
        if (!safe.ok) {
            return res.status(400).json({ status: 'error', message: safe.error });
        }
        const norm = safe.path.replace(/\/+$/, '') || '/';
        const blockedRoots = ['/storage/emulated/0', '/sdcard', '/storage/emulated', '/storage', '/'];
        if (blockedRoots.includes(norm)) {
            return res.status(400).json({ status: 'error', message: 'Refusing to delete protected root path' });
        }
        const pathEsc = escapeForSingleQuotes(safe.path);
        const asDir = isDirRaw === '1' || isDirRaw === 'true' || isDirRaw === true || isDirRaw === 1;
        const inner = asDir ? `rm -rf '${pathEsc}'` : `rm -f '${pathEsc}'`;
        const result = await runAdbCommand(ip, `shell "${inner}"`);
        if (!result.success) {
            return res.status(500).json({
                status: 'error',
                message: result.error || 'ADB delete failed',
                stdout: result.stdout || '',
                stderr: result.stderr || '',
            });
        }
        res.json({ status: 'success', path: safe.path });
    }

    router.delete('/delete', adbDeleteHandler);
    router.post('/delete', adbDeleteHandler);

    router.post('/reconnect-all', async (req, res) => {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Viewer mode: read-only' });
        }
        if (!adbService || !store) {
            return res.status(503).json({ error: 'ADB service unavailable' });
        }
        const result = await adbService.reconnectAll(store.devices, store);
        res.json(result);
    });

    router.post('/reconnect', async (req, res) => {
        if (req.userRole !== 'admin') {
            return res.status(403).json({ error: 'Viewer mode: read-only' });
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const ip = (req.query.ip || body.ip || '').toString().trim();
        const port = parseInt(req.query.port || body.port || 5555, 10) || 5555;
        if (!ip) return res.status(400).json({ error: 'Missing ip' });
        const result = await connectAdbDevice(adbPath, ip, port);
        res.json(result);
    });

    return router;
}

module.exports = { createAdbRouter };
