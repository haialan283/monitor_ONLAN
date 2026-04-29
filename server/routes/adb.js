const path = require('path');
const fs = require('fs');
const util = require('util');
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');

const execPromise = util.promisify(exec);

/**
 * Tạo router ADB (list, download, upload, delete). Cần uploadDir và adbPath.
 */
function createAdbRouter(uploadDir, adbPath) {
    const router = express.Router();
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const upload = multer({ dest: uploadDir });

    function escapeForSingleQuotes(s) {
        // Nhúng chuỗi vào '...': escape dấu ' để shell không vỡ cú pháp.
        return String(s).replace(/'/g, `'\\''`);
    }

    /** Từ chối path nguy hiểm / không hợp lệ trước khi đưa vào shell. */
    function assertSafeDevicePath(p) {
        const raw = String(p || '').trim();
        if (!raw) return { ok: false, error: 'Empty path' };
        if (raw.includes('\0')) return { ok: false, error: 'Invalid path' };
        if (raw.includes('..')) return { ok: false, error: 'Path traversal not allowed' };
        if (!raw.startsWith('/')) return { ok: false, error: 'Path must be absolute' };
        return { ok: true, path: raw };
    }

    async function runAdbCommand(ip, command) {
        try {
            const connectRes = await execPromise(`"${adbPath}" connect ${ip}:5555`, {
                maxBuffer: 1024 * 1024 * 10,
            });

            const connectOut = (connectRes.stdout || '').toString().toLowerCase();
            const connectErr = (connectRes.stderr || '').toString().toLowerCase();
            const combined = `${connectOut}\n${connectErr}`;

            const ok =
                combined.includes('connected to') ||
                combined.includes('already connected to') ||
                (!combined.includes('failed') && !combined.includes('refused') && combined.includes(`${ip}:5555`));

            if (!ok) {
                return {
                    success: false,
                    error: 'ADB connect failed',
                    detail: connectRes.stdout || connectRes.stderr || '',
                    stdout: connectRes.stdout || '',
                    stderr: connectRes.stderr || '',
                    exitCode: null,
                };
            }
            try {
                const { stdout, stderr } = await execPromise(`"${adbPath}" -s ${ip}:5555 ${command}`, {
                    maxBuffer: 1024 * 1024 * 50,
                });
                return { success: true, stdout, stderr };
            } catch (e2) {
                const errText = `${e2.stderr || ''}\n${e2.stdout || ''}\n${e2.message || ''}`.toLowerCase();
                // Common flaky state: adb shows "already connected" but device is offline.
                if (errText.includes('device offline') || errText.includes('offline')) {
                    try {
                        await execPromise(`"${adbPath}" disconnect ${ip}:5555`);
                        await execPromise(`"${adbPath}" connect ${ip}:5555`, { maxBuffer: 1024 * 1024 * 10 });
                        const { stdout, stderr } = await execPromise(`"${adbPath}" -s ${ip}:5555 ${command}`, {
                            maxBuffer: 1024 * 1024 * 50,
                        });
                        return { success: true, stdout, stderr };
                    } catch (_) {
                        // fall through to generic error return below
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

    // Check thư mục có tồn tại hay không (không tự tạo).
    router.get('/check-dir', async (req, res) => {
        const { ip, dir } = req.query;
        if (!ip || !dir) return res.status(400).json({ exists: false, error: 'Missing ip/dir' });

        const targetDir = String(dir);
        const dirEsc = escapeForSingleQuotes(targetDir);
        // Dùng ls -ld thay cho test -d để tránh false-negative do quyền thực thi.
        // Đồng thời thêm `|| true` để lệnh "không tồn tại" vẫn trả exit code 0,
        // tránh runAdbCommand coi là lỗi và trả 500.
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
     * Xóa file hoặc thư mục trên thiết bị (adb shell rm). Chỉ admin.
     * Nhận tham số từ query (DELETE) hoặc JSON body (POST) — POST dùng cho proxy/IIS hay client không gửi DELETE.
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

    return router;
}

module.exports = { createAdbRouter };
