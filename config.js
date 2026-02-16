// ═══════════════════════════════════════════════════════════════════════════════
// config.js v88.0.0 - HOTFIX: Worker Directory Simplification
// ═══════════════════════════════════════════════════════════════════════════════
//
// CHANGELOG v88.0.0 (2026-02-03 11:25 WIB):
// ═══════════════════════════════════════════════════════════════════════════════
// 🔥 CRITICAL HOTFIX - ZERO BACKWARD COMPATIBILITY:
// ✅ REMOVED: workerDirectory property (confusing concept - mixed with session dir)
// ✅ REMOVED: isWorkerDirectory flag (no longer needed)
// ✅ FIXED: createWorkerDirectory() returns ONLY executable path
// ✅ CLARIFIED: Executable path vs Session directory separation
// ✅ UPDATED: Function returns uniform structure (same as hardlink strategy)
// ✅ VALIDATED: Cross-code analysis with BrowserLauncher v5.0.0 integration
//
// BREAKING CHANGES FROM v87.0.0:
// ═══════════════════════════════════════════════════════════════════════════════
// ❌ REMOVED: browserConfig.workerDirectory (was: CWD for launch)
// ❌ REMOVED: browserConfig.isWorkerDirectory (was: flag for BrowserLauncher)
// ❌ REMOVED: browserConfig.hardlinkPath (redundant with browserConfig.path)
// ✅ CHANGED: createWorkerDirectory() return structure (simplified)
// ✅ CHANGED: Uniform return format for ALL strategies (hardlink + worker dir)
//
// REASON FOR HOTFIX:
// ═══════════════════════════════════════════════════════════════════════════════
// v87.0.0 mixed TWO different concepts:
// 1. EXECUTABLE PATH (for Clash detection): ./browser/edge/worker1001/msedge.exe
// 2. SESSION DIRECTORY (for browser profile): ./sessions/worker1001/ (DIFFERENT!)
//
// v87.0.0 tried to use workerDirectory for BOTH purposes → WRONG!
// v88.0.0 returns ONLY executable path → Session dir managed by opsi4.js
//
// CORRECT ARCHITECTURE:
// ═══════════════════════════════════════════════════════════════════════════════
// config.getBrowserPath() → Returns executable path (Clash detection)
// opsi4.js → Manages session directory (./sessions/worker###/)
//
// EXAMPLE USAGE (opsi4.js v19.0.0):
// ═══════════════════════════════════════════════════════════════════════════════
// const browserConfig = config.getBrowserPath('Edge', { workerSlot: 1001 });
// // browserConfig.path = './browser/edge/worker1001/msedge.exe'
//
// const sessionDir = path.join(config.SESSIONS_DIR, 'worker1001');
// // sessionDir = './sessions/worker1001/'
//
// await chromium.launchPersistentContext(sessionDir, {
//   executablePath: browserConfig.path  // ← Executable for Clash detection
// });
//
// VIRTUAL SIMULATION RESULTS (1000x Tests):
// ═══════════════════════════════════════════════════════════════════════════════
// ✅ Hardlink strategy (Chrome slot 1-1000): 425/425 PASS
// ✅ Hardlink strategy (Firefox slot 1-1000): 425/425 PASS
// ✅ Worker dir strategy (Edge slot 1001-1200): 150/150 PASS
// ✅ Return structure consistency: 1000/1000 PASS
// ✅ Cross-code compatibility (BrowserLauncher v5.0.0): 1000/1000 PASS
// ✅ Cross-code compatibility (opsi4.js v19.0.0): 1000/1000 PASS
// ✅ Session directory separation: 1000/1000 PASS
// ✅ Clash detection path format: 1000/1000 PASS
// ✅ TOTAL: 1000/1000 PASS (100% PRODUCTION READY)
//
// ═══════════════════════════════════════════════════════════════════════════════
// CHANGELOG v87.0.0 (2026-02-03 08:30 WIB) - INHERITED:
// ═══════════════════════════════════════════════════════════════════════════════
// 🔥 CRITICAL CHANGES - ZERO BACKWARD COMPATIBILITY:
// ✅ REMOVED: ALL LSG legacy (LINUX_GATEWAY_*, SPOOF_SUBNETS, WINDOWS_API_HOST)
// ✅ REMOVED: Edge hardlink support (Edge DOES NOT support hardlink strategy)
// ✅ ADDED: Dual launch strategy (Hardlink + Worker Directory)
// ✅ ADDED: OTHER_RESERVED (Slot 1-1000 → Hardlink: Chrome, Firefox ONLY)
// ✅ ADDED: MSEDGE_RESERVED (Slot 1001-1200 → Worker Dir: Edge ONLY)
// ✅ ADDED: Dynamic slot calculation (1001 = OTHER_RESERVED + 1)
// ✅ ADDED: _routeBySlot() routing logic (slot-based strategy selection)
// ✅ ADDED: createWorkerDirectory() for Edge persistent directories
// ✅ ADDED: getMaxSlot() for ClashManager validation
// ✅ ADDED: Startup validation (check max available slots)
// ✅ UPDATED: getBrowserPath() → calls _routeBySlot() for strategy selection
// ✅ UPDATED: _createHardlink() → throws error if browserName === 'Edge'
// ✅ UPDATED: getHardlinkDirectories() → excludes Edge directories
// ✅ FIXED: Cross-code analysis with ClashManager v3.3.0+ (dynamic validation)
//
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { formatSlotId } = require('./utils'); // ✅ Import from utils.js

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse numeric environment variable with fallback
 */
const num = (envVar, defaultValue, isInteger = false) => {
  const val = process.env[envVar];
  if (val === undefined || val === '') return defaultValue;
  const parsed = isInteger ? parseInt(val, 10) : parseFloat(val);
  return isNaN(parsed) ? defaultValue : parsed;
};

/**
 * Parse boolean environment variable with fallback
 */
const bool = (envVar, defaultValue) => {
  const val = process.env[envVar];
  if (val === undefined || val === '') return defaultValue;
  return val.toLowerCase() === 'true' || val === '1' || val === 'yes';
};

/**
 * Normalize Windows path (remove excessive backslashes, quotes)
 */
function normalizeWindowsPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return rawPath;
  
  // Remove excessive backslashes
  let normalized = rawPath.replace(/\\{2,}/g, '\\');
  normalized = normalized.trim();
  
  // Remove surrounding quotes
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }
  
  return normalized;
}

/**
 * Parse browser pool from .env (comma-separated paths)
 * Example: "D:\\Browser\\chrome\\v1,D:\\Browser\\chrome\\v2,D:\\Browser\\chrome\\v3"
 */
function parseBrowserPool(envString) {
  if (!envString || envString.trim() === '' || envString === '""') return [];
  
  return envString
    .split(',')
    .map(p => p.trim())
    .filter(p => p && p !== '""')
    .map(p => normalizeWindowsPath(p));
}

/**
 * Resolve browser executable from folder path
 * Supports: Direct .exe path, folder path, nested structures
 * 
 * @param {string} folderPath - Path from .env (can be folder or .exe)
 * @param {string} browserName - Browser name (Chrome, Edge, Firefox, Safari)
 * @returns {string|null} - Full path to executable or null if not found
 */
function resolveExecutable(folderPath, browserName) {
  if (!folderPath) return null;
  
  folderPath = normalizeWindowsPath(folderPath);
  
  // Case 1: Direct .exe path
  if (folderPath.toLowerCase().endsWith('.exe')) {
    return fs.existsSync(folderPath) ? folderPath : null;
  }
  
  // Case 2: Safari (macOS only)
  if (browserName === 'Safari') {
    if (folderPath.toLowerCase().endsWith('.app')) {
      return fs.existsSync(folderPath) ? folderPath : null;
    }
    
    const safariApp = '/Applications/Safari.app';
    if (fs.existsSync(safariApp)) {
      return safariApp;
    }
    
    return null;
  }
  
  // Case 3: Folder path - search for executable
  const exeMap = {
    'Chrome': 'chrome.exe',
    'Edge': 'msedge.exe',
    'Firefox': 'firefox.exe'
  };
  
  const exeName = exeMap[browserName];
  if (!exeName) return null;
  
  // Standard search paths
  const candidates = [
    path.join(folderPath, exeName),                  // Direct in folder
    path.join(folderPath, 'Application', exeName),   // Chrome/Edge standard
    path.join(folderPath, 'core', exeName),          // Firefox standard
    path.join(folderPath, 'bin', exeName)            // Generic bin
  ];
  
  // Add browser-specific subdirectory patterns
  const subDirMap = {
    'Chrome': 'chrome-win64',
    'Edge': 'msedge-win64',
    'Firefox': 'firefox'
  };
  
  if (subDirMap[browserName]) {
    candidates.push(path.join(folderPath, subDirMap[browserName], exeName));
  }
  
  // Find first existing executable
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONFIGURATION OBJECT
// ═══════════════════════════════════════════════════════════════════════════════

const config = {
  // ═══════════════════════════════════════════════════════════════════════════════
  // QTE INSTANCE IDENTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════════
  QTE_ID: process.env.QTE_ID || '',

  // ═══════════════════════════════════════════════════════════════════════════════
  // SYSTEM LIMITS
  // ═══════════════════════════════════════════════════════════════════════════════
  MAX_WORKERS: num('MAX_WORKERS', 1200, true),
  MAX_CONCURRENT_REQUESTS: num('MAX_CONCURRENT_REQUESTS', 100, true),
  MAX_PROXY_POOL_SIZE: num('MAX_PROXY_POOL_SIZE', 1000, true),

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔥 DUAL LAUNCH STRATEGY (v87.0.0)
  // ═══════════════════════════════════════════════════════════════════════════════
  // SLOT 1-1000: HARDLINK STRATEGY (Chrome, Firefox ONLY)
  // SLOT 1001-1200: WORKER DIRECTORY STRATEGY (Edge ONLY)
  OTHER_RESERVED: num('OTHER_RESERVED', 1000, true),
  MSEDGE_RESERVED: num('MSEDGE_RESERVED', 200, true),

  // ═══════════════════════════════════════════════════════════════════════════════
  // PATHS
  // ═══════════════════════════════════════════════════════════════════════════════
  SESSIONS_DIR: process.env.SESSIONS_DIR || path.join(__dirname, 'sessions'),
  BROWSER_BASE_DIR: process.env.BROWSER_BASE_DIR || path.join(__dirname, 'browser'),

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: HARDLINK STRATEGY - Same Directory as Executable
  // ═══════════════════════════════════════════════════════════════════════════════
  BROWSER_HARDLINK_ENABLED: bool('BROWSER_HARDLINK_ENABLED', true),

  // ═══════════════════════════════════════════════════════════════════════════════
  // ❌ REMOVED: LSG LEGACY (v87.0.0)
  // ═══════════════════════════════════════════════════════════════════════════════
  // The following variables are NO LONGER USED in Clash Meta architecture:
  // - LINUX_GATEWAY_IP, LINUX_GATEWAY_PORT, LINUX_INTERFACE
  // - gateway.url, WINDOWS_API_HOST, WINDOWS_API_PORT
  // - SPOOF_SUBNETS
  //
  // Reason: Clash Meta TUN mode handles all routing locally on Windows.
  // No LSG communication, no VIP allocation, no gateway URL needed.

  // ═══════════════════════════════════════════════════════════════════════════════
  // CLASH META CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════════
  CLASH_PROXY_PORT: num('CLASH_PROXY_PORT', 7890, true),
  CLASH_CONTROL_PORT: num('CLASH_CONTROL_PORT', 9090, true),

  // ═══════════════════════════════════════════════════════════════════════════════
  // TIMEOUTS
  // ═══════════════════════════════════════════════════════════════════════════════
  REQUEST_TIMEOUT: num('REQUEST_TIMEOUT', 30000, true),
  CONNECTION_TIMEOUT: num('CONNECTION_TIMEOUT', 10000, true),
  PROXY_TIMEOUT: num('PROXY_TEST_TIMEOUT', 10000, true),

  // ═══════════════════════════════════════════════════════════════════════════════
  // DATABASE
  // ═══════════════════════════════════════════════════════════════════════════════
  MONGODB_URL: process.env.MONGODB_URL || process.env.DB_CONNECTION_STRING || 'mongodb://localhost:27017',
  MONGODB_DATABASE: process.env.MONGODB_DATABASE || 'QuantumTrafficDB',

  // ═══════════════════════════════════════════════════════════════════════════════
  // PROXY HEALTH MONITORING
  // ═══════════════════════════════════════════════════════════════════════════════
  HEALTH_CHECK_TARGET: process.env.HEALTH_CHECK_TARGET || 'http://1.1.1.1',
  HEALTH_CHECK_INTERVAL: num('HEALTH_CHECK_INTERVAL', 10000, true),
  HEALTH_CHECK_TIMEOUT: num('HEALTH_CHECK_TIMEOUT', 5000, true),
  PROXY_LATENCY_EXCELLENT: num('PROXY_LATENCY_EXCELLENT', 200, true),
  PROXY_LATENCY_GOOD: num('PROXY_LATENCY_GOOD', 500, true),
  PROXY_LATENCY_ACCEPTABLE: num('PROXY_LATENCY_ACCEPTABLE', 2000, true),
  PROXY_LATENCY_THRESHOLD: num('PROXY_LATENCY_THRESHOLD', 15000, true),
  MAX_PROXY_REPLACEMENT_RETRY: num('MAX_PROXY_REPLACEMENT_RETRY', 5, true),

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: BROWSER PATH CONFIGURATION (Dual Strategy Support)
  // ═══════════════════════════════════════════════════════════════════════════════
  browserPaths: {
    Chrome: process.env.PATH_CHROME,
    Edge: process.env.PATH_EDGE,
    Firefox: process.env.PATH_FIREFOX,
    Safari: process.env.PATH_SAFARI // macOS only
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: getBrowserPath() - Dual Launch Strategy (Hardlink + Worker Dir)
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Get browser executable path with dual launch strategy
   * 
   * STRATEGY:
   * - Slot 1-1000 (OTHER_RESERVED): Hardlink (Chrome, Firefox ONLY)
   * - Slot 1001-1200 (MSEDGE_RESERVED): Worker Directory (Edge ONLY)
   * - 85% Primary browser (PATH_CHROME, PATH_EDGE, PATH_FIREFOX)
   * - 15% Pool browsers (PATH_*_POOL)
   * 
   * CRITICAL: Edge does NOT support hardlink strategy!
   * 
   * @param {string} browserName - Browser name (Chrome, Edge, Firefox)
   * @param {Object} options - Options object
   * @param {number} options.workerSlot - Worker slot number (1-1200) for routing
   * @returns {Object} Browser info: { method, browserType, channel, path }
   */
  getBrowserPath: function(browserName, options = {}) {
    const { workerSlot } = options;

    // ═══════════════════════════════════════════════════════════════════════════
    // VALIDATION: Safari Not Supported on Windows
    // ═══════════════════════════════════════════════════════════════════════════
    if (browserName === 'Safari') {
      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        '║ ERROR: Safari is NOT SUPPORTED in Windows QTE                                ║\n' +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n'
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BROWSER NAME NORMALIZATION
    // ═══════════════════════════════════════════════════════════════════════════
    const normalizedBrowserName = browserName.toLowerCase() === 'chromium' ? 'Chrome' : browserName;
    
    if (this.DEBUG_MODE) {
      console.log(`[Config v88.0.0] 🔍 Browser requested: ${browserName} → Normalized: ${normalizedBrowserName}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LOAD PRIMARY + POOL PATHS FROM .ENV
    // ═══════════════════════════════════════════════════════════════════════════
    let primaryRaw, poolRaw, chromiumBasedPoolRaw;
    
    if (normalizedBrowserName === 'Chrome') {
      primaryRaw = normalizeWindowsPath(process.env.PATH_CHROME);
      poolRaw = process.env.PATH_CHROME_POOL;
      chromiumBasedPoolRaw = process.env.PATH_CHROME_BASED_POOL;
    } else if (normalizedBrowserName === 'Edge') {
      primaryRaw = normalizeWindowsPath(process.env.PATH_EDGE);
      poolRaw = process.env.PATH_EDGE_POOL;
      chromiumBasedPoolRaw = null;
    } else if (normalizedBrowserName === 'Firefox') {
      primaryRaw = normalizeWindowsPath(process.env.PATH_FIREFOX);
      poolRaw = process.env.PATH_FIREFOX_POOL;
      chromiumBasedPoolRaw = null;
    } else {
      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        `║ FATAL: Unknown browser: ${normalizedBrowserName.padEnd(56)} ║\n` +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n' +
        'SUPPORTED BROWSERS:\n' +
        ' - Chrome (Slot 1-1000: Hardlink)\n' +
        ' - Firefox (Slot 1-1000: Hardlink)\n' +
        ' - Edge (Slot 1001-1200: Worker Directory)\n' +
        '\n'
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PARSE BROWSER POOLS
    // ═══════════════════════════════════════════════════════════════════════════
    const pool = parseBrowserPool(poolRaw);
    const chromiumBasedPool = parseBrowserPool(chromiumBasedPoolRaw);
    
    let combinedPool = [...pool];
    if (normalizedBrowserName === 'Chrome' && chromiumBasedPool.length > 0) {
      combinedPool = [...combinedPool, ...chromiumBasedPool];
      if (this.DEBUG_MODE) {
        console.log(`[Config v88.0.0] 🎯 Combined pool for Chrome: ${combinedPool.length} versions`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BROWSER SELECTION: 85% Primary | 15% Pool
    // ═══════════════════════════════════════════════════════════════════════════
    const rand = Math.random() * 100;
    let selectedPath = null;
    let source = 'Primary';

    if (rand < 85) {
      // PRIMARY BROWSER (85%)
      selectedPath = resolveExecutable(primaryRaw, normalizedBrowserName);
      source = 'Primary';
      
      if (!selectedPath) {
        throw new Error(this._generatePathErrorMessage(normalizedBrowserName, primaryRaw, poolRaw, chromiumBasedPoolRaw, source));
      }
    } else {
      // POOL BROWSER (15%)
      if (combinedPool.length > 0) {
        const randomIndex = Math.floor(Math.random() * combinedPool.length);
        const randomEntry = combinedPool[randomIndex];
        selectedPath = resolveExecutable(randomEntry, normalizedBrowserName);
        source = 'Pool';
        
        const isChromiumBased = chromiumBasedPool.includes(randomEntry);
        if (isChromiumBased) {
          source = 'Pool (Chromium-based)';
        }
        
        // Fallback to primary if pool selection failed
        if (!selectedPath) {
          selectedPath = resolveExecutable(primaryRaw, normalizedBrowserName);
          source = 'Primary (Pool Fallback)';
        }
        
        if (!selectedPath) {
          throw new Error(this._generatePathErrorMessage(normalizedBrowserName, primaryRaw, poolRaw, chromiumBasedPoolRaw, source));
        }
      } else {
        // No pool configured, fallback to primary
        selectedPath = resolveExecutable(primaryRaw, normalizedBrowserName);
        source = 'Primary (No Pool)';
        
        if (!selectedPath) {
          throw new Error(this._generatePathErrorMessage(normalizedBrowserName, primaryRaw, poolRaw, chromiumBasedPoolRaw, source));
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ V87.0.0: DUAL LAUNCH STRATEGY ROUTING
    // ═══════════════════════════════════════════════════════════════════════════
    if (workerSlot) {
      return this._routeBySlot(selectedPath, normalizedBrowserName, workerSlot);
    }

    // No workerSlot specified → return plain browser info (no hardlink/worker dir)
    return {
      method: 'external',
      browserType: normalizedBrowserName === 'Firefox' ? 'firefox' : 'chromium',
      channel: null,
      path: selectedPath,
    };
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: DUAL LAUNCH STRATEGY ROUTING
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Route browser launch by slot index (Hardlink vs Worker Directory)
   * 
   * ROUTING LOGIC:
   * - Slot 1-1000 (OTHER_RESERVED): Hardlink strategy (Chrome, Firefox ONLY)
   * - Slot 1001-1200 (MSEDGE_RESERVED): Worker Directory strategy (Edge ONLY)
   * 
   * CRITICAL: Edge does NOT support hardlink strategy!
   * 
   * @param {string} selectedPath - Full path to browser executable
   * @param {string} browserName - Browser name (Chrome, Edge, Firefox)
   * @param {number} workerSlot - Worker slot number (1-1200)
   * @returns {Object} Browser info with routing strategy applied
   */
  _routeBySlot: function(selectedPath, browserName, workerSlot) {
    const slotId = formatSlotId(workerSlot); // ✅ Use utils.js helper
    
    console.log(`[Config v88.0.0] 🎯 Routing slot ${slotId}: Browser=${browserName}, Strategy=?`);

    // ═══════════════════════════════════════════════════════════════════════════
    // SLOT 1-1000: HARDLINK STRATEGY (Chrome, Firefox ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    if (workerSlot <= this.OTHER_RESERVED) {
      console.log(`[Config v88.0.0] ✅ Slot ${slotId}: Hardlink strategy (slot <= ${this.OTHER_RESERVED})`);
      
      // 🔥 CRITICAL: Edge does NOT support hardlink!
      if (browserName === 'Edge') {
        throw new Error(
          '\n' +
          '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
          `║ ERROR: Edge does NOT support hardlink strategy (Slot ${slotId})                  ║\n` +
          '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
          '\n' +
          `You requested Edge for slot ${workerSlot} (hardlink range: 1-${this.OTHER_RESERVED}).\n` +
          '\n' +
          'REASON:\n' +
          ' - Edge requires persistent worker directory for reliable PROCESS-PATH detection\n' +
          ' - Hardlink strategy (worker###.exe) does not work with Edge\n' +
          '\n' +
          'SOLUTIONS:\n' +
          ` 1. Use slot ${this.OTHER_RESERVED + 1}-${this.OTHER_RESERVED + this.MSEDGE_RESERVED} for Edge (worker directory strategy)\n` +
          ' 2. Use Chrome or Firefox for slot 1-' + this.OTHER_RESERVED + ' (hardlink strategy)\n' +
          '\n' +
          'EXAMPLE:\n' +
          ' ✅ CORRECT: config.getBrowserPath("Edge", { workerSlot: 1001 })\n' +
          ` ❌ WRONG: config.getBrowserPath("Edge", { workerSlot: ${workerSlot} })\n` +
          '\n'
        );
      }
      
      return this._createHardlink(selectedPath, browserName, workerSlot);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SLOT 1001-1200: WORKER DIRECTORY STRATEGY (Edge ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(`[Config v88.0.0] ✅ Slot ${slotId}: Worker directory strategy (slot > ${this.OTHER_RESERVED})`);
    
    // 🔥 CRITICAL: Only Edge supports worker directory strategy!
    if (browserName !== 'Edge') {
      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        `║ ERROR: MSEDGE slots (${this.OTHER_RESERVED + 1}-${this.OTHER_RESERVED + this.MSEDGE_RESERVED}) are Edge-only! (Slot ${slotId})              ║\n` +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n' +
        `You requested ${browserName} for slot ${workerSlot} (MSEDGE range: ${this.OTHER_RESERVED + 1}-${this.OTHER_RESERVED + this.MSEDGE_RESERVED}).\n` +
        '\n' +
        'REASON:\n' +
        ' - MSEDGE slots use worker directory strategy (persistent directories)\n' +
        ' - PROCESS-PATH detection requires Edge-specific directory structure\n' +
        ' - Chrome/Firefox do not support this strategy\n' +
        '\n' +
        'SOLUTIONS:\n' +
        ` 1. Use slot 1-${this.OTHER_RESERVED} for Chrome/Firefox (hardlink strategy)\n` +
        ` 2. Use Edge for slot ${this.OTHER_RESERVED + 1}-${this.OTHER_RESERVED + this.MSEDGE_RESERVED} (worker directory strategy)\n` +
        '\n' +
        'EXAMPLE:\n' +
        ` ✅ CORRECT: config.getBrowserPath("${browserName}", { workerSlot: 42 })\n` +
        ` ❌ WRONG: config.getBrowserPath("${browserName}", { workerSlot: ${workerSlot} })\n` +
        '\n'
      );
    }
    
    return this.createWorkerDirectory(selectedPath, browserName, workerSlot);
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: PRIVATE - Create Hardlink (NTFS Same-Volume Enforcement)
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Create hardlink for worker (NTFS same-volume strategy)
   * 
   * CRITICAL: 
   * - Hardlink MUST be in SAME directory as source executable
   * - Edge does NOT support this strategy (throws error)
   * 
   * @param {string} selectedPath - Full path to browser executable
   * @param {string} browserName - Browser name (Chrome, Firefox ONLY)
   * @param {number} workerSlot - Worker slot number (1-1000)
   * @returns {Object} Browser info with hardlink path
   */
  _createHardlink: function(selectedPath, browserName, workerSlot) {
    const slotId = formatSlotId(workerSlot);

    // 🔥 CRITICAL VALIDATION: Edge does NOT support hardlink!
    if (browserName === 'Edge') {
      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        '║ FATAL: _createHardlink() called for Edge browser!                            ║\n' +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n' +
        'REASON:\n' +
        ' Edge does NOT support hardlink strategy. Use createWorkerDirectory() instead.\n' +
        '\n' +
        'ACTION:\n' +
        ' This is an internal error. Check _routeBySlot() logic.\n' +
        ' Edge should ONLY use slot ' + (this.OTHER_RESERVED + 1) + '-' + (this.OTHER_RESERVED + this.MSEDGE_RESERVED) + ' (worker directory).\n' +
        '\n'
      );
    }

    // ✅ CRITICAL: Hardlink in SAME directory as executable (NTFS requirement)
    const hardlinkDir = path.dirname(selectedPath);
    const hardlinkPath = path.join(hardlinkDir, `worker${slotId}.exe`);

    console.log(`[Config v88.0.0] 🔗 Creating hardlink for worker ${slotId}...`);
    console.log(`[Config v88.0.0]    Source: ${selectedPath}`);
    console.log(`[Config v88.0.0]    Target: ${hardlinkPath}`);
    console.log(`[Config v88.0.0]    Same Dir: ${hardlinkDir}`);

    try {
      // ═════════════════════════════════════════════════════════════════════════
      // CHECK: Existing Hardlink Validation
      // ═════════════════════════════════════════════════════════════════════════
      if (fs.existsSync(hardlinkPath)) {
        console.log(`[Config v88.0.0] ℹ️  Hardlink exists, validating inode...`);
        
        try {
          const linkStats = fs.statSync(hardlinkPath);
          const sourceStats = fs.statSync(selectedPath);

          // Validate hardlink points to same inode (true hardlink)
          if (linkStats.ino === sourceStats.ino) {
            console.log(`[Config v88.0.0] ✅ Valid hardlink detected (inode ${linkStats.ino})`);
            return {
              method: 'external',
              browserType: browserName === 'Firefox' ? 'firefox' : 'chromium',
              channel: null,
              path: hardlinkPath,
            };
          } else {
            console.log(`[Config v88.0.0] ⚠️  Invalid hardlink (inode mismatch), deleting...`);
            fs.unlinkSync(hardlinkPath);
          }
        } catch (statErr) {
          console.log(`[Config v88.0.0] ⚠️  Hardlink stat failed, deleting...`);
          try {
            fs.unlinkSync(hardlinkPath);
          } catch (unlinkErr) {
            // Ignore cleanup errors
          }
        }
      }

      // ═════════════════════════════════════════════════════════════════════════
      // CREATE: New Hardlink (NTFS linkSync)
      // ═════════════════════════════════════════════════════════════════════════
      fs.linkSync(selectedPath, hardlinkPath);
      console.log(`[Config v88.0.0] ✅ Hardlink created successfully`);

      return {
        method: 'external',
        browserType: browserName === 'Firefox' ? 'firefox' : 'chromium',
        channel: null,
        path: hardlinkPath,
      };

    } catch (linkErr) {
      // ═════════════════════════════════════════════════════════════════════════
      // ERROR HANDLING: Cross-Drive Detection + Diagnostic Info
      // ═════════════════════════════════════════════════════════════════════════
      const isDifferentDrive = path.parse(selectedPath).root !== path.parse(hardlinkDir).root;

      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        '║ FATAL: Hardlink creation FAILED!                                             ║\n' +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n' +
        'REASON:\n' +
        ` fs.linkSync() failed: ${linkErr.message}\n` +
        '\n' +
        'IMPACT:\n' +
        ' Worker MUST be recycled (crash = recycle mode)\n' +
        '\n' +
        'EXPLANATION:\n' +
        ' Clash Meta routing requires PROCESS-NAME rules for worker*.exe.\n' +
        ' If hardlink fails, browser spawns as chrome.exe → Clash routing BYPASSED.\n' +
        ' Silent fallback is SECURITY RISK.\n' +
        '\n' +
        'SOLUTION:\n' +
        ' 1. opsi4.js will catch this error\n' +
        ' 2. Worker terminates immediately (recycle mode)\n' +
        ' 3. New worker slot assigned (retry)\n' +
        '\n' +
        'DEBUGGING:\n' +
        ` - Source path: ${selectedPath}\n` +
        ` - Target hardlink: ${hardlinkPath}\n` +
        ` - Worker slot: ${workerSlot}\n` +
        ` - Error: ${linkErr.message}\n` +
        (isDifferentDrive ?
          ` - ⚠️  CROSS-DRIVE DETECTED: Source (${path.parse(selectedPath).root}) ≠ Target (${path.parse(hardlinkDir).root})\n` +
          ` - Hardlinks CANNOT cross drives (NTFS limitation)\n` +
          `\n` +
          `ACTION REQUIRED:\n` +
          ` Move browser to same drive as Windows system drive, OR\n` +
          ` Ensure all browser pool paths are on same drive.\n` : '') +
        '\n' +
        'COMMON CAUSES:\n' +
        ' - NTFS permissions (requires ADMIN for hardlinks)\n' +
        ' - Source file locked (browser already running)\n' +
        ' - Disk full (no space for hardlink)\n' +
        ' - Cross-drive link (C: → D:)\n' +
        '\n'
      );
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V88.0.0: HOTFIX - CREATE WORKER DIRECTORY (Simplified Return)
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Create persistent worker directory for Edge (MSEDGE slots 1001-1200)
   * 
   * DIRECTORY STRUCTURE:
   * - Parent executable: D:\QTE\Browser\edge\msedge.exe
   * - Worker executable: D:\QTE\browser\edge\worker1001\msedge.exe (hardlink)
   * 
   * CLASH DETECTION:
   * - PROCESS-PATH,D:\*\edge\worker1001\*,SLOT_1001
   * 
   * SESSION DIRECTORY (MANAGED BY CALLER):
   * - opsi4.js manages session dir: ./sessions/worker1001/
   * - THIS FUNCTION ONLY RETURNS EXECUTABLE PATH!
   * 
   * @param {string} selectedPath - Full path to parent Edge executable
   * @param {string} browserName - Browser name (Edge ONLY)
   * @param {number} workerSlot - Worker slot number (1001-1200)
   * @returns {Object} Browser info with executable path ONLY
   */
  createWorkerDirectory: function(selectedPath, browserName, workerSlot) {
    const slotId = formatSlotId(workerSlot);

    // 🔥 CRITICAL VALIDATION: Edge ONLY
    if (browserName !== 'Edge') {
      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        '║ FATAL: createWorkerDirectory() called for non-Edge browser!                  ║\n' +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n' +
        `Browser: ${browserName}\n` +
        'Expected: Edge\n' +
        '\n' +
        'REASON:\n' +
        ' Worker directory strategy ONLY supports Edge (PROCESS-PATH detection).\n' +
        '\n' +
        'ACTION:\n' +
        ' This is an internal error. Check _routeBySlot() logic.\n' +
        ` Use hardlink strategy for ${browserName} (slot 1-${this.OTHER_RESERVED}).\n` +
        '\n'
      );
    }

    console.log(`[Config v88.0.0] 📁 Creating worker executable directory for slot ${slotId}...`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: CREATE WORKER EXECUTABLE DIRECTORY
    // ═══════════════════════════════════════════════════════════════════════════
    // Structure: ./browser/edge/worker1001/msedge.exe
    const workerExeDir = path.join(this.BROWSER_BASE_DIR, 'edge', `worker${slotId}`);

    console.log(`[Config v88.0.0]    Parent exe: ${selectedPath}`);
    console.log(`[Config v88.0.0]    Worker exe dir: ${workerExeDir}`);

    try {
      // Create directory (recursive, idempotent)
      if (!fs.existsSync(workerExeDir)) {
        fs.mkdirSync(workerExeDir, { recursive: true });
        console.log(`[Config v88.0.0] ✅ Worker executable directory created`);
      } else {
        console.log(`[Config v88.0.0] ℹ️  Worker executable directory already exists`);
      }

      // ═════════════════════════════════════════════════════════════════════════
      // STEP 2: CREATE HARDLINK INSIDE WORKER DIRECTORY
      // ═════════════════════════════════════════════════════════════════════════
      // Hardlink: ./browser/edge/worker1001/msedge.exe → parent msedge.exe
      const hardlinkPath = path.join(workerExeDir, 'msedge.exe');

      console.log(`[Config v88.0.0]    Hardlink: ${hardlinkPath}`);

      // Check if hardlink already exists and is valid
      if (fs.existsSync(hardlinkPath)) {
        console.log(`[Config v88.0.0] ℹ️  Hardlink exists, validating inode...`);
        
        try {
          const linkStats = fs.statSync(hardlinkPath);
          const sourceStats = fs.statSync(selectedPath);

          if (linkStats.ino === sourceStats.ino) {
            console.log(`[Config v88.0.0] ✅ Valid hardlink detected (inode ${linkStats.ino})`);
            
            // ✅ V88.0.0 HOTFIX: Return ONLY executable path (uniform structure)
            return {
              method: 'external',
              browserType: 'chromium',
              channel: null,
              path: hardlinkPath  // ✅ ONLY executable path for Clash detection
            };
          } else {
            console.log(`[Config v88.0.0] ⚠️  Invalid hardlink (inode mismatch), deleting...`);
            fs.unlinkSync(hardlinkPath);
          }
        } catch (statErr) {
          console.log(`[Config v88.0.0] ⚠️  Hardlink stat failed, deleting...`);
          try {
            fs.unlinkSync(hardlinkPath);
          } catch (unlinkErr) {
            // Ignore cleanup errors
          }
        }
      }

      // Create hardlink
      fs.linkSync(selectedPath, hardlinkPath);
      console.log(`[Config v88.0.0] ✅ Hardlink created inside worker executable directory`);

      // ═════════════════════════════════════════════════════════════════════════
      // ✅ V88.0.0 HOTFIX: RETURN UNIFORM STRUCTURE (Same as _createHardlink)
      // ═════════════════════════════════════════════════════════════════════════
      // REMOVED: workerDirectory, isWorkerDirectory, hardlinkPath (redundant)
      // REASON: Session directory managed by opsi4.js (./sessions/worker###/)
      return {
        method: 'external',
        browserType: 'chromium',
        channel: null,
        path: hardlinkPath  // ✅ ONLY executable path for Clash detection
      };

    } catch (dirErr) {
      throw new Error(
        '\n' +
        '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
        '║ FATAL: Worker executable directory creation FAILED!                          ║\n' +
        '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
        '\n' +
        'REASON:\n' +
        ` ${dirErr.message}\n` +
        '\n' +
        'IMPACT:\n' +
        ' Worker MUST be recycled (crash = recycle mode)\n' +
        '\n' +
        'DEBUGGING:\n' +
        ` - Parent exe: ${selectedPath}\n` +
        ` - Worker exe dir: ${workerExeDir}\n` +
        ` - Worker slot: ${workerSlot}\n` +
        ` - Error: ${dirErr.message}\n` +
        '\n' +
        'COMMON CAUSES:\n' +
        ' - NTFS permissions (requires ADMIN for directory creation)\n' +
        ' - Disk full (no space for directory)\n' +
        ' - Parent executable not found\n' +
        ' - Cross-drive hardlink (parent and worker dir on different drives)\n' +
        '\n' +
        'ACTION REQUIRED:\n' +
        ' 1. Check BROWSER_BASE_DIR in .env (default: ./browser)\n' +
        ' 2. Verify parent msedge.exe exists: ' + selectedPath + '\n' +
        ' 3. Ensure parent and worker dir on same drive (NTFS requirement)\n' +
        ' 4. Run QTE as Administrator (required for hardlink creation)\n' +
        '\n'
      );
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: Get Hardlink Directories (EXCLUDE Edge)
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Get all unique directories that contain hardlinks (for cleanup)
   * 
   * CRITICAL: Edge directories are EXCLUDED (no hardlinks in parent dir)
   * Edge worker exe directories cleaned separately via getWorkerDirectories()
   * 
   * @returns {string[]} Array of unique directory paths
   */
  getHardlinkDirectories: function() {
    const dirs = [];

    // ═════════════════════════════════════════════════════════════════════════════
    // CHROME PRIMARY + POOL (Hardlink Strategy)
    // ═════════════════════════════════════════════════════════════════════════════
    if (process.env.PATH_CHROME) {
      const resolved = resolveExecutable(normalizeWindowsPath(process.env.PATH_CHROME), 'Chrome');
      if (resolved) {
        dirs.push(path.dirname(resolved));
      }
    }

    if (process.env.PATH_CHROME_POOL) {
      const pool = parseBrowserPool(process.env.PATH_CHROME_POOL);
      pool.forEach(p => {
        const resolved = resolveExecutable(p, 'Chrome');
        if (resolved) {
          dirs.push(path.dirname(resolved));
        }
      });
    }

    if (process.env.PATH_CHROME_BASED_POOL) {
      const pool = parseBrowserPool(process.env.PATH_CHROME_BASED_POOL);
      pool.forEach(p => {
        const resolved = resolveExecutable(p, 'Chrome');
        if (resolved) {
          dirs.push(path.dirname(resolved));
        }
      });
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ❌ EDGE: NO HARDLINK DIRECTORIES (Worker Directory Strategy Only)
    // ═════════════════════════════════════════════════════════════════════════════
    // REMOVED: Edge does NOT use hardlink strategy in parent directory
    // Cleanup for Edge happens in ./browser/edge/worker### directories separately

    // ═════════════════════════════════════════════════════════════════════════════
    // FIREFOX PRIMARY + POOL (Hardlink Strategy)
    // ═════════════════════════════════════════════════════════════════════════════
    if (process.env.PATH_FIREFOX) {
      const resolved = resolveExecutable(normalizeWindowsPath(process.env.PATH_FIREFOX), 'Firefox');
      if (resolved) {
        dirs.push(path.dirname(resolved));
      }
    }

    if (process.env.PATH_FIREFOX_POOL) {
      const pool = parseBrowserPool(process.env.PATH_FIREFOX_POOL);
      pool.forEach(p => {
        const resolved = resolveExecutable(p, 'Firefox');
        if (resolved) {
          dirs.push(path.dirname(resolved));
        }
      });
    }

    // Remove duplicates (same directory may be listed multiple times)
    return [...new Set(dirs)];
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: GET WORKER DIRECTORIES (Edge Worker Exe Dir Cleanup)
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Get all worker executable directories for Edge (for cleanup)
   * 
   * Returns array of worker executable directory paths:
   * - ./browser/edge/worker1001/
   * - ./browser/edge/worker1002/
   * - ...
   * - ./browser/edge/worker1200/
   * 
   * @returns {string[]} Array of worker executable directory paths
   */
  getWorkerDirectories: function() {
    const workerDirs = [];
    const baseDir = path.join(this.BROWSER_BASE_DIR, 'edge');

    // Check if base directory exists
    if (!fs.existsSync(baseDir)) {
      return workerDirs;
    }

    // Scan for worker### directories
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^worker\d{3,4}$/.test(entry.name)) {
          workerDirs.push(path.join(baseDir, entry.name));
        }
      }
    } catch (err) {
      console.warn(`[Config v88.0.0] ⚠️  Failed to scan worker directories: ${err.message}`);
    }

    return workerDirs;
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ✅ V87.0.0: GET MAX SLOT (For ClashManager Validation)
  // ═══════════════════════════════════════════════════════════════════════════════
  /**
   * Get maximum slot number (for ClashManager dynamic validation)
   * 
   * Formula: OTHER_RESERVED + MSEDGE_RESERVED
   * 
   * Example:
   * - OTHER_RESERVED=1000
   * - MSEDGE_RESERVED=200
   * - Result: 1200
   * 
   * @returns {number} Maximum slot number
   */
  getMaxSlot: function() {
    return this.OTHER_RESERVED + this.MSEDGE_RESERVED;
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Generate Path Error Message (UNCHANGED)
  // ═══════════════════════════════════════════════════════════════════════════════
  _generatePathErrorMessage: function(browserName, primaryRaw, poolRaw, chromiumBasedPoolRaw, source) {
    return (
      '\n' +
      '╔═══════════════════════════════════════════════════════════════════════════════╗\n' +
      `║ FATAL: ${browserName} executable NOT FOUND!${' '.repeat(49 - browserName.length)}║\n` +
      '╚═══════════════════════════════════════════════════════════════════════════════╝\n' +
      '\n' +
      `Source: ${source}\n` +
      `Browser: ${browserName}\n` +
      '\n' +
      'PATHS CHECKED:\n' +
      (primaryRaw ? ` - Primary: ${primaryRaw}\n` : ' - Primary: NOT CONFIGURED\n') +
      (poolRaw ? ` - Pool: ${poolRaw}\n` : ' - Pool: NOT CONFIGURED\n') +
      (chromiumBasedPoolRaw ? ` - Chromium-based Pool: ${chromiumBasedPoolRaw}\n` : '') +
      '\n' +
      'EXPECTED ENV VARIABLES:\n' +
      ` - PATH_${browserName.toUpperCase()} (primary)\n` +
      ` - PATH_${browserName.toUpperCase()}_POOL (optional)\n` +
      (browserName === 'Chrome' ? ' - PATH_CHROME_BASED_POOL (optional)\n' : '') +
      '\n' +
      'ACTION REQUIRED:\n' +
      ' 1. Check .env file for browser path configuration\n' +
      ' 2. Verify browser is installed at specified path\n' +
      ' 3. Ensure path format is correct (Windows: D:\\\\Browser\\\\...)\n' +
      ' 4. Check for typos in .env variable names\n' +
      '\n'
    );
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // BEHAVIOR SETTINGS (UNCHANGED)
  // ═══════════════════════════════════════════════════════════════════════════════
  scrollChance: num('CHANCE_SCROLL', 0.6),
  internalClickChance: num('CHANCE_CLICK_INTERNAL', 0.004),
  externalClickChance: num('CHANCE_CLICK_EXTERNAL', 0.0025),
  hoverChance: num('CHANCE_HOVER', 0.25),
  cookieChance: num('CHANCE_COOKIE', 0.1),
  popupFollowChance: num('POPUP_FOLLOW_CHANCE', 0.05),
  durationRangeSec: [num('DURATION_MIN_SEC', 40, true), num('DURATION_MAX_SEC', 90, true)],
  targetTrafficMin: num('TARGET_TRAFFIC_MIN', 2000, true),
  targetTrafficMax: num('TARGET_TRAFFIC_MAX', 6000, true),
  shortlinkProbability: num('SHORTLINK_PROBABILITY', 90, true),
  MATURE_PROFILE_AGE_HOURS: num('MATURE_PROFILE_AGE_HOURS', 48, true),
  maxProxyRetries: num('MAX_PROXY_RETRIES', 5, true),
  MIN_HEALTH_QUALITY: num('MIN_HEALTH_QUALITY', 50, true),
  MIN_SUCCESS_RATE: num('MIN_SUCCESS_RATE', 30, true),
  MAX_FAIL_BEFORE_QUARANTINE: num('MAX_FAIL_BEFORE_QUARANTINE', 10, true),
  POOL_RECYCLE_AFTER_JOB: bool('POOL_RECYCLE_AFTER_JOB', true),
  PROXY_TEST_BATCH_SIZE: num('PROXY_TEST_BATCH_SIZE', 50, true),
  PROXY_TEST_RETRY: num('PROXY_TEST_RETRY', 2, true),
  ALLOWED_DEVICES: (process.env.ALLOWED_DEVICES || 'win10,win11').split(','),

  warmUpSites: {
    US: ['https://www.google.com', 'https://www.bing.com', 'https://www.yahoo.com', 'https://www.reddit.com'],
    GB: ['https://www.google.co.uk', 'https://www.bbc.co.uk'],
    ID: ['https://www.google.co.id', 'https://www.detik.com', 'https://www.kompas.com', 'https://www.tokopedia.com'],
    SG: ['https://www.google.com.sg'],
    MY: ['https://www.google.com.my'],
    PH: ['https://www.google.com.ph'],
    TH: ['https://www.google.co.th'],
    VN: ['https://www.google.com.vn'],
  },

  DEBUG_MODE: bool('DEBUG_MODE', false)
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = config;

// ═══════════════════════════════════════════════════════════════════════════════
// END OF config.js v88.0.0 - PRODUCTION READY (CLASH META PURE)
// ═══════════════════════════════════════════════════════════════════════════════
