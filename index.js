const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process');

// --- 变量配置 ---
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || './tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '9afd1229-b893-40c1-84dd-51e7ce204913';
const NEZHA_SERVER = process.env.NEZHA_SERVER || 'nezhak2.btpp.ggff.net';
const NEZHA_PORT = process.env.NEZHA_PORT || '443';
const NEZHA_KEY = process.env.NEZHA_KEY || 'saaAKqEDlYSu0RGRNX';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || 'shipper';

// --- 立即启动服务 (解决 Health Pending 的关键) ---
app.get("/", (req, res) => res.send("Hello world! Service is running."));

app.listen(PORT, () => {
    console.log(`[OK] Web server is listening on port ${PORT}. Health check ready.`);
    // 启动服务后，在后台执行初始化任务
    main();
});

// --- 初始化与后台进程逻辑 ---
async function main() {
    try {
        console.log("[INIT] Starting background tasks...");
        
        // 创建目录
        if (!fs.existsSync(FILE_PATH)) {
            fs.mkdirSync(FILE_PATH, { recursive: true });
        }

        cleanupOldFiles();
        await generateConfig();
        await downloadFilesAndRun();
        await extractDomains();
        await AddVisitTask();
        
        console.log("[SUCCESS] All background processes are initialized.");
    } catch (error) {
        console.error('[ERROR] Initializing background tasks failed:', error);
    }
}

// --- 以下是原有的辅助功能函数 (保持不变或微调) ---

function generateRandomName() {
    return Math.random().toString(36).substring(2, 8);
}

const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let configPath = path.join(FILE_PATH, 'config.json');

function cleanupOldFiles() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            const files = fs.readdirSync(FILE_PATH);
            files.forEach(file => fs.unlinkSync(path.join(FILE_PATH, file)));
        }
    } catch (err) {}
}

async function generateConfig() {
    const config = {
        log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
        inbounds: [
            { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
            { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
            { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } } },
            { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } } },
            { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } } },
        ],
        outbounds: [{ protocol: "freedom", tag: "direct" }]
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getSystemArchitecture() {
    return os.arch().includes('arm') ? 'arm' : 'amd';
}

async function downloadFile(fileName, fileUrl) {
    const writer = fs.createWriteStream(fileName);
    const response = await axios({ method: 'get', url: fileUrl, responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function downloadFilesAndRun() {
    const architecture = getSystemArchitecture();
    const filesToDownload = architecture === 'arm' 
        ? [ { n: webPath, u: "https://arm64.ssss.nyc.mn/web" }, { n: botPath, u: "https://arm64.ssss.nyc.mn/bot" } ]
        : [ { n: webPath, u: "https://amd64.ssss.nyc.mn/web" }, { n: botPath, u: "https://amd64.ssss.nyc.mn/bot" } ];

    if (NEZHA_SERVER && NEZHA_KEY) {
        const nezhaUrl = architecture === 'arm' ? "https://arm64.ssss.nyc.mn/v1" : "https://amd64.ssss.nyc.mn/v1";
        filesToDownload.push({ n: phpPath, u: nezhaUrl });
    }

    for (const file of filesToDownload) {
        await downloadFile(file.n, file.u);
        fs.chmodSync(file.n, 0o775);
        console.log(`[DOWNLOAD] ${file.n} ready.`);
    }

    // 运行 哪吒
    if (NEZHA_SERVER && NEZHA_KEY) {
        const nezhatls = NEZHA_SERVER.includes('443') ? 'true' : 'false';
        const configYaml = `client_secret: ${NEZHA_KEY}\nserver: ${NEZHA_SERVER}\ntls: ${nezhatls}\nuuid: ${UUID}`;
        fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
        exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`);
    }

    // 运行 Xr-ay
    exec(`nohup ${webPath} -c ${configPath} >/dev/null 2>&1 &`);

    // 运行 Argo
    const argoArgs = ARGO_AUTH.length > 50 
        ? `tunnel --no-autoupdate run --token ${ARGO_AUTH}`
        : `tunnel --no-autoupdate --logfile ${FILE_PATH}/boot.log --url http://localhost:${ARGO_PORT}`;
    exec(`nohup ${botPath} ${argoArgs} >/dev/null 2>&1 &`);
}

async function extractDomains() {
    // 等待日志生成
    await new Promise(r => setTimeout(r, 5000));
    if (ARGO_AUTH && ARGO_DOMAIN) {
        await generateLinks(ARGO_DOMAIN);
    } else {
        try {
            const log = fs.readFileSync(path.join(FILE_PATH, 'boot.log'), 'utf8');
            const match = log.match(/https?:\/\/([^ ]*trycloudflare\.com)/);
            if (match) await generateLinks(match[1]);
        } catch (e) {}
    }
}

async function generateLinks(argoDomain) {
    const nodeName = `${NAME}-${os.hostname()}`;
    const VMESS = { v: '2', ps: nodeName, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain };
    const subTxt = `vless://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=%2Fvless-argo#${nodeName}\nvmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}`;
    
    fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
    app.get(`/${SUB_PATH}`, (req, res) => res.send(Buffer.from(subTxt).toString('base64')));
    console.log(`[LINK] Subscription available at /${SUB_PATH}`);
}

async function AddVisitTask() {
    if (AUTO_ACCESS && PROJECT_URL) {
        try { await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }); } catch (e) {}
    }
}
