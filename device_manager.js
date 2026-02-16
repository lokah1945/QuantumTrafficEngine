/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * DEVICE MANAGER V7.2.1 - FIX: SINGLETON INSTANCE EXPORT
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * * 🔥 CHANGELOG V7.2.1 (2026-02-15 05:20 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ FIXED: Module Export Type
 * - BEFORE: module.exports = DeviceManager (Class definition)
 * - AFTER:  module.exports = new DeviceManager() (Singleton Instance)
 * - REASON: Fixes "TypeError: DeviceManager.initialize is not a function" in opsi4.js/engine.js
 * * * 🔥 CHANGELOG V7.2.0 (2026-02-14 16:30 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ FEATURE: Multi-Engine Logic (Chromium/Gecko/WebKit)
 * ✅ FEATURE: Firefox/Gecko Specifics (oscpu, buildID)
 * ✅ FEATURE: Intelligent WebGL Fallbacks
 * ✅ FEATURE: Full Deep Data Passthrough
 * * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
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
    safari: false, // ❌ Safari TIDAK ADA di Windows!
    opera: true
  },
  macos: {
    chrome: true,
    edge: true,
    firefox: true,
    safari: true, // ✅ Safari adalah NATIVE browser macOS (preferred)
    opera: true
  },
  linux: {
    chrome: true,
    edge: true, // ✅ Edge tersedia di Linux (Chromium-based)
    firefox: true,
    safari: false, // ❌ Safari TIDAK ADA di Linux!
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
      dbName: config.dbName || 'QuantumTrafficDB', // Adjusted default to match log
      
      // Fingerprint Collections (no runtime collection!)
      hardwareCollection: config.hardwareCollection || 'hardware_profiles',
      fingerprintsCollections: config.fingerprintsCollections || {
        chrome: 'fingerprints_chrome',
        edge: 'fingerprints_edge',
        firefox: 'fingerprints_firefox',
        safari: 'fingerprints_safari'
      },
      useragentCollection: config.useragentCollection || 'useragent_selector',
      
      // Font Collections
      fontDatabaseCollection: config.fontDatabaseCollection || 'font_database',
      fontPersonaCollection: config.fontPersonaCollection || 'font_persona',
      
      // Selection Strategy
      browserSelectionMode: config.browserSelectionMode || 'auto',
      
      // Weighted tier selection (natural distribution)
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
    
    // ✅ V15.0.0: OS-Browser compatibility matrix
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

    console.log('[DeviceManager] Initializing V7.2.1 (Singleton Fix + Multi-Engine)...');

    // 1. Detect host platform
    this.hostPlatform = this.getHostPlatform();
    console.log(`[DeviceManager] Host: ${this.hostPlatform.platform} ${this.hostPlatform.version} (${this.hostPlatform.arch})`);

    // 2. Connect to MongoDB
    // Use env var if available and not passed in config, fallback to default
    const mongoUri = process.env.DB_CONNECTION_STRING || this.config.mongoUri;
    
    try {
        this.client = new MongoClient(mongoUri);
        await this.client.connect();
        this.db = this.client.db(this.config.dbName);
    } catch (err) {
        console.error(`[DeviceManager] ❌ MongoDB Connection Failed: ${err.message}`);
        throw err;
    }

    // 3. Setup collections (NO runtime collection!)
    this.collections.hardware = this.db.collection(this.config.hardwareCollection);
    this.collections.useragent = this.db.collection(this.config.useragentCollection);
    for (const [browser, collName] of Object.entries(this.config.fingerprintsCollections)) {
      this.collections[browser] = this.db.collection(collName);
    }
    console.log(`[DeviceManager] Connected to ${this.config.dbName}`);

    // 4. Load market share data
    await this.loadMarketShare();

    // 5. Initialize font manager
    this.fontManager = new StealthFont({
      mongoUri: mongoUri,
      dbName: this.config.dbName,
      fontDatabaseCollection: this.config.fontDatabaseCollection,
      fontPersonaCollection: this.config.fontPersonaCollection,
      tierWeights: this.config.tierWeights
    });
    
    try {
        await this.fontManager.initialize();
    } catch (fontErr) {
        console.warn(`[DeviceManager] ⚠️ FontManager initialization warning: ${fontErr.message}`);
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
          console.warn(`[DeviceManager] ⚠️ No hardware profiles found for ${this.hostPlatform.platform}. Fingerprinting may fail.`);
        }
    } catch (statsErr) {
        console.warn(`[DeviceManager] ⚠️ Could not fetch initial stats: ${statsErr.message}`);
    }

    console.log('[DeviceManager] Initialization complete (Deep Logic enabled)\n');
  }

  async close() {
    if (this.fontManager) {
      await this.fontManager.close();
    }

    if (this.client) {
      await this.client.close();
      this.client = null;
      console.log('[DeviceManager] Connection closed');
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V15.2.0: NEW HELPER - GET HARDWARE SAMPLE FOR TYPICAL FLAG LOOKUP
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async getHardwareSample(osName) {
    try {
      const osLower = osName.toLowerCase();
      const sample = await this.collections.hardware.findOne({ os: osLower });
      return sample;
    } catch (error) {
      console.warn(`[DeviceManager] ⚠️ Failed to get hardware sample for ${osName}: ${error.message}`);
      return null;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // PLATFORM DETECTION (UNCHANGED FROM V14.1.0)
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
        console.warn('[Platform] Cannot detect Linux distribution, using generic');
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

    // Default fallback if unknown
    console.warn(`[DeviceManager] ⚠️ Unsupported platform: ${platform}, defaulting to windows`);
    result.platform = 'windows';
    result.version = '10';
    return result;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V15.0.0: OS-BROWSER COMPATIBILITY VALIDATION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  validateOSBrowserCompatibility(browserName, osName) {
    const browserLower = browserName.toLowerCase();
    const osLower = osName.toLowerCase();

    if (!this.osCompatibilityMatrix[osLower]) {
      // Unknown OS, allow but warn
      return true;
    }

    const isCompatible = this.osCompatibilityMatrix[osLower][browserLower];
    if (isCompatible === false) {
      console.warn(
        `[DeviceManager] ❌ OS-BROWSER MISMATCH DETECTED: ${osName} + ${browserName} NOT COMPATIBLE`
      );
      return false;
    }

    return true;
  }

  filterCompatibleBrowsers(marketShare, osName) {
    const osLower = osName.toLowerCase();
    const compatible = Object.entries(marketShare)
      .filter(([name, info]) => {
        if (info.available !== true) return false;
        const isCompatible = this.validateOSBrowserCompatibility(name, osLower);
        if (!isCompatible) {
          return false;
        }
        return true;
      })
      .map(([name, info]) => ({ name, market_share: info.market_share }));

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
        console.warn(`[DeviceManager] Failed to load useragent_selector: ${e.message}`);
    }

    if (!uaDoc || !uaDoc.operating_systems) {
      console.warn('[DeviceManager] ⚠️ useragent_selector not found, using defaults');
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

    console.log(`[DeviceManager] Loaded market share for ${Object.keys(this.marketShareCache).length} OS configurations`);
  }

  normalizeBrowserMarketShare(browsers) {
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
      // Return a safe default instead of crashing if possible
      console.warn(`[DeviceManager] ⚠️ No OS-compatible browsers found for ${osName}, defaulting to Chrome`);
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

  async acquireFingerprint(workerId, sessionId, browserType = 'auto') {
    if (!this.collections.hardware) {
      throw new Error('DeviceManager not initialized. Call initialize() first.');
    }

    const now = new Date();
    
    // Ensure hostPlatform is set
    if (!this.hostPlatform) this.hostPlatform = this.getHostPlatform();

    const hardwareQuery = { os: this.hostPlatform.platform };
    const hardwareCandidates = await this.collections.hardware.find(hardwareQuery).toArray();

    if (hardwareCandidates.length === 0) {
      throw new Error(`No hardware profiles for ${this.hostPlatform.platform}`);
    }

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

      browserType = await this.selectBrowserByMarketShareWithOSValidation(osKey, this.hostPlatform.platform);
      console.log(`[${workerId}] 🧠 Auto-selected browser: ${browserType}`);
    } else {
      // Normalize input
      browserType = browserType.toLowerCase();
      if (!this.validateOSBrowserCompatibility(browserType, this.hostPlatform.platform)) {
        throw new Error(`OS-Browser mismatch: ${this.hostPlatform.platform} + ${browserType} NOT COMPATIBLE!`);
      }
      console.log(`[${workerId}] ✅ Manual browser ${browserType} validated for ${this.hostPlatform.platform}`);
    }

    if (!this.collections[browserType]) {
      throw new Error(`Invalid browser type: ${browserType}`);
    }

    const compatibleHardware = hardwareCandidates
      .filter(hw => {
        const browserCompat = hw.browser_compatibility?.[browserType];
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
      throw new Error(`No ${browserType} fingerprints for ${this.hostPlatform.platform}`);
    }

    const hardwareIds = compatibleHardware.map(hw => hw._id);
    const fpCollection = this.collections[browserType];
    const candidates = await fpCollection.aggregate([
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

    if (candidates.length === 0) {
      throw new Error(`No ${browserType} fingerprints available!`);
    }

    const selected = this.weightedRandomSelect(candidates);

    await fpCollection.updateOne(
      { _id: selected._id },
      {
        $inc: { usage_count: 1 },
        $set: { last_used: now }
      }
    );

    const typicalFlag = selected.hardware.browser_compatibility?.[browserType]?.typical === true ? '(typical ✅)' : '';
    console.log(
      `[${workerId}] ✅ Selected ${browserType} ${selected._id} ` +
      `(hw: ${selected.hardware._id}, tier: ${selected.hardware.population?.tier || 0}, ` +
      `usage: ${selected.usage_count || 0}) ${typicalFlag}`
    );

    return selected;
  }

  weightedRandomSelect(candidates) {
    const tierGroups = {};
    candidates.forEach(fp => {
      const tier = fp.hardware.population?.tier || 0;
      if (!tierGroups[tier]) tierGroups[tier] = [];
      tierGroups[tier].push(fp);
    });

    let totalWeight = 0;
    for (const tier in tierGroups) {
      const weight = this.config.tierWeights[tier] || 1;
      totalWeight += weight * tierGroups[tier].length;
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
    if (!this.collections[browserType]) {
      console.warn(`[DeviceManager] Invalid browser type: ${browserType}, skipping stats update`);
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

    await collection.updateOne({ _id: fingerprintId }, update);
    console.log(`[DeviceManager] Updated stats: ${fingerprintId} (success: ${success})`);
  }

  async releaseFingerprint(fingerprintId, browserType, success = true) {
    return this.updateFingerprintStats(fingerprintId, browserType, success);
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ✅ V7.2.0: ENHANCED LOGICAL MAPPING & DEEP DATA
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  toFingerprintObject(dbEntry) {
    // Generate font profile
    let font_profile = null;
    if (this.fontManager && dbEntry.hardware) {
      try {
        font_profile = this.fontManager.generateFontProfile(dbEntry.hardware, dbEntry);
      } catch (error) {
        console.warn(`[DeviceManager] Font profile generation failed: ${error.message}`);
      }
    }

    const hardwareData = dbEntry.hardware?.hardware;
    
    // Fallbacks
    const hardwareCores = hardwareData?.cpu?.logical_processors || 
                          dbEntry.navigator?.hardwareConcurrency || 
                          4;
    
    const hardwareMemory = hardwareData?.ram_gb || 
                           dbEntry.navigator?.deviceMemory || 
                           8;
    
    const hardwareGPU = hardwareData?.gpu ? 
                        `${hardwareData.gpu.vendor || 'Intel'} ${hardwareData.gpu.model || 'HD Graphics'}`.trim() : 
                        'Intel Corporation';

    // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
    // ✅ ENGINE DETECTION
    // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
    const browserType = dbEntry.browserType || dbEntry.browser?.type || 'chromium';
    const engine = dbEntry.browser?.engine || (browserType === 'firefox' ? 'gecko' : (browserType === 'safari' ? 'webkit' : 'chromium'));

    // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
    // ✅ SMART WEBGL DEFAULTS (ENGINE-AWARE)
    // ═════════════════════════════════════════════════════════════════════════════════════════════════════════
    let defaultVendor = 'Google Inc. (NVIDIA)';
    let defaultRenderer = 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';

    if (engine === 'gecko') {
      defaultVendor = 'NVIDIA Corporation';
      defaultRenderer = 'NVIDIA GeForce GTX 1650'; // Gecko uses direct strings
    } else if (engine === 'webkit') {
      defaultVendor = 'Apple Inc.';
      defaultRenderer = 'Apple M1';
    }

    return {
      _id: dbEntry._id,
      browserName: this.getBrowserName(dbEntry),
      browserType: browserType,
      
      // ✅ V7.2.0: Engine for Stealth Logic
      engine: engine,
      
      // ✅ V7.2.0: Deep WebGL with Smart Defaults
      webgl: {
        vendor: dbEntry.webgl?.vendor || defaultVendor,
        renderer: dbEntry.webgl?.renderer || defaultRenderer,
        extensions: dbEntry.webgl?.extensions_base || [],
        parameters: dbEntry.webgl?.parameters || {}
      },
      
      // Flat properties (Legacy support)
      vendorWebGL: dbEntry.webgl?.vendor || defaultVendor,
      rendererWebGL: dbEntry.webgl?.renderer || defaultRenderer,
      
      // ✅ V7.1.0: Canvas & Audio Passthrough
      canvas: dbEntry.canvas || {},
      audio: dbEntry.audio || {},

      // ✅ V7.0.0: Hardware Object
      hardware: {
        cores: hardwareCores,
        memory: hardwareMemory,
        gpu: hardwareGPU
      },
      
      // ✅ V7.2.0: Navigator Object with Engine Specifics
      navigator: {
        hardwareConcurrency: dbEntry.navigator?.hardwareConcurrency || 4,
        deviceMemory: dbEntry.navigator?.deviceMemory || null,
        platform: dbEntry.navigator?.platform || 'Win32',
        // Firefox Specifics
        oscpu: dbEntry.navigator?.oscpu || dbEntry.browser?.oscpu || undefined,
        buildID: dbEntry.navigator?.buildID || dbEntry.browser?.buildID || undefined
      },
      
      // Flattened props for compatibility
      hardwareConcurrency: dbEntry.navigator?.hardwareConcurrency || 4,
      deviceMemory: dbEntry.navigator?.deviceMemory || null,
      
      // User-Agent (Native)
      userAgent: null,
      
      // Viewport & Screen
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
      
      // Device properties
      deviceScaleFactor: dbEntry.device?.scale_factor || 1.0,
      hasTouch: dbEntry.device?.has_touch || false,
      isMobile: dbEntry.device?.is_mobile || false,
      
      // Network Identity Placeholders
      locale: undefined,
      timezone: undefined,
      
      // Metadata
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
  }

  async generateIdentity(forceBrowser = null) {
    const sessionId = `legacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const workerId = 'LEGACY';
    const browserType = forceBrowser ? forceBrowser.toLowerCase() : 'auto';
    
    const acquired = await this.acquireFingerprint(workerId, sessionId, browserType);
    return this.toFingerprintObject(acquired);
  }
}

// ✅ FIXED EXPORT: Return a singleton INSTANCE, not the class
module.exports = new DeviceManager();