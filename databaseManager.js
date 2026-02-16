/**
 * databaseManager.js
 * Quantum Traffic Engine - MongoDB Database Manager
 * Compatible with Inquirer v9+ (ESM)
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs-extra');
const path = require('path');

/* ───────────────────────────── */
/* Inquirer Loader (ESM safe)    */
/* ───────────────────────────── */
let inquirer;
// ✅ CORRECT CODE
async function getInquirer() {
  if (!inquirer) {
    inquirer = (await import('inquirer')).default;
  } // ✅ Closing brace ditambahkan
  return inquirer;
}


/* ───────────────────────────── */
/* Config                        */
/* ───────────────────────────── */
const MONGO_URI = process.env.DB_CONNECTION_STRING;
const BACKUP_ROOT = path.resolve(__dirname, './backup/database');
const PROXY_LIST_FILE = path.resolve(__dirname, './include/ProxyList.txt');

let client;
let db;

/* ───────────────────────────── */
/* Mongo Connection              */
/* ───────────────────────────── */
async function connectDB() {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(); // auto from URI
  console.log('✅ MongoDB connected');
}

/* ───────────────────────────── */
/* Utils                         */
/* ───────────────────────────── */
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/* ───────────────────────────── */
/* BACKUP                        */
/* ───────────────────────────── */
async function backupAllDatabase() {
  const collections = await db.listCollections().toArray();
  const backupDir = path.join(BACKUP_ROOT, timestamp());
  await fs.ensureDir(backupDir);

  for (const col of collections) {
    const data = await db.collection(col.name).find({}).toArray();
    await fs.writeJson(
      path.join(backupDir, `${col.name}.json`),
      data,
      { spaces: 2 }
    );
  }

  console.log(`📦 Backup ALL database selesai`);
  console.log(`📂 Lokasi: ${backupDir}`);
}

async function backupSingleCollection() {
  const iq = await getInquirer();
  const collections = await db.listCollections().toArray();

  const { colName } = await iq.prompt({
    type: 'list',
    name: 'colName',
    message: 'Pilih collection:',
    choices: collections.map(c => c.name)
  });

  const backupDir = path.join(BACKUP_ROOT, timestamp());
  await fs.ensureDir(backupDir);

  const data = await db.collection(colName).find({}).toArray();
  await fs.writeJson(
    path.join(backupDir, `${colName}.json`),
    data,
    { spaces: 2 }
  );

  console.log(`📦 Collection "${colName}" dibackup`);
}

/* ───────────────────────────── */
/* RESTORE                       */
/* ───────────────────────────── */
async function restoreDatabase() {
  const iq = await getInquirer();
  await fs.ensureDir(BACKUP_ROOT);

  const backups = await fs.readdir(BACKUP_ROOT);
  if (!backups.length) {
    console.log('❌ Tidak ada backup ditemukan');
    return;
  }

  const { selected } = await iq.prompt({
    type: 'list',
    name: 'selected',
    message: 'Pilih backup:',
    choices: backups
  });

  const { confirm } = await iq.prompt({
    type: 'confirm',
    name: 'confirm',
    message: '⚠️ Restore akan MENGHAPUS data existing. Lanjut?',
    default: false
  });

  if (!confirm) return;

  const backupPath = path.join(BACKUP_ROOT, selected);
  const files = await fs.readdir(backupPath);

  for (const file of files) {
    const colName = path.basename(file, '.json');
    const data = await fs.readJson(path.join(backupPath, file));

    await db.collection(colName).deleteMany({});
    if (data.length) {
      await db.collection(colName).insertMany(data);
    }
  }

  console.log('♻️ Restore database selesai');
}

/* ───────────────────────────── */
/* PROXY MANIPULATION            */
/* ───────────────────────────── */
async function deleteAllProxies() {
  const iq = await getInquirer();

  const { confirm } = await iq.prompt({
    type: 'confirm',
    name: 'confirm',
    message: '⚠️ Hapus SEMUA proxy?',
    default: false
  });

  if (!confirm) return;

  const res = await db.collection('proxies').deleteMany({});
  console.log(`🗑️ ${res.deletedCount} proxy dihapus`);
}

async function injectProxyList() {
  if (!await fs.pathExists(PROXY_LIST_FILE)) {
    console.log('❌ ProxyList.txt tidak ditemukan');
    return;
  }

  const lines = (await fs.readFile(PROXY_LIST_FILE, 'utf8'))
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    console.log('❌ ProxyList kosong');
    return;
  }

  const proxies = lines.map(line => {
    const [host, port, user, pass] = line.split(':');
    return {
      host,
      port: Number(port),
      user,
      pass,
      usage_count: 0,
      fail_count: 0,
      country: null,
      timezone: null,
      last_check: null,
      created_at: new Date()
    };
  });

  await db.collection('proxies').insertMany(proxies);
  console.log(`➕ ${proxies.length} proxy berhasil diinject`);
}

async function resetProxyCounter() {
  const iq = await getInquirer();

  const { confirm } = await iq.prompt({
    type: 'confirm',
    name: 'confirm',
    message: 'Reset semua counter proxy?',
    default: false
  });

  if (!confirm) return;

  const res = await db.collection('proxies').updateMany(
    {},
    {
      $set: {
        usage_count: 0,
        fail_count: 0,
        last_check: null
      }
    }
  );

  console.log(`🔄 ${res.modifiedCount} proxy direset`);
}

/* ───────────────────────────── */
/* MENU                          */
/* ───────────────────────────── */
async function proxyMenu() {
  const iq = await getInquirer();

  const { action } = await iq.prompt({
    type: 'list',
    name: 'action',
    message: 'Proxy Database Manipulation:',
    choices: [
      'Delete All Proxies',
      'Inject New Proxy List',
      'Reset Proxy Counter',
      'Back'
    ]
  });

  if (action === 'Delete All Proxies') await deleteAllProxies();
  if (action === 'Inject New Proxy List') await injectProxyList();
  if (action === 'Reset Proxy Counter') await resetProxyCounter();
}

async function mainMenu() {
  const iq = await getInquirer();

  while (true) {
    const { menu } = await iq.prompt({
      type: 'list',
      name: 'menu',
      message: 'Database Manager Menu:',
      choices: [
        'Backup All Database',
        'Backup Single Collection',
        'Restore Database',
        'Proxy Database Manipulation',
        'Exit'
      ]
    });

    if (menu === 'Backup All Database') await backupAllDatabase();
    if (menu === 'Backup Single Collection') await backupSingleCollection();
    if (menu === 'Restore Database') await restoreDatabase();
    if (menu === 'Proxy Database Manipulation') await proxyMenu();
    if (menu === 'Exit') break;
  }

  await client.close();
  console.log('👋 DatabaseManager closed');
}

/* ───────────────────────────── */
/* START                         */
/* ───────────────────────────── */
(async () => {
  try {
    await connectDB();
    await mainMenu();
  } catch (err) {
    console.error('❌ Fatal Error:', err);
    process.exit(1);
  }
})();
