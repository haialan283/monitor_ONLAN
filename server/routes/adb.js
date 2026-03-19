const path = require('path');
const fs = require('fs');
const util = require('util');
const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');

const execPromise = util.promisify(exec);

/**
 * Tạo router ADB (list, download, upload). Cần uploadDir và adbPath.
 */
function createAdbRouter(uploadDir, adbPath) {
    const router = express.Router();
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const upload = multer({ dest: uploadDir });

    async function runAdbCommand(ip, command) {
        try {
            await execPromise(`"${adbPath}" connect ${ip}:5555`);
            const { stdout, stderr } = await execPromise(`"${adbPath}" -s ${ip}:5555 ${command}`, {
                maxBuffer: 1024 * 1024 * 50,
            });
            return { success: true, stdout, stderr };
        } catch (e) {
            console.error('ADB Error:', e);
            return { success: false, error: e.message };
        }
    }

    router.get('/list', async (req, res) => {
        const { ip, dir } = req.query;
        if (!ip) return res.status(400).send('Thiếu IP');
        const targetDir = dir || '/storage/emulated/0';

        const result = await runAdbCommand(ip, `shell "ls -1p '${targetDir}'"`);
        if (!result.success) return res.status(500).send(`Error: ${result.error}`);

        const lines = result.stdout.trim().split(/\r?\n/);
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
        const { ip, dir } = req.body;
        const file = req.file;
        if (!ip || !dir || !file) return res.status(400).send('Missing param');

        const targetPath = dir.endsWith('/') ? `${dir}${file.originalname}` : `${dir}/${file.originalname}`;

        const result = await runAdbCommand(ip, `push "${file.path}" "${targetPath}"`);
        fs.unlink(file.path, () => {});

        if (!result.success) return res.status(500).json({ status: 'error', message: result.error });
        res.json({ status: 'success', path: targetPath });
    });

    return router;
}

module.exports = { createAdbRouter };
