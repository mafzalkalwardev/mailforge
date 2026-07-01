import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { MongoBinary } from 'mongodb-memory-server-core';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(root, '.env') });

const downloadDir = path.resolve(root, process.env.MONGOMS_DOWNLOAD_DIR || 'tools/mongodb-binaries');
const dataDir = path.resolve(root, process.env.MAILFORGE_DATA_DIR || 'data');

mkdirSync(downloadDir, { recursive: true });
mkdirSync(path.join(dataDir, 'mongodb'), { recursive: true });

const version = process.env.MONGOMS_VERSION || '7.0.24';
const binaryPath = await MongoBinary.getPath({
    version,
    downloadDir,
});

console.log(`MongoDB ${version} ready at ${binaryPath}`);
console.log(`Portable database folder: ${path.join(dataDir, 'mongodb')}`);
