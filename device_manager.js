/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * DEVICE MANAGER V7.4.0 - IDENTITY NORMALIZATION (IP VALIDATOR AS SOURCE OF TRUTH)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * 🔥 CHANGELOG V7.4.0 (2026-02-17 07:34 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ CRITICAL FIX: Local & Regional Language Leak Eliminated
 *    - ADDED: alignIdentityWithNetwork() method (NEW - Line ~187-267)
 *    - REASON: Fragmented authority between opsi4.js and DeviceManager caused locale/timezone mismatch
 *    - SOLUTION: Centralized normalization logic in DeviceManager
 *    - IMPACT: Perfect sync between IP geolocation and local PC fingerprint
 * 
 * ✅ NEW METHOD: alignIdentityWithNetwork(fp, networkData)
 *    - INPUT: Fingerprint object + Raw data from C++ IP Validator
 *    - PROCESS: Cross-check with regions database → Normalize locale/timezone/languages/geolocation
 *    - OUTPUT: Mutated fingerprint object with aligned identity
 *    - VALIDATION: Strict format enforcement (e.g., 'id-ID' not 'id_ID')
 * 
 * 🎯 LOGIC FLOW:
 *    1. IP Validator provides raw data (ip, country, region, city, timezone, lat, lon)
 *    2. DeviceManager queries regions collection for standardization
 *    3. Locale format enforced from database (strict match)
 *    4. Timezone kept from IP Validator (IP is King)
 *    5. Geolocation (lat/lon) overridden with IP accuracy
 *    6. Languages array normalized ([locale, shortLang])
 * 
 * 🔒 AUTHORITY HIERARCHY:
 *    1. IP Validator (Source of Truth for network identity)
 *    2. Regions Database (Source of Truth for locale format)
 *    3. DeviceManager (Executor & Normalizer)
 *    4. Fingerprint (Receiver of normalized data)
 * 
 * ✅ COMPATIBILITY: NO BREAKING CHANGES
 *    - All existing methods unchanged (100% backward compatible)
 *    - New method is additive only
 *    - No modifications to existing function signatures
 * 
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * PREVIOUS CHANGELOG V7.3.0 (2026-02-17 00:40 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ ENHANCEMENT: Robust Error Handling
 * ✅ ENHANCEMENT: Input Validation
 * ✅ ENHANCEMENT: Logging Consistency
 * ✅ ENHANCEMENT: Defensive Programming
 * ✅ COMPATIBILITY: NO BREAKING CHANGES
 * 
 * PREVIOUS CHANGELOG V7.2.1 (2026-02-15 05:20 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ FIXED: Module Export Type (Singleton Instance)
 * 
 * PREVIOUS CHANGELOG V7.2.0 (2026-02-14 16:30 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ FEATURE: Multi-Engine Logic (Chromium/Gecko/WebKit)
 * ✅ FEATURE: Firefox/Gecko Specifics (oscpu, buildID)
 * ✅ FEATURE: Intelligent WebGL Fallbacks
 * ✅ FEATURE: Full Deep Data Passthrough
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */

const { MongoClient } = require('mongodb');
const os = require('os');
const { execSync } = require('child_process');
const StealthFont = require('./stealth_font');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ✅ V15.0.0: OS-BROWSER COMPATIBILITY MATRIX (HARD RULES)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
const OS_BROWSER_COMPATIBILITY_MATRIX = {
  windows: {
    chrome: true,
    edge: true,
    firefox: true,
    safari: false,
    opera: true
  },
  macos: {
    chrome: true,
    edge: true,
    firefox: true,
    safari: true,
    opera: true
  },
  linux: {
    chrome: true,
    edge: true,
    firefox: true,
    safari: false,
    opera: true
  }
};

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DEVICE MANAGER CLASS
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
class DeviceManager {
  constructor(config = {}) {
    this.config = {
      mongoUri: config.mongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
      dbName: config.dbName || 'QuantumTrafficDB',
      
      hardwareCollection: config.hardwareCollection || 'hardware_profiles',
      fingerprintsCollections: config.fingerprintsCollections || {
        chrome: 'fingerprints_chrome',
        edge: 'fingerprints_edge',
        firefox: 'fingerprints_firefox',
        safari: 'fingerprints_safari'
      },
      useragentCollection: config.useragentCollection || 'useragent_selector',
      
      fontDatabaseCollection: config.fontDatabaseCollection || 'font_database',
      fontPersonaCollection: config.fontPersonaCollection || 'font_persona',
      
      browserSelectionMode: config.browserSelectionMode || 'auto',
      
      tierWeights: config.tierWeights || {
        0: 50, 1: 30, 2: 12, 3: 5, 4: 2, 5: 1
      }
    };

    this.client = null;
    this.db = null;
    this.collections = {};
    this.hostPlatform = null;
    this.marketShareCache = null;
    this.fontManager = null;
    
    this.osCompatibilityMatrix = OS_BROWSER_COMPATIBILITY_MATRIX;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async initialize() {
    if (this.client) {
      console.log('[DeviceManager] Already initialized');
      return;
    }

    console.log('[DeviceManager] Initializing V7.4.0 (Identity Normalization)...');

    // 1. Detect host platform
    try {
      this.hostPlatform = this.getHostPlatform();
      console.log(`[DeviceManager] Host: ${this.hostPlatform.platform} ${this.hostPlatform.version} (${this.hostPlatform.arch})`);
    } catch (error) {
      console.error(`[DeviceManager] ❌ Platform detection failed: ${error.message}`);
      throw new Error(`Platform detection failed: ${error.message}`);
    }

    // 2. Connect to MongoDB
    const mongoUri = process.env.DB_CONNECTION_STRING || this.config.mongoUri;
    
    try {
      this.client = new MongoClient(mongoUri);
      await this.client.connect();
      this.db = this.client.db(this.config.dbName);
      console.log(`[DeviceManager] ✅ Connected to ${this.config.dbName}`);
    } catch (err) {
      console.error(`[DeviceManager] ❌ MongoDB Connection Failed: ${err.message}`);
      throw new Error(`MongoDB connection failed: ${err.message}`);
    }

    // 3. Setup collections
    try {
      this.collections.hardware = this.db.collection(this.config.hardwareCollection);
      this.collections.useragent = this.db.collection(this.config.useragentCollection);
      
      for (const [browser, collName] of Object.entries(this.config.fingerprintsCollections)) {
        this.collections[browser] = this.db.collection(collName);
      }
      
      console.log(`[DeviceManager] ✅ Collections mapped: ${Object.keys(this.collections).length} collections`);
    } catch (error) {
      console.error(`[DeviceManager] ❌ Collection setup failed: ${error.message}`);
      throw new Error(`Collection setup failed: ${error.message}`);
    }

    // 4. Load market share data
    try {
      await this.loadMarketShare();
    } catch (error) {
      console.warn(`[DeviceManager] ⚠️  Market share load failed, using defaults: ${error.message}`);
      this.marketShareCache = this.getDefaultMarketShare();
    }

    // 5. Initialize font manager
    try {
      this.fontManager = new StealthFont({
        mongoUri: mongoUri,
        dbName: this.config.dbName,
        fontDatabaseCollection: this.config.fontDatabaseCollection,
        fontPersonaCollection: this.config.fontPersonaCollection,
        tierWeights: this.config.tierWeights
      });
      
      await this.fontManager.initialize();
      console.log(`[DeviceManager] ✅ FontManager initialized`);
    } catch (fontErr) {
      console.warn(`[DeviceManager] ⚠️  FontManager initialization warning: ${fontErr.message}`);
    }

    // 6. Verify availability
    try {
      const stats = await this.getStats();
      console.log(`[DeviceManager] Available hardware: ${stats.hardwareByPlatform[this.hostPlatform.platform] || 0}`);
      console.log(`[DeviceManager] Available browsers:`);
      
      for (const [browser, count] of Object.entries(stats.fingerprintsByBrowser)) {
        console.log(`  - ${browser}: ${count}`);
      }

      if (stats.hardwareByPlatform[this.hostPlatform.platform] === 0) {
        console.warn(`[DeviceManager] ⚠️  No hardware profiles found for ${this.hostPlatform.platform}. Fingerprinting may fail.`);
      }
    } catch (statsErr) {
      console.warn(`[DeviceManager] ⚠️  Could not fetch initial stats: ${statsErr.message}`);
    }

    console.log('[DeviceManager] ✅ Initialization complete (v7.4.0 - Identity Normalization ready)\n');
  }

  async close() {
    if (this.fontManager) {
      try {
        await this.fontManager.close();
        console.log('[DeviceManager] ✅ FontManager closed');
      } catch (error) {
        console.warn(`[DeviceManager] ⚠️  FontManager close warning: ${error.message}`);
      }
    }

    if (this.client) {
      try {
        await this.client.close();
        this.client = null;
        console.log('[DeviceManager] ✅ MongoDB connection closed');
      } catch (error) {
        console.error(`[DeviceManager] ❌ Connection close failed: ${error.message}`);
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V7.4.0: NEW METHOD - IDENTITY NORMALIZER (IP VALIDATOR AS SOURCE OF TRUTH)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  /**
   * Menyelaraskan Fingerprint dengan Data Jaringan (IP Validator).
   * DeviceManager bertugas menormalisasi format data agar sesuai standar Database.
   * 
   * @param {Object} fp - Object fingerprint yang sedang aktif
   * @param {Object} networkData - Data dari C++ IP Validator { ip, country, region, city, timezone, lat, lon }
   * @returns {Object} - Fingerprint yang sudah dinormalisasi (mutated in-place)
   */
  async alignIdentityWithNetwork(fp, networkData) {
    const WID = '[DeviceManager:Normalizer]';
    console.log(`${WID} 🔄 Aligning fingerprint with Network Identity: ${networkData.ip} (${networkData.country})`);

    try {
      // 1. Cross-Check ke Database Regions untuk Standardisasi Format
      const regionsCollection = this.db.collection('regions');
      const regionDoc = await regionsCollection.findOne({ regionCode: networkData.country });

      // Default values (jika DB tidak ketemu)
      let targetLocale = 'en-US'; 
      let targetTimezone = networkData.timezone; // Percaya IP Validator dulu

      // 2. Logika Normalisasi berdasarkan Database
      if (regionDoc) {
        console.log(`${WID} ✅ Region found in database: ${regionDoc.regionName || networkData.country}`);
        
        // Cek apakah timezone dari IP Validator valid menurut Database Region tersebut
        const locationMatch = regionDoc.locations?.find(loc => loc.timezone === networkData.timezone);

        if (locationMatch) {
          // PERFECT MATCH: Database mengonfirmasi timezone ini valid untuk negara tersebut
          targetLocale = locationMatch.locale; // Ambil format locale baku dari DB (misal: 'id-ID' bukan 'id_ID')
          console.log(`${WID} ✅ Database confirmed strict format: ${targetLocale} | ${targetTimezone}`);
        } else {
          // PARTIAL MATCH: Negara ketemu, tapi Timezone IP agak beda (misal IP deteksi kota kecil).
          // Action: Fallback ke default locale negara tersebut, tapi tetap pakai Timezone IP (karena IP adalah Raja)
          targetLocale = regionDoc.locale || 'en-US';
          console.warn(`${WID} ⚠️  Timezone loose match. Enforcing DB Locale: ${targetLocale} but keeping IP Timezone: ${targetTimezone}`);
        }
      } else {
        console.warn(`${WID} ⚠️  Region DB not found for ${networkData.country}. Using generic defaults.`);
      }

      // 3. HARD OVERRIDE (Meluruskan Data Fingerprint)
      // IP Validator & DB Logic menang, Fingerprint lama ditimpa.
      
      // A. Override Locale & Timezone
      fp.locale = targetLocale;
      fp.timezone = targetTimezone;

      // B. Override Geolocation (Lat/Lon dari IP Validator lebih akurat drpd mock)
      fp.geolocation = {
        latitude: networkData.lat,
        longitude: networkData.lon,
        accuracy: 100 // High accuracy karena dari IP core
      };

      // C. Normalisasi Bahasa (Language Headers)
      // Pastikan format 'en-US' dipecah jadi ['en-US', 'en'] untuk navigator.languages
      const shortLang = targetLocale.split('-')[0];
      fp.languages = [targetLocale, shortLang];

      console.log(`${WID} ✅ Identity Normalized:`);
      console.log(`${WID}    Locale: ${fp.locale}`);
      console.log(`${WID}    Timezone: ${fp.timezone}`);
      console.log(`${WID}    Languages: ${JSON.stringify(fp.languages)}`);
      console.log(`${WID}    Geo: ${fp.geolocation.latitude}, ${fp.geolocation.longitude}`);

      return fp;

    } catch (error) {
      console.error(`${WID} ❌ Normalization Failed: ${error.message}`);
      console.error(`${WID} Stack: ${error.stack}`);
      // Jangan throw error fatal, biarkan jalan dengan data seadanya (graceful degradation)
      return fp;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V15.2.0: GET HARDWARE SAMPLE FOR TYPICAL FLAG LOOKUP
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async getHardwareSample(osName) {
    try {
      if (!osName || typeof osName !== 'string') {
        console.warn(`[DeviceManager] ⚠️  Invalid osName: ${osName}, using fallback`);
        return null;
      }
      
      const osLower = osName.toLowerCase();
      const sample = await this.collections.hardware.findOne({ os: osLower });
      
      return sample;
    } catch (error) {
      console.warn(`[DeviceManager] ⚠️  Failed to get hardware sample for ${osName}: ${error.message}`);
      return null;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // PLATFORM DETECTION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  getHostPlatform() {
    const platform = os.platform();
    const arch = os.arch();
    const release = os.release();
    const result = { platform: null, version: null, arch: arch, distribution: null };

    if (platform === 'win32') {
      result.platform = 'windows';
      const parts = release.split('.');
      if (parts.length >= 3) {
        const build = parseInt(parts[2], 10);
        result.version = (build >= 22000) ? '11' : '10';
      } else {
        result.version = '10';
      }
      return result;
    }

    if (platform === 'linux') {
      result.platform = 'linux';
      try {
        const osRelease = execSync('cat /etc/os-release', { encoding: 'utf8' });
        const idMatch = osRelease.match(/^ID=(.+)$/m);
        if (idMatch) result.distribution = idMatch[1].replace(/"/g, '').toLowerCase();
        const versionMatch = osRelease.match(/^VERSION_ID=(.+)$/m);
        if (versionMatch) result.version = versionMatch[1].replace(/"/g, '');
      } catch (e) {
        console.warn('[DeviceManager] ⚠️  Cannot detect Linux distribution, using generic');
        result.distribution = 'linux';
      }
      return result;
    }

    if (platform === 'darwin') {
      result.platform = 'macos';
      const darwinVersion = parseInt(release.split('.')[0], 10);
      const versionMap = { 23: '14', 22: '13', 21: '12', 20: '11', 19: '10.15', 18: '10.14' };
      result.version = versionMap[darwinVersion] || '14';
      return result;
    }

    console.warn(`[DeviceManager] ⚠️  Unsupported platform: ${platform}, defaulting to windows`);
    result.platform = 'windows';
    result.version = '10';
    return result;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V15.0.0: OS-BROWSER COMPATIBILITY VALIDATION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  validateOSBrowserCompatibility(browserName, osName) {
    if (!browserName || !osName) {
      console.warn(`[DeviceManager] ⚠️  Invalid compatibility check: browser=${browserName}, os=${osName}`);
      return true;
    }
    
    const browserLower = browserName.toLowerCase();
    const osLower = osName.toLowerCase();

    if (!this.osCompatibilityMatrix[osLower]) {
      console.warn(`[DeviceManager] ⚠️  Unknown OS: ${osName}, allowing compatibility`);
      return true;
    }

    const isCompatible = this.osCompatibilityMatrix[osLower][browserLower];
    if (isCompatible === false) {
      console.warn(
        `[DeviceManager] ❌ OS-BROWSER MISMATCH: ${osName} + ${browserName} NOT COMPATIBLE`
      );
      return false;
    }

    return true;
  }

  filterCompatibleBrowsers(marketShare, osName) {
    if (!marketShare || typeof marketShare !== 'object') {
      console.warn(`[DeviceManager] ⚠️  Invalid marketShare data, returning empty array`);
      return [];
    }
    
    const osLower = osName.toLowerCase();
    const compatible = Object.entries(marketShare)
      .filter(([name, info]) => {
        if (!info || info.available !== true) return false;
        
        const isCompatible = this.validateOSBrowserCompatibility(name, osLower);
        if (!isCompatible) {
          return false;
        }
        return true;
      })
      .map(([name, info]) => ({ name, market_share: info.market_share || 0 }));

    return compatible;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // MARKET SHARE MANAGEMENT
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async loadMarketShare() {
    let uaDoc = null;
    
    try {
      uaDoc = await this.collections.useragent.findOne({});
    } catch (e) {
      console.warn(`[DeviceManager] ⚠️  Failed to load useragent_selector: ${e.message}`);
      this.marketShareCache = this.getDefaultMarketShare();
      return;
    }

    if (!uaDoc || !uaDoc.operating_systems) {
      console.warn('[DeviceManager] ⚠️  useragent_selector not found, using defaults');
      this.marketShareCache = this.getDefaultMarketShare();
      return;
    }

    this.marketShareCache = {};
    const os_data = uaDoc.operating_systems;

    if (os_data.Windows && os_data.Windows.versions) {
      for (const [majorVer, majorData] of Object.entries(os_data.Windows.versions)) {
        if (majorData.versions) {
          for (const [minorVer, minorData] of Object.entries(majorData.versions)) {
            if (minorData.browsers) {
              const key = `windows_${minorData.platformVersion || minorVer}`;
              this.marketShareCache[key] = this.normalizeBrowserMarketShare(minorData.browsers);
            }
          }
        }
      }
    }

    if (os_data.Linux && os_data.Linux.distributions) {
      for (const [distro, distroData] of Object.entries(os_data.Linux.distributions)) {
        if (distroData.versions) {
          for (const [ver, verData] of Object.entries(distroData.versions)) {
            if (verData.browsers) {
              const key = `linux_${verData.platformVersion || ver}`;
              this.marketShareCache[key] = this.normalizeBrowserMarketShare(verData.browsers);
            }
          }
        } else if (distroData.browsers) {
          this.marketShareCache['linux_generic'] = this.normalizeBrowserMarketShare(distroData.browsers);
        }
      }
    }

    console.log(`[DeviceManager] ✅ Loaded market share for ${Object.keys(this.marketShareCache).length} OS configurations`);
  }

  normalizeBrowserMarketShare(browsers) {
    if (!browsers || typeof browsers !== 'object') {
      console.warn(`[DeviceManager] ⚠️  Invalid browsers data for normalization`);
      return {};
    }
    
    const normalized = {};
    
    for (const [browserName, browserData] of Object.entries(browsers)) {
      const name = browserName.toLowerCase();
      const share = browserData.market_share || browserData.market_agent || 0;
      
      let mappedName = name;
      if (name === 'internet explorer') mappedName = 'ie';
      if (name === 'other') continue;
      
      normalized[mappedName] = { available: true, market_share: share };
    }
    
    return normalized;
  }

  getDefaultMarketShare() {
    return {
      'windows_10.0.22631': {
        chrome: { available: true, market_share: 62.5 },
        edge: { available: true, market_share: 24.0 },
        firefox: { available: true, market_share: 6.5 },
        opera: { available: true, market_share: 4.0 }
      },
      'linux_22.04': {
        chrome: { available: true, market_share: 63.5 },
        firefox: { available: true, market_share: 26.2 },
        edge: { available: true, market_share: 4.8 }
      },
      'macos_13.4.0': {
        safari: { available: true, market_share: 52.3 },
        chrome: { available: true, market_share: 35.1 },
        firefox: { available: true, market_share: 7.2 },
        edge: { available: true, market_share: 3.8 }
      }
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V15.2.0: ENHANCED SELECTION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async selectBrowserByMarketShareWithOSValidation(osKey, osName) {
    const marketShare = this.marketShareCache[osKey] || this.marketShareCache['windows_10.0.22631'];
    const compatible = this.filterCompatibleBrowsers(marketShare, osName);

    if (compatible.length === 0) {
      console.warn(`[DeviceManager] ⚠️  No OS-compatible browsers found for ${osName}, defaulting to Chrome`);
      return 'chrome';
    }

    const hardwareSample = await this.getHardwareSample(osName);
    const boosted = compatible.map(browser => {
      let isTypical = false;
      
      if (hardwareSample && hardwareSample.browser_compatibility) {
        const browserCompat = hardwareSample.browser_compatibility[browser.name];
        isTypical = browserCompat?.typical === true;
      }

      const adjustedShare = browser.market_share * (isTypical ? 1.2 : 1.0);
      
      return {
        ...browser,
        is_typical: isTypical,
        adjusted_share: adjustedShare
      };
    });

    const totalShare = boosted.reduce((sum, b) => sum + b.adjusted_share, 0);
    
    if (totalShare === 0) {
      console.warn(`[DeviceManager] ⚠️  Total market share is 0, defaulting to first browser`);
      return boosted[0].name;
    }
    
    const rand = Math.random() * totalShare;
    let cumulative = 0;

    for (const browser of boosted) {
      cumulative += browser.adjusted_share;
      if (rand <= cumulative) {
        return browser.name;
      }
    }

    return boosted[0].name;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V7.3.0: ENHANCED ACQUIRE FINGERPRINT (INPUT VALIDATION + ERROR HANDLING)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async acquireFingerprint(workerId, sessionId, browserType = 'auto') {
    // ✅ v7.3.0: Input validation
    if (!workerId) {
      throw new Error('acquireFingerprint: workerId is required');
    }
    
    if (!sessionId) {
      throw new Error('acquireFingerprint: sessionId is required');
    }
    
    if (!this.collections.hardware) {
      throw new Error('DeviceManager not initialized. Call initialize() first.');
    }

    const now = new Date();
    
    if (!this.hostPlatform) {
      try {
        this.hostPlatform = this.getHostPlatform();
      } catch (error) {
        throw new Error(`Platform detection failed: ${error.message}`);
      }
    }

    // ✅ v7.3.0: Enhanced error handling for hardware query
    const hardwareQuery = { os: this.hostPlatform.platform };
    let hardwareCandidates = [];
    
    try {
      hardwareCandidates = await this.collections.hardware.find(hardwareQuery).toArray();
    } catch (error) {
      throw new Error(`Hardware query failed for ${this.hostPlatform.platform}: ${error.message}`);
    }

    if (!hardwareCandidates || hardwareCandidates.length === 0) {
      throw new Error(`No hardware profiles available for ${this.hostPlatform.platform}`);
    }

    // ✅ v7.3.0: Safe browserType normalization
    if (browserType === 'auto') {
      let osKey = `${this.hostPlatform.platform}_`;
      
      if (this.hostPlatform.platform === 'windows') {
        const sampleHw = hardwareCandidates[0];
        osKey += sampleHw.os_version || '10.0.22631';
      } else if (this.hostPlatform.platform === 'linux') {
        osKey += this.hostPlatform.version || '22.04';
      } else if (this.hostPlatform.platform === 'macos') {
        osKey += this.hostPlatform.version || '13.4.0';
      }

      try {
        browserType = await this.selectBrowserByMarketShareWithOSValidation(osKey, this.hostPlatform.platform);
        console.log(`[${workerId}] 🧠 Auto-selected browser: ${browserType}`);
      } catch (error) {
        console.warn(`[${workerId}] ⚠️  Browser selection failed: ${error.message}, defaulting to chrome`);
        browserType = 'chrome';
      }
    } else {
      // ✅ v7.3.0: Normalize and validate manual input
      if (typeof browserType !== 'string') {
        throw new Error(`Invalid browserType: must be string, got ${typeof browserType}`);
      }
      
      browserType = browserType.toLowerCase().trim();
      
      if (!browserType) {
        throw new Error('Invalid browserType: empty string');
      }
      
      if (!this.validateOSBrowserCompatibility(browserType, this.hostPlatform.platform)) {
        throw new Error(`OS-Browser mismatch: ${this.hostPlatform.platform} + ${browserType} NOT COMPATIBLE!`);
      }
      
      console.log(`[${workerId}] ✅ Manual browser ${browserType} validated for ${this.hostPlatform.platform}`);
    }

    if (!this.collections[browserType]) {
      throw new Error(`Invalid browser type: ${browserType}. Available: ${Object.keys(this.collections).filter(k => !['hardware', 'useragent'].includes(k)).join(', ')}`);
    }

    // ✅ v7.3.0: Safe array filtering with existence check
    const compatibleHardware = (hardwareCandidates || [])
      .filter(hw => {
        if (!hw || !hw.browser_compatibility) return false;
        
        const browserCompat = hw.browser_compatibility[browserType];
        return browserCompat?.available === true;
      })
      .sort((a, b) => {
        const aTypical = a.browser_compatibility?.[browserType]?.typical === true ? 1 : 0;
        const bTypical = b.browser_compatibility?.[browserType]?.typical === true ? 1 : 0;

        if (aTypical !== bTypical) {
          return bTypical - aTypical;
        }
        
        const aRarity = a.population?.rarity_score || 0;
        const bRarity = b.population?.rarity_score || 0;
        return aRarity - bRarity;
      });

    if (compatibleHardware.length === 0) {
      throw new Error(`No compatible ${browserType} hardware profiles found for ${this.hostPlatform.platform}`);
    }

    const hardwareIds = compatibleHardware.map(hw => hw._id);
    const fpCollection = this.collections[browserType];
    
    let candidates = [];
    
    try {
      candidates = await fpCollection.aggregate([
        { $match: { hardware_id: { $in: hardwareIds } } },
        {
          $lookup: {
            from: this.config.hardwareCollection,
            localField: 'hardware_id',
            foreignField: '_id',
            as: 'hardware'
          }
        },
        { $unwind: '$hardware' },
        {
          $sort: {
            last_used: 1,
            usage_count: 1
          }
        },
        { $limit: 100 }
      ]).toArray();
    } catch (error) {
      throw new Error(`Fingerprint aggregation failed for ${browserType}: ${error.message}`);
    }

    if (!candidates || candidates.length === 0) {
      throw new Error(`No ${browserType} fingerprints available for selected hardware!`);
    }

    const selected = this.weightedRandomSelect(candidates);

    try {
      await fpCollection.updateOne(
        { _id: selected._id },
        {
          $inc: { usage_count: 1 },
          $set: { last_used: now }
        }
      );
    } catch (error) {
      console.warn(`[${workerId}] ⚠️  Failed to update fingerprint stats: ${error.message}`);
    }

    const typicalFlag = selected.hardware.browser_compatibility?.[browserType]?.typical === true ? '(typical ✅)' : '';
    console.log(
      `[${workerId}] ✅ Selected ${browserType} ${selected._id} ` +
      `(hw: ${selected.hardware._id}, tier: ${selected.hardware.population?.tier || 0}, ` +
      `usage: ${selected.usage_count || 0}) ${typicalFlag}`
    );

    return selected;
  }

  weightedRandomSelect(candidates) {
    if (!candidates || candidates.length === 0) {
      throw new Error('weightedRandomSelect: candidates array is empty');
    }
    
    const tierGroups = {};
    
    candidates.forEach(fp => {
      const tier = fp.hardware?.population?.tier || 0;
      if (!tierGroups[tier]) tierGroups[tier] = [];
      tierGroups[tier].push(fp);
    });

    let totalWeight = 0;
    for (const tier in tierGroups) {
      const weight = this.config.tierWeights[tier] || 1;
      totalWeight += weight * tierGroups[tier].length;
    }

    if (totalWeight === 0) {
      console.warn('[DeviceManager] ⚠️  Total weight is 0, returning random candidate');
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    let random = Math.random() * totalWeight;
    
    for (const tier in tierGroups) {
      const weight = this.config.tierWeights[tier] || 1;
      const groupWeight = weight * tierGroups[tier].length;

      if (random < groupWeight) {
        return tierGroups[tier][Math.floor(Math.random() * tierGroups[tier].length)];
      }

      random -= groupWeight;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  async updateFingerprintStats(fingerprintId, browserType, success = true) {
    if (!fingerprintId) {
      console.warn(`[DeviceManager] ⚠️  Invalid fingerprintId, skipping stats update`);
      return;
    }
    
    if (!browserType || !this.collections[browserType]) {
      console.warn(`[DeviceManager] ⚠️  Invalid browser type: ${browserType}, skipping stats update`);
      return;
    }

    const collection = this.collections[browserType];
    const now = new Date();

    const update = {
      $set: { last_used: now }
    };

    if (success) {
      update.$inc = { success_count: 1 };
    } else {
      update.$inc = { fail_count: 1 };
    }

    try {
      await collection.updateOne({ _id: fingerprintId }, update);
      console.log(`[DeviceManager] ✅ Updated stats: ${fingerprintId} (success: ${success})`);
    } catch (error) {
      console.warn(`[DeviceManager] ⚠️  Stats update failed for ${fingerprintId}: ${error.message}`);
    }
  }

  async releaseFingerprint(fingerprintId, browserType, success = true) {
    return this.updateFingerprintStats(fingerprintId, browserType, success);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V7.2.0: ENHANCED LOGICAL MAPPING & DEEP DATA
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  toFingerprintObject(dbEntry) {
    if (!dbEntry) {
      throw new Error('toFingerprintObject: dbEntry is required');
    }
    
    // Generate font profile
    let font_profile = null;
    
    if (this.fontManager && dbEntry.hardware) {
      try {
        font_profile = this.fontManager.generateFontProfile(dbEntry.hardware, dbEntry);
      } catch (error) {
        console.warn(`[DeviceManager] ⚠️  Font profile generation failed: ${error.message}`);
      }
    }

    const hardwareData = dbEntry.hardware?.hardware;
    
    const hardwareCores = hardwareData?.cpu?.logical_processors || 
                          dbEntry.navigator?.hardwareConcurrency || 
                          4;
    
    const hardwareMemory = hardwareData?.ram_gb || 
                           dbEntry.navigator?.deviceMemory || 
                           8;
    
    const hardwareGPU = hardwareData?.gpu ? 
                        `${hardwareData.gpu.vendor || 'Intel'} ${hardwareData.gpu.model || 'HD Graphics'}`.trim() : 
                        'Intel Corporation';

    const browserType = dbEntry.browserType || dbEntry.browser?.type || 'chromium';
    const engine = dbEntry.browser?.engine || (browserType === 'firefox' ? 'gecko' : (browserType === 'safari' ? 'webkit' : 'chromium'));

    let defaultVendor = 'Google Inc. (NVIDIA)';
    let defaultRenderer = 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';

    if (engine === 'gecko') {
      defaultVendor = 'NVIDIA Corporation';
      defaultRenderer = 'NVIDIA GeForce GTX 1650';
    } else if (engine === 'webkit') {
      defaultVendor = 'Apple Inc.';
      defaultRenderer = 'Apple M1';
    }

    return {
      _id: dbEntry._id,
      browserName: this.getBrowserName(dbEntry),
      browserType: browserType,
      
      engine: engine,
      
      webgl: {
        vendor: dbEntry.webgl?.vendor || defaultVendor,
        renderer: dbEntry.webgl?.renderer || defaultRenderer,
        extensions: dbEntry.webgl?.extensions_base || [],
        parameters: dbEntry.webgl?.parameters || {}
      },
      
      vendorWebGL: dbEntry.webgl?.vendor || defaultVendor,
      rendererWebGL: dbEntry.webgl?.renderer || defaultRenderer,
      
      canvas: dbEntry.canvas || {},
      audio: dbEntry.audio || {},

      hardware: {
        cores: hardwareCores,
        memory: hardwareMemory,
        gpu: hardwareGPU
      },
      
      navigator: {
        hardwareConcurrency: dbEntry.navigator?.hardwareConcurrency || 4,
        deviceMemory: dbEntry.navigator?.deviceMemory || null,
        platform: dbEntry.navigator?.platform || 'Win32',
        oscpu: dbEntry.navigator?.oscpu || dbEntry.browser?.oscpu || undefined,
        buildID: dbEntry.navigator?.buildID || dbEntry.browser?.buildID || undefined
      },
      
      hardwareConcurrency: dbEntry.navigator?.hardwareConcurrency || 4,
      deviceMemory: dbEntry.navigator?.deviceMemory || null,
      
      userAgent: null,
      
      viewport: {
        width: dbEntry.viewport?.width || 1920,
        height: dbEntry.viewport?.height || 1080
      },
      screen: {
        width: dbEntry.display?.width || dbEntry.viewport?.width || 1920,
        height: dbEntry.display?.height || dbEntry.viewport?.height || 1080,
        colorDepth: dbEntry.display?.color_depth || 24,
        pixelDepth: dbEntry.display?.color_depth || 24
      },
      
      deviceScaleFactor: dbEntry.device?.scale_factor || 1.0,
      hasTouch: dbEntry.device?.has_touch || false,
      isMobile: dbEntry.device?.is_mobile || false,
      
      locale: undefined,
      timezone: undefined,
      
      fingerprintSeed: `${dbEntry._id}_${Date.now()}`,
      font_profile: font_profile,
      _meta: {
        hardware_id: dbEntry.hardware_id,
        os: {
          name: dbEntry.hardware?.os || 'unknown',
          version: dbEntry.hardware?.os_version || null
        },
        tier: dbEntry.hardware?.population?.tier || 0,
        rarity: dbEntry.hardware?.population?.rarity_score || 0,
        usage_count: dbEntry.usage_count || 0,
        last_used: dbEntry.last_used || null,
        ua_mode: "native"
      }
    };
  }

  getBrowserName(dbEntry) {
    if (!dbEntry) return 'Chrome';
    
    if (dbEntry.browser && dbEntry.browser.type) {
      const type = dbEntry.browser.type.toLowerCase();
      if (type === 'chrome') return 'Chrome';
      if (type === 'edge') return 'Edge';
      if (type === 'firefox') return 'Firefox';
      if (type === 'safari') return 'Safari';
    }

    if (dbEntry.navigator && dbEntry.navigator.userAgent) {
      const ua = dbEntry.navigator.userAgent;
      if (ua.includes('Edg/')) return 'Edge';
      if (ua.includes('Firefox/')) return 'Firefox';
      if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
      if (ua.includes('Chrome/')) return 'Chrome';
    }

    return 'Chrome';
  }

  async getStats() {
    if (!this.collections.hardware) {
      throw new Error('DeviceManager not initialized');
    }

    try {
      const totalHardware = await this.collections.hardware.countDocuments();
      const hardwareByPlatform = {
        windows: await this.collections.hardware.countDocuments({ os: 'windows' }),
        linux: await this.collections.hardware.countDocuments({ os: 'linux' }),
        macos: await this.collections.hardware.countDocuments({ os: 'macos' })
      };

      const fingerprintsByBrowser = {};
      for (const [browser, collection] of Object.entries(this.collections)) {
        if (['hardware', 'useragent'].includes(browser)) continue;
        fingerprintsByBrowser[browser] = await collection.countDocuments();
      }

      const usageStats = {};
      for (const [browser, collection] of Object.entries(this.collections)) {
        if (['hardware', 'useragent'].includes(browser)) continue;
        
        const stats = await collection.aggregate([
          {
            $facet: {
              neverUsed: [
                { $match: { last_used: null } },
                { $count: 'count' }
              ],
              avgUsage: [
                { $group: { _id: null, avg: { $avg: '$usage_count' } } }
              ]
            }
          }
        ]).toArray();

        const result = stats[0];
        usageStats[browser] = {
          neverUsed: result.neverUsed[0]?.count || 0,
          avgUsage: result.avgUsage[0]?.avg || 0
        };
      }

      return {
        totalHardware,
        hardwareByPlatform,
        fingerprintsByBrowser,
        usageStats,
        hostPlatform: this.hostPlatform
      };
    } catch (error) {
      throw new Error(`Failed to get stats: ${error.message}`);
    }
  }

  async generateIdentity(forceBrowser = null) {
    const sessionId = `legacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const workerId = 'LEGACY';
    const browserType = forceBrowser ? forceBrowser.toLowerCase() : 'auto';
    
    try {
      const acquired = await this.acquireFingerprint(workerId, sessionId, browserType);
      return this.toFingerprintObject(acquired);
    } catch (error) {
      throw new Error(`generateIdentity failed: ${error.message}`);
    }
  }
}

module.exports = new DeviceManager();
