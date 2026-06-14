const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;
let dbReady = false;
let connectPromise = null;
let storageMode = 'unknown';

function maskUri(uri) {
    return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

function buildConnectionCandidates() {
    const localDefault = process.env.MONGO_LOCAL_URI || 'mongodb://127.0.0.1:27017/mailforge';
    const candidates = [];

    if (process.env.MONGO_URI) candidates.push(process.env.MONGO_URI.trim());
    if (!candidates.includes(localDefault)) candidates.push(localDefault);

    return [...new Set(candidates.filter(Boolean))];
}

async function tryConnect(uri) {
    await mongoose.disconnect().catch(() => {});
    return mongoose.connect(uri, {
        serverSelectionTimeoutMS: 6000,
        connectTimeoutMS: 6000,
    });
}

async function connectDBOnce() {
    const candidates = buildConnectionCandidates();

    for (const uri of candidates) {
        try {
            const conn = await tryConnect(uri);
            dbReady = true;
            storageMode = 'mongodb';
            console.log(`MongoDB connected (persistent): ${conn.connection.host}/${conn.connection.name}`);
            return;
        } catch (error) {
            console.warn(`MongoDB unavailable at ${maskUri(uri)} — ${error.message}`);
        }
    }

    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
        throw new Error(
            'No MongoDB available. Start local DB with: npm run mongo:up — or set a reachable MONGO_URI.'
        );
    }

    console.warn('');
    console.warn('*** WARNING: Falling back to IN-MEMORY database — all data will be lost on restart ***');
    console.warn('*** Fix: run "npm run mongo:up" then restart the app (or set MONGO_URI in .env) ***');
    console.warn('');

    mongod = await MongoMemoryServer.create({
        instance: { ip: '127.0.0.1' },
    });
    const uri = mongod.getUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    dbReady = true;
    storageMode = 'in-memory';
    console.log(`In-memory MongoDB ready at ${uri}`);
}

const connectDB = async () => {
    if (dbReady && mongoose.connection.readyState === 1) return;
    if (!connectPromise) connectPromise = connectDBOnce();
    return connectPromise;
};

function isDbReady() {
    return dbReady && mongoose.connection.readyState === 1;
}

function isPersistentStorage() {
    return storageMode === 'mongodb';
}

function getStorageMode() {
    return storageMode;
}

process.on('SIGINT', async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
});

module.exports = connectDB;
module.exports.isDbReady = isDbReady;
module.exports.isPersistentStorage = isPersistentStorage;
module.exports.getStorageMode = getStorageMode;
