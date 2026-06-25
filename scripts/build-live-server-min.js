/**
 * Build live-server-min branch workspace from git-tracked server/ core files.
 * Demo System: no .html in tree (NODE_EXPRESS), package.json without BOM.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const outDir = path.join(repoRoot, '_live_min_root');
const excludePrefixes = ['server/Debug/', 'server/FFWSVN/', 'server/docs/', 'server/node_modules/'];
const excludeFiles = new Set(['server/ffmpeg-8.1.tar.xz']);

const files = execSync('git ls-files server/', { cwd: repoRoot, encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter((f) => f && !excludePrefixes.some((p) => f.startsWith(p)) && !excludeFiles.has(f));

if (fs.existsSync(outDir)) {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {
        fs.renameSync(outDir, `${outDir}.old.${Date.now()}`);
    }
}
fs.mkdirSync(outDir, { recursive: true });

const dashboardViews = [
    ['public/index.html', 'dashboard/monitor.view'],
    ['public/login.html', 'dashboard/signin.view'],
    ['public/admin.html', 'dashboard/admin.view'],
];
for (const [srcRel, destRel] of dashboardViews) {
    const src = path.join(repoRoot, 'server', srcRel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(outDir, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

const templatesDir = path.join(repoRoot, 'server', 'public', 'templates');
const templatesOut = path.join(outDir, 'dashboard', 'templates');
if (fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesOut, { recursive: true });
    for (const name of fs.readdirSync(templatesDir)) {
        fs.copyFileSync(path.join(templatesDir, name), path.join(templatesOut, name));
    }
}

for (const gitPath of files) {
    const rel = gitPath.replace(/^server\//, '');
    let destRel = rel;
    if (rel === 'public/index.html') continue;
    else if (rel === 'public/login.html') continue;
    else if (rel === 'public/admin.html') continue;
    else if (rel.startsWith('public/templates/')) continue;
    else if (rel.startsWith('public/')) continue;

    const src = path.join(repoRoot, gitPath);
    const dest = path.join(outDir, destRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

const configDir = path.join(repoRoot, 'server', 'config');
const configOut = path.join(outDir, 'config');
if (fs.existsSync(configDir)) {
    fs.mkdirSync(configOut, { recursive: true });
    for (const name of fs.readdirSync(configDir)) {
        if (!name.endsWith('.json') && !name.endsWith('.js')) continue;
        const src = path.join(configDir, name);
        const dest = path.join(configOut, name);
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
}

const servicesDir = path.join(repoRoot, 'server', 'services');
const servicesOut = path.join(outDir, 'services');
if (fs.existsSync(servicesDir)) {
    fs.mkdirSync(servicesOut, { recursive: true });
    for (const name of fs.readdirSync(servicesDir)) {
        if (!name.endsWith('.js')) continue;
        const src = path.join(servicesDir, name);
        const dest = path.join(servicesOut, name);
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    }
}

let indexJs = fs.readFileSync(path.join(outDir, 'index.js'), 'utf8');
const dashboardDirDecl = `const dashboardDir = path.join(__dirname, 'dashboard');
const sendDashboard = (file) => (_req, res) => {
    res.type('html');
    res.sendFile(path.join(dashboardDir, file));
};`;
const adminRoute = `app.get('/admin.html', (req, res) => {
    if (req.userRole !== 'admin') {
        return res.status(403).type('html').send(
            '<!DOCTYPE html><html><body style="background:#0b0d12;color:#8b93a7;font-family:Inter,sans-serif;padding:2rem">' +
            '<p>Chỉ tài khoản <b style="color:#3d8bfd">admin</b> mới vào được trang này.</p>' +
            '<p><a href="/" style="color:#22c55e">← Quay lại Dashboard</a></p></body></html>'
        );
    }
    sendDashboard('admin.view')(req, res);
});`;
const dashboardTail = `app.get('/', sendDashboard('monitor.view'));
app.get('/index.html', (_req, res) => res.redirect('/'));
app.use('/templates', express.static(path.join(dashboardDir, 'templates')));`;

indexJs = indexJs.replace(/const publicDir = path\.join\(__dirname, 'public'\);\n\n?/, '');
indexJs = indexJs.replace(
    /app\.get\('\/login\.html',[\s\S]*?login\.html'\)\);\s*\}\);/,
    `${dashboardDirDecl}\napp.get('/login.html', sendDashboard('signin.view'));`
);
indexJs = indexJs.replace(
    /app\.get\('\/admin\.html',[\s\S]*?admin\.html'\)\);\s*\}\);/,
    adminRoute
);
indexJs = indexJs.replace(
    /app\.get\('\/',[\s\S]*?app\.use\(express\.static\((?:path\.join\(__dirname, 'public'\)|publicDir)\)\);/,
    dashboardTail
);
if (!indexJs.includes("sendDashboard('monitor.view')")) {
    console.error('FATAL: live index.js patch failed — dashboard routes missing');
    process.exit(1);
}
indexJs = indexJs.replace(/const publicDir = path\.join\(__dirname, 'public'\);\r?\n/, '');
fs.writeFileSync(path.join(outDir, 'index.js'), indexJs);

const pkgLock = path.join(repoRoot, 'server', 'package-lock.json');
if (fs.existsSync(pkgLock)) fs.copyFileSync(pkgLock, path.join(outDir, 'package-lock.json'));

const pkg = {
    name: 'arena-pulse-server',
    version: '1.0.0',
    private: true,
    main: 'server.js',
    scripts: { start: 'node server.js' },
    engines: { node: '>=20' },
    dependencies: {
        axios: '^1.13.5',
        dotenv: '^16.4.5',
        express: '^5.2.1',
        lowdb: '^1.0.0',
        multer: '^2.1.1',
        ws: '^8.19.0',
    },
};
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

const demoSystem = {
    projectType: 'NODE',
    installCommand: 'npm ci',
    startCommand: 'node server.js',
    port: 3000,
};
fs.writeFileSync(path.join(outDir, 'demo-system.json'), JSON.stringify(demoSystem, null, 2) + '\n');

const dockerfile = `# ArenaPulse — deploy from server/ (live-server-min)
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data uploads
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
`;
fs.writeFileSync(path.join(outDir, 'Dockerfile'), dockerfile);

console.log('Built', outDir, 'files:', fs.readdirSync(outDir, { recursive: true }).length);
