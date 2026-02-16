// profileManager.js (v5.2 - Custom Naming Convention)

const fs = require('fs');
const path = require('path');
const config = require('./config.js');

const DB_PATH = path.join(config.SESSIONS_DIR, 'session_db.json');

function parseProfileName(folderName) {
  const match = folderName.match(/^([A-Z0-9]{2,6})_(\d{4})_([a-zA-Z0-9]+)_(\d{13})$/);
  if (!match) {
      // Fallback old format
      const oldMatch = folderName.match(/^([A-Z0-9]{2,6})_(\d{4})_(\d{13})$/);
      if (oldMatch) {
          return {
              profileId: folderName,
              region: oldMatch[1],
              id: parseInt(oldMatch[2], 10),
              browser: 'Unknown',
              createdAt: new Date(parseInt(oldMatch[3], 10)).toISOString()
          };
      }
      return null;
  }

  const [_, region, id, browser, timestampMs] = match;
  return {
    profileId: folderName,
    region: region,
    id: parseInt(id, 10),
    browser: browser,
    createdAt: new Date(parseInt(timestampMs, 10)).toISOString()
  };
}

function saveDatabase(db) {
  try {
    if (!fs.existsSync(config.SESSIONS_DIR)) {
      fs.mkdirSync(config.SESSIONS_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error(`[ProfileManager] FAILED to save database: ${e.message}`);
  }
}

function recreateDatabase() {
  const newDb = [];
  try {
    if (!fs.existsSync(config.SESSIONS_DIR)) {
      fs.mkdirSync(config.SESSIONS_DIR, { recursive: true });
      saveDatabase(newDb);
      return newDb;
    }
    const folders = fs.readdirSync(config.SESSIONS_DIR, { withFileTypes: true });
    for (const dirent of folders) {
      if (!dirent.isDirectory()) continue;
      const parsed = parseProfileName(dirent.name);
      if (parsed) newDb.push(parsed);
    }
    newDb.sort((a, b) => b.id - a.id);
    saveDatabase(newDb);
    return newDb;
  } catch (err) { return []; }
}

function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) return recreateDatabase();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const db = JSON.parse(raw);
    if (!Array.isArray(db)) return recreateDatabase();
    return db;
  } catch (err) { return recreateDatabase(); }
}

function createProfile(db, region, browserName = 'Unknown') {
  const now = Date.now();
  const nextId = db.length > 0 ? Math.max(...db.map(p => p.id)) + 1 : 1;
  const safeBrowser = browserName.replace(/[^a-zA-Z0-9]/g, '');
  const profileId = `${region}_${nextId.toString().padStart(4, '0')}_${safeBrowser}_${now}`;

  const newProfile = {
    profileId,
    region,
    id: nextId,
    browser: safeBrowser,
    createdAt: new Date(now).toISOString()
  };

  const profilePath = path.join(config.SESSIONS_DIR, profileId);
  try {
    if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });
    return newProfile;
  } catch (err) { return null; }
}

function getMatureProfiles(db, minAgeHours) {
  const now = Date.now();
  const minAgeMs = minAgeHours * 60 * 60 * 1000;
  return db.filter(profile => {
    const createdMs = new Date(profile.createdAt).getTime();
    return (now - createdMs) >= minAgeMs;
  });
}

module.exports = { loadDatabase, saveDatabase, recreateDatabase, createProfile, getMatureProfiles };