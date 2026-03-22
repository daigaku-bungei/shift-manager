/**
 * シフト管理システム - データ層
 * PostgreSQL（JSONB）による永続化 + data.jsonフォールバック
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const COLLECTIONS = ['shifts', 'members', 'responses', 'pairings', 'schedules', 'invites'];

// PostgreSQL接続プール
let pool = null;
let useDB = false;

// メモリキャッシュ（同期readData互換用）
let _cachedData = null;

function initPool() {
    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: (process.env.NODE_ENV === 'production' || process.env.RENDER)
                ? { rejectUnauthorized: false }
                : false
        });
        useDB = true;
        console.log('📦 PostgreSQL モード（データ永続化）');
    } else {
        console.log('📁 ファイルモード（data.json）');
    }
}

// テーブル作成＆初期データ投入
async function initDB() {
    if (!useDB) return;

    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS app_data (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL DEFAULT '[]'::jsonb,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        for (const col of COLLECTIONS) {
            await client.query(`
                INSERT INTO app_data (key, value)
                VALUES ($1, '[]'::jsonb)
                ON CONFLICT (key) DO NOTHING
            `, [col]);
        }
        console.log('✅ データベーステーブル初期化完了');
    } finally {
        client.release();
    }
}

// --- DB読み書き ---
async function readDataDB() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT key, value FROM app_data');
        const data = {};
        COLLECTIONS.forEach(col => { data[col] = []; });
        result.rows.forEach(row => {
            data[row.key] = row.value;
        });
        return data;
    } finally {
        client.release();
    }
}

async function writeDataDB(data) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const col of COLLECTIONS) {
            if (data[col] !== undefined) {
                await client.query(
                    `INSERT INTO app_data (key, value, updated_at) 
                     VALUES ($1, $2, NOW()) 
                     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                    [col, JSON.stringify(data[col])]
                );
            }
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// --- ファイル読み書き（フォールバック） ---
function readDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = {};
        COLLECTIONS.forEach(col => { initial[col] = []; });
        fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeDataFile(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// --- 公開インターフェース（同期） ---
function readData() {
    if (useDB) {
        return _cachedData || readDataFile();
    }
    return readDataFile();
}

function writeData(data) {
    if (useDB) {
        // キャッシュ即時更新 → DB非同期書込み
        _cachedData = JSON.parse(JSON.stringify(data));
        writeDataDB(data).catch(err => {
            console.error('❌ DB書込みエラー:', err.message);
        });
    } else {
        writeDataFile(data);
    }
}

// 起動時にDBからキャッシュにロード
async function loadCache() {
    if (useDB) {
        _cachedData = await readDataDB();
        console.log('📋 データキャッシュ読込完了 (' +
            COLLECTIONS.map(c => `${c}: ${(_cachedData[c] || []).length}`).join(', ') + ')');
    }
}

// data.json → PostgreSQL マイグレーション
async function migrateFromFile() {
    if (!useDB) return;

    const dbData = await readDataDB();
    const hasData = COLLECTIONS.some(col => dbData[col] && dbData[col].length > 0);

    if (!hasData && fs.existsSync(DATA_FILE)) {
        console.log('📤 data.json → PostgreSQL マイグレーション中...');
        const fileData = readDataFile();
        await writeDataDB(fileData);
        _cachedData = fileData;
        console.log('✅ マイグレーション完了');
    }
}

module.exports = {
    initPool,
    initDB,
    loadCache,
    migrateFromFile,
    readData,
    writeData
};
