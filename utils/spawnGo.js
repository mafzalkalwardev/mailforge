const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

const GO_BASE = process.env.GO_VERIFIER_URL || 'http://localhost:8082';

let goProcess = null;
let startPromise = null;

function isLocalGoUrl() {
    try {
        const url = new URL(GO_BASE);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

function goPortFromEnv() {
    try {
        const url = new URL(GO_BASE);
        return url.port || '8082';
    } catch {
        return '8082';
    }
}

async function isGoHealthy() {
    try {
        const { data } = await axios.get(`${GO_BASE}/health`, { timeout: 3000 });
        return data?.status === 'ok';
    } catch {
        return false;
    }
}

async function ensureGoVerifier() {
    if (!isLocalGoUrl()) return;

    if (await isGoHealthy()) {
        return;
    }

    if (startPromise) {
        return startPromise;
    }

    startPromise = (async () => {
        const goDir = path.join(__dirname, '..', 'backend', 'go');
        const port = goPortFromEnv();

        if (goProcess) {
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (await isGoHealthy()) {
                    console.log('✅ truemail-go ready at', GO_BASE);
                    return;
                }
            }
        }

        console.log(`🚀 Starting truemail-go on port ${port}...`);

        goProcess = spawn('go', ['run', 'main.go'], {
            cwd: goDir,
            stdio: 'inherit',
            shell: true,
            env: { ...process.env, VERIFIER_GO_PORT: port },
        });

        goProcess.on('error', err => {
            console.error('❌ Failed to start Go verifier:', err.message);
            startPromise = null;
        });

        goProcess.on('exit', () => {
            goProcess = null;
            startPromise = null;
        });

        for (let i = 0; i < 45; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (await isGoHealthy()) {
                console.log('✅ truemail-go ready at', GO_BASE);
                return;
            }
        }

        console.warn('⚠️  truemail-go did not respond — install Go 1.22+ from https://go.dev/dl/');
    })();

    return startPromise;
}

function stopGoVerifier() {
    if (goProcess) {
        goProcess.kill();
        goProcess = null;
    }
    startPromise = null;
}

module.exports = { ensureGoVerifier, stopGoVerifier, isGoHealthy };
