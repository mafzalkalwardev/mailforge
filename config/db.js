const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;
let dbReady = false;
let connectPromise = null;

async function connectDBOnce() {
    if (process.env.MONGO_URI) {
        try {
            const conn = await mongoose.connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 8000,
            });
            dbReady = true;
            console.log(`MongoDB connected: ${conn.connection.host}`);
            return;
        } catch (error) {
            console.warn(`MongoDB URI failed (${error.message}).`);
            if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw error;
        }
    }

    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
        throw new Error('MONGO_URI is required in production. Add a MongoDB Atlas URI in Vercel environment variables.');
    }

    mongod = await MongoMemoryServer.create({
        instance: { ip: '127.0.0.1' },
    });
    const uri = mongod.getUri();
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    dbReady = true;
    console.log(`In-memory MongoDB ready at ${uri}`);
    console.log('Data resets when you stop the server. Set MONGO_URI for persistent data.');
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
    return Boolean(process.env.MONGO_URI);
}

process.on('SIGINT', async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
});

module.exports = connectDB;
module.exports.isDbReady = isDbReady;
module.exports.isPersistentStorage = isPersistentStorage;
