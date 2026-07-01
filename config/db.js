const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const fs = require('fs');

let mongod = null;
let dbReady = false;
let connectPromise = null;
let storageMode = 'unknown';
let storageUri = '';

const ROOT = path.join(__dirname, '..');

function appPath(value, fallback) {
    const selected = value || fallback;
    return path.isAbsolute(selected) ? selected : path.resolve(ROOT, selected);
}

const DATA_DIR = appPath(process.env.MAILFORGE_DATA_DIR, 'data');
const EMBEDDED_DB_PATH = appPath(process.env.MAILFORGE_MONGO_DB_PATH, path.join(DATA_DIR, 'mongodb'));
const EMBEDDED_BINARY_DIR = appPath(process.env.MONGOMS_DOWNLOAD_DIR, path.join('tools', 'mongodb-binaries'));

function maskUri(uri) {
    return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

function buildConnectionCandidates() {
    const candidates = [];
    if (process.env.MONGO_URI) candidates.push(process.env.MONGO_URI.trim());
    return [...new Set(candidates.filter(Boolean))];
}

async function tryConnect(uri) {
    await mongoose.disconnect().catch(() => {});
    return mongoose.connect(uri, {
        serverSelectionTimeoutMS: 6000,
        connectTimeoutMS: 6000,
    });
}

async function connectEmbeddedMongo() {
    fs.mkdirSync(EMBEDDED_DB_PATH, { recursive: true });
    fs.mkdirSync(EMBEDDED_BINARY_DIR, { recursive: true });

    mongod = await MongoMemoryServer.create({
        instance: {
            ip: '127.0.0.1',
            dbName: 'mailforge',
            dbPath: EMBEDDED_DB_PATH,
            storageEngine: 'wiredTiger',
        },
        binary: {
            downloadDir: EMBEDDED_BINARY_DIR,
        },
    });

    const uri = mongod.getUri('mailforge');
    const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
    });

    dbReady = true;
    storageMode = 'embedded-mongodb';
    storageUri = uri;
    console.log(`Embedded MongoDB connected (portable): ${conn.connection.host}/${conn.connection.name}`);
    console.log(`MongoDB data folder: ${EMBEDDED_DB_PATH}`);
}

async function connectExternalMongo() {
    const candidates = buildConnectionCandidates();

    for (const uri of candidates) {
        try {
            const conn = await tryConnect(uri);
            dbReady = true;
            storageMode = 'external-mongodb';
            storageUri = uri;
            console.log(`MongoDB connected (external): ${conn.connection.host}/${conn.connection.name}`);
            return;
        } catch (error) {
            console.warn(`MongoDB unavailable at ${maskUri(uri)} - ${error.message}`);
        }
    }

    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
        throw new Error('No external MongoDB available. Remove MAILFORGE_DB_MODE=external to use embedded portable MongoDB.');
    }

    console.warn('');
    console.warn('*** WARNING: Falling back to IN-MEMORY database - all data will be lost on restart ***');
    console.warn('*** Fix: remove MAILFORGE_DB_MODE=external, or set a reachable MONGO_URI in .env ***');
    console.warn('');

    mongod = await MongoMemoryServer.create({
        instance: { ip: '127.0.0.1' },
    });
    const uri = mongod.getUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    dbReady = true;
    storageMode = 'in-memory';
    storageUri = uri;
    console.log(`In-memory MongoDB ready at ${uri}`);
}

async function connectDBOnce() {
    const dbMode = String(process.env.MAILFORGE_DB_MODE || 'embedded').toLowerCase();
    if (dbMode === 'external') {
        await connectExternalMongo();
        return;
    }

    await connectEmbeddedMongo();
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
    return storageMode === 'embedded-mongodb' || storageMode === 'external-mongodb';
}

function getStorageMode() {
    return storageMode;
}

function getStorageInfo() {
    return {
        mode: storageMode,
        uri: storageUri,
        dataDir: storageMode === 'embedded-mongodb' ? EMBEDDED_DB_PATH : null,
        binaryDir: storageMode === 'embedded-mongodb' ? EMBEDDED_BINARY_DIR : null,
    };
}

process.on('SIGINT', async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop({ doCleanup: false });
    process.exit(0);
});

module.exports = connectDB;
module.exports.isDbReady = isDbReady;
module.exports.isPersistentStorage = isPersistentStorage;
module.exports.getStorageMode = getStorageMode;
module.exports.getStorageInfo = getStorageInfo;
