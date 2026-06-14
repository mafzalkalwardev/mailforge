const { isPersistentStorage, isDbReady } = require('../config/db');
const mongoose = require('mongoose');
const axios = require('axios');

async function pingUrl(url, timeoutMs = 3000) {
    if (!url) return { ok: false, error: 'not configured' };
    try {
        const res = await axios.get(url.replace(/\/$/, '') + '/health', { timeout: timeoutMs, validateStatus: () => true });
        return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

const getHealth = async (req, res) => {
    const goUrl = process.env.GO_VERIFIER_URL || `http://localhost:${process.env.VERIFIER_GO_PORT || 8082}`;
    const reacherUrl = process.env.REACHER_URL || 'http://localhost:8081';

    const [go, reacher] = await Promise.all([pingUrl(goUrl), pingUrl(reacherUrl)]);

    res.json({
        status: 'ok',
        version: require('../package.json').version,
        storage: {
            persistent: isPersistentStorage(),
            mode: isPersistentStorage() ? 'mongodb' : 'in-memory',
            warning: isPersistentStorage() ? null : 'Data is lost when the server stops. Set MONGO_URI in .env.',
        },
        database: {
            connected: isDbReady(),
            readyState: mongoose.connection.readyState,
        },
        verifiers: {
            truemailGo: go,
            reacher,
        },
        uptimeSeconds: Math.round(process.uptime()),
    });
};

module.exports = { getHealth };
