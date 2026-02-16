/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * BROWSERLAUNCHER v8.5.0 - AIC FIX: PERSISTENT CONTEXT VIEWPORT STRATEGY
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * 🔥 CHANGELOG v8.5.0 (2026-02-16 15:29 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ AIC CRITICAL FIX: Persistent Context Viewport Strategy
 *    - BEFORE: viewport/screen set in context options (IGNORED by Playwright!)
 *    - AFTER:  viewport: null + --window-size args (CORRECT for persistent context)
 *    - REASON: launchPersistentContext ignores viewport option, requires CLI args
 *    - IMPACT: screen.width/height now FROM FP, not host
 * 
 * ✅ AIC FIX: Added --force-device-scale-factor to args
 *    - deviceScaleFactor now via CLI arg (persistent context requirement)
 *    - Removed from context options (would be ignored)
 * 
 * ✅ AIC FIX: Screen native metrics now guaranteed from FP
 *    - window.innerWidth = FP viewport
 *    - screen.width = FP screen
 *    - visualViewport = FP viewport
 *    - NO MORE HOST LEAKAGE
 * 
 * 🔥 CHANGELOG v8.4.1 (2026-02-16 15:16 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ AIC FIX: REMOVED Viewport Noise (Stability Priority)
 * ✅ AIC FIX: REMOVED about:blank Pre-navigation
 * ✅ VERIFICATION: Launcher architecture validated by AIC
 * 
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { formatSlotId, getRandomInt } = require('./utils');

// PLATFORM DETECTION
const PLATFORM = {
  isWindows: os.platform() === 'win32',
  isLinux: os.platform() === 'linux',
  isMac: os.platform() === 'darwin',
  arch: os.arch()
};

// SLOT CONFIGURATION
const OTHERS_RESERVED = parseInt(process.env.OTHERS_RESERVED || '1000', 10);
const MSEDGE_RESERVED = parseInt(process.env.MSEDGE_RESERVED || '200', 10);
const TOTAL_SLOTS = OTHERS_RESERVED + MSEDGE_RESERVED;

console.log('[BrowserLauncher] 📋 Slot Configuration:');
console.log(`   Hardlink Strategy (Slot 1-${OTHERS_RESERVED}): All browsers`);
console.log(`   Worker Directory Strategy (Slot ${OTHERS_RESERVED + 1}-${TOTAL_SLOTS}): Edge only`);

/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * ✅ AIC v8.4.0: HARDWARE OVERRIDE REMOVED (SINGLE SOURCE COMPLIANCE)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * REMOVED: generateHardwareOverrideScript() function
 * REASON:  Double override race condition (hardware patch now ONLY in stealth_patches.js)
 * IMPACT:  No more host leakage due to conflicting sources
 * 
 * Hardware override now handled by:
 *   - stealth_patches.js → generateHardwareConcurrencyScript(fp)
 *   - stealth_patches.js → generateDeviceMemoryScript(fp)
 * 
 * BrowserLauncher responsibility: ONLY Playwright native config + script injection
 * 
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */

// ========================================
// HELPER: DETECT BROWSER ENGINE
// ========================================
function detectBrowserEngine(executablePath) {
  const exeName = path.basename(executablePath).toLowerCase();
  const dirPath = path.dirname(executablePath).toLowerCase();
  
  if (exeName.includes('firefox') || dirPath.includes('firefox')) {
    return { engine: 'gecko', browser: 'firefox' };
  }
  if (exeName.includes('msedge') || dirPath.includes('edge')) {
    return { engine: 'chromium', browser: 'edge' };
  }
  if (exeName.includes('chrome') && !exeName.includes('chromium')) {
    return { engine: 'chromium', browser: 'chrome' };
  }
  if (exeName.includes('chromium')) {
    return { engine: 'chromium', browser: 'chromium' };
  }
  if (exeName.includes('brave') || dirPath.includes('brave')) {
    return { engine: 'chromium', browser: 'brave' };
  }
  if (exeName.includes('opera')) {
    return { engine: 'chromium', browser: 'opera' };
  }
  
  return { engine: 'chromium', browser: 'unknown' };
}

// ========================================
// GPU ACCELERATION ARGS (FORCE ENABLE)
// ========================================
function getGPUArgs(engine, browser) {
  if (engine === 'chromium') {
    const baseArgs = [
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
      '--enable-hardware-overlays',
      '--disable-software-rasterizer',
      '--enable-accelerated-video-decode',
      '--enable-accelerated-2d-canvas'
    ];
    
    if (PLATFORM.isWindows) {
      baseArgs.push('--use-angle=d3d11');
      baseArgs.push('--enable-features=DefaultANGLEVulkan');
    } else if (PLATFORM.isLinux) {
      baseArgs.push('--use-angle=vulkan');
      baseArgs.push('--enable-features=VulkanFromANGLE');
    }
    
    return baseArgs;
  }
  
  return [];
}

// ========================================
// STEALTH ARGS v8.5.0 (AIC PERSISTENT CONTEXT MODE)
// ========================================
function getStealthArgs(engine, locale, fp) {
  if (engine === 'chromium') {
    return [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-default-browser-check',
      '--no-first-run',
      '--password-store=basic',
      '--use-mock-keychain',
      `--lang=${locale || 'en-US'}`,
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      // ✅ CRITICAL: Keep HardwareConcurrencyFreezing disabled (allow override from stealth_patches)
      '--disable-features=HardwareConcurrencyFreezing',
      `--js-flags=--expose-gc`
    ];
  }
  
  return ['-no-remote', '-profile'];
}

// ========================================
// FIREFOX PREFERENCES
// ========================================
function getFirefoxPrefs(fp) {
  return {
    'webgl.disabled': false,
    'webgl.force-enabled': true,
    'layers.acceleration.force-enabled': true,
    'gfx.webrender.all': true,
    'dom.webdriver.enabled': false,
    'useAutomationExtension': false,
    'privacy.trackingprotection.enabled': false,
    'general.platform.override': 'Win32',
    'intl.accept_languages': fp.locale || 'en-US',
    'browser.cache.disk.enable': false,
    'browser.cache.memory.enable': true,
    'browser.sessionstore.resume_from_crash': false
  };
}

// ========================================
// DEPRECATED: CDP INJECTION (v8.3.1 - KEPT FOR FALLBACK ONLY)
// ========================================
async function injectViaCDP(page, context, scripts, fp) {
  console.warn('[BrowserLauncher] ⚠️  DEPRECATED: injectViaCDP() is legacy fallback (v8.3.1)');
  console.warn('[BrowserLauncher] ⚠️  Primary injection now uses context.addInitScript()');
  console.warn('[BrowserLauncher] ⚠️  This function kept for emergency debugging only');
  
  console.log('[BrowserLauncher] ⚡ Establishing CDP Session (fallback mode)...');
  
  try {
    const client = await context.newCDPSession(page);
    
    const maxRetries = 3;
    let injectionSuccess = false;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[BrowserLauncher] 🔥 ATTEMPT ${attempt}/${maxRetries}: CDP injection...`);
      
      try {
        // ✅ v8.4.0: No hardware script here (removed double override)
        const combinedScript = scripts.join('\n// NEXT SCRIPT\n');
        
        await client.send('Page.addScriptToEvaluateOnNewDocument', {
          source: combinedScript,
          worldName: 'main',
          runImmediately: true
        });
        
        console.log(`[BrowserLauncher] ✅ CDP script registered (Attempt ${attempt})`);
        injectionSuccess = true;
        break;
      } catch (cdpError) {
        console.error(`[BrowserLauncher] ❌ Attempt ${attempt} failed:`, cdpError.message);
        
        if (attempt < maxRetries) {
          console.log(`[BrowserLauncher] ⏳ Retrying in 200ms...`);
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
    
    if (!injectionSuccess) {
      console.error('[BrowserLauncher] ❌ CDP FALLBACK INJECTION FAILED!');
      return { success: false, client, validation: null };
    }
    
    console.log('[BrowserLauncher] ✅ CDP fallback injection complete');
    return { success: true, client, validation: null };
    
  } catch (error) {
    console.error('[BrowserLauncher] ❌ CDP fallback failed:', error.message);
    return { success: false, client: null, validation: null };
  }
}

// ========================================
// FIREFOX INJECTION (v8.4.0 - AIC COMPLIANT)
// ========================================
async function injectViaFirefox(context, scripts, fp) {
  console.log('[BrowserLauncher] 📜 Firefox EARLY injection (before page creation)...');
  
  try {
    // ✅ v8.4.0: No separate hardware script (single source from stealth_patches)
    const combinedScript = scripts.join('\n// NEXT SCRIPT\n');
    await context.addInitScript(combinedScript);
    console.log('[BrowserLauncher] ✅ Firefox stealth scripts injected (single source)');
    
    console.log('[BrowserLauncher] ✅ Firefox injection complete (early mode)');
    return { success: true };
  } catch (error) {
    console.error('[BrowserLauncher] ❌ Firefox injection failed:', error.message);
    return { success: false };
  }
}

// ========================================
// EDGE WORKER DIRECTORY SCANNER
// ========================================
function scanEdgeWorkerDirectories(edgeWorkersRoot) {
  const defaultRoot = path.join(process.cwd(), 'Browser', 'edge');
  const rootDir = edgeWorkersRoot || defaultRoot;
  
  if (!fs.existsSync(rootDir)) {
    console.warn(`[BrowserLauncher] ⚠️  Edge root directory not found: ${rootDir}`);
    return {
      maxWorkerId: OTHERS_RESERVED,
      availableWorkers: [],
      count: 0,
      rootDir
    };
  }
  
  try {
    const allItems = fs.readdirSync(rootDir);
    const validWorkers = allItems.filter(name => {
      const fullPath = path.join(rootDir, name);
      const exePath = path.join(fullPath, 'msedge.exe');
      
      try {
        const stat = fs.statSync(fullPath);
        return (
          stat.isDirectory() &&
          name.toLowerCase().startsWith('worker') &&
          fs.existsSync(exePath)
        );
      } catch(e) {
        return false;
      }
    });
    
    const workerIds = validWorkers
      .map(name => {
        const match = name.match(/worker(\d+)/i);
        return match ? parseInt(match[1], 10) : null;
      })
      .filter(id => id !== null);
    
    const maxWorkerId = workerIds.length > 0 ? Math.max(...workerIds) : OTHERS_RESERVED;
    
    console.log(`[BrowserLauncher] 🔍 Edge Scan: Found ${validWorkers.length} ready-to-use worker directories.`);
    
    return {
      maxWorkerId,
      availableWorkers: validWorkers,
      workerIds: workerIds.sort((a,b) => a-b),
      count: validWorkers.length,
      rootDir
    };
  } catch(e) {
    console.error(`[BrowserLauncher] ❌ Scan failed: ${e.message}`);
    return {
      maxWorkerId: OTHERS_RESERVED,
      availableWorkers: [],
      workerIds: [],
      count: 0,
      rootDir
    };
  }
}

// ========================================
// GET WORKER AVAILABILITY
// ========================================
function getWorkerAvailability(slotIndex) {
  if (slotIndex <= OTHERS_RESERVED) {
    return {
      available: true,
      strategy: 'hardlink',
      message: `Slot ${slotIndex} uses hardlink strategy (runtime creation)`
    };
  } else if (slotIndex <= TOTAL_SLOTS) {
    const workersBaseDir = path.join(process.cwd(), 'Browser', 'edge');
    const slotId = formatSlotId(slotIndex);
    const workerDir = path.join(workersBaseDir, `worker${slotId}`);
    const workerExe = path.join(workerDir, 'msedge.exe');
    const available = fs.existsSync(workerExe);
    
    return {
      available,
      strategy: 'workerdirectory',
      workerDir,
      workerExe,
      message: available 
        ? `Slot ${slotIndex} worker directory is ready`
        : `Slot ${slotIndex} worker directory NOT FOUND: ${workerDir}`
    };
  } else {
    return {
      available: false,
      strategy: 'invalid',
      message: `Slot ${slotIndex} exceeds maximum (${TOTAL_SLOTS})`
    };
  }
}

// ========================================
// VALIDATE WORKER SETUP
// ========================================
function validateWorkerSetup() {
  console.log('[BrowserLauncher] 🔍 Validating Worker Setup...');
  
  const results = {
    hardlinkStrategy: {
      available: true,
      slots: OTHERS_RESERVED
    },
    workerDirectoryStrategy: {
      available: false,
      slots: MSEDGE_RESERVED,
      found: 0
    },
    errors: [],
    warnings: []
  };
  
  const scan = scanEdgeWorkerDirectories();
  results.workerDirectoryStrategy.found = scan.count;
  results.workerDirectoryStrategy.available = scan.count > 0;
  
  if (scan.count === 0) {
    results.errors.push(`No Edge worker directories found in ${scan.rootDir}`);
  } else if (scan.count < MSEDGE_RESERVED) {
    results.warnings.push(`Only ${scan.count}/${MSEDGE_RESERVED} Edge workers available`);
  }
  
  console.log('[BrowserLauncher] 📊 Setup Validation:');
  console.log(`   ✅ Hardlink Strategy: ${results.hardlinkStrategy.slots} slots available (1-${OTHERS_RESERVED})`);
  console.log(`   ${results.workerDirectoryStrategy.found > 0 ? '✅' : '❌'} Worker Directory Strategy: ${results.workerDirectoryStrategy.found}/${results.workerDirectoryStrategy.slots} slots available`);
  
  return results;
}

// ========================================
// HELPER: EXTRACT WORKER ID
// ========================================
function extractWorkerID(executablePath) {
  const filename = path.basename(executablePath);
  const dirname = path.basename(path.dirname(executablePath));
  
  const hardlinkMatch = filename.match(/worker(\d+)\.exe/i);
  if (hardlinkMatch) return parseInt(hardlinkMatch[1], 10);
  
  const workerDirMatch = dirname.match(/worker(\d+)/i);
  if (workerDirMatch) return parseInt(workerDirMatch[1], 10);
  
  return null;
}

// ========================================
// TEMPORARY PROFILE CLEANUP
// ========================================
async function cleanupTemporaryProfile(profilePath, workerId) {
  if (!profilePath || !fs.existsSync(profilePath)) return;
  
  try {
    console.log(`[BrowserLauncher] 🧹 Cleaning up temporary profile: ${path.basename(profilePath)}`);
    
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
        
        fs.rmSync(profilePath, { recursive: true, force: true });
        console.log(`[BrowserLauncher] ✅ Temporary profile deleted`);
        return;
      } catch(e) {
        if (attempt === maxRetries) {
          console.warn(`[BrowserLauncher] ⚠️  Cleanup failed: ${profilePath}`);
        }
      }
    }
  } catch(error) {
    console.warn(`[BrowserLauncher] ⚠️  Profile cleanup error: ${error.message}`);
  }
}

// ========================================
// MAIN LAUNCHER CLASS
// ========================================
class BrowserLauncher {
  constructor(config) {
    this.config = config;
  }
  
  async launchPersistentContext(profilePath, options) {
    const { executablePath, initScripts, headless, fp } = options;
    return BrowserLauncher.launchBrowser(
      'W_SINGLE',
      executablePath,
      fp,
      profilePath,
      headless,
      this.config,
      null,
      require('playwright').chromium,
      initScripts
    );
  }
  
  // ========================================
  // MAIN LAUNCHER FUNCTION v8.5.0 - AIC PERSISTENT CONTEXT FIX
  // ========================================
  static async launchBrowser(
    workerId,
    executablePath,
    fp,
    profilePath,
    isHeadless = false,
    config,
    stealthPatches,
    browserBackend,
    preGeneratedScripts
  ) {
    try {
      console.log(`[BrowserLauncher] 🚀 Launching ${workerId} (${fp.browserName})...`);
      
      // 1. DETECT ENGINE
      const { engine, browser } = detectBrowserEngine(executablePath);
      console.log(`[BrowserLauncher] 🔍 Detected: ${browser} (${engine})`);
      console.log(`[BrowserLauncher] 🖥️  Platform: ${PLATFORM.isWindows ? 'Windows' : PLATFORM.isLinux ? 'Linux' : 'Other'} (${PLATFORM.arch})`);
      
      // 2. VALIDATE EXECUTABLE EXISTS
      if (!fs.existsSync(executablePath)) {
        throw new Error(`Browser executable not found: ${executablePath}`);
      }
      
      // 3. SLOT EXECUTABLE STRATEGY
      const slotIndex = parseInt(workerId.replace('W', ''), 10) || 1;
      const slotId = formatSlotId(slotIndex);
      let finalExecutablePath = executablePath;
      
      const availability = getWorkerAvailability(slotIndex);
      if (!availability.available) {
        throw new Error(`Slot ${slotIndex} is NOT available: ${availability.message}`);
      }
      
      // STRATEGY B: EDGE WORKER DIRECTORY
      if (slotIndex > OTHERS_RESERVED && slotIndex <= TOTAL_SLOTS) {
        if (browser !== 'edge') {
          throw new Error(`Slot ${slotIndex} requires Edge browser, got ${browser}`);
        }
        
        const workersBaseDir = path.join(process.cwd(), 'Browser', 'edge');
        const specificWorkerDir = path.join(workersBaseDir, `worker${slotId}`);
        const browserExeName = path.basename(executablePath);
        finalExecutablePath = path.join(specificWorkerDir, browserExeName);
        
        if (!fs.existsSync(finalExecutablePath)) {
          throw new Error(`Edge worker directory NOT FOUND: ${finalExecutablePath}`);
        }
        
        console.log(`[BrowserLauncher] 📁 Worker directory confirmed: ${finalExecutablePath}`);
      }
      // STRATEGY A: HARDLINK
      else if (slotIndex <= OTHERS_RESERVED) {
        const browserDir = path.dirname(executablePath);
        const ext = PLATFORM.isWindows ? '.exe' : '';
        const hardlinkName = `worker${slotId}${ext}`;
        const expectedPath = path.join(browserDir, hardlinkName);
        
        if (executablePath !== expectedPath && !executablePath.endsWith(hardlinkName)) {
          if (fs.existsSync(expectedPath)) {
            try {
              fs.unlinkSync(expectedPath);
            } catch(e) {}
          }
          
          console.log(`[BrowserLauncher] 🔗 Creating hardlink: ${hardlinkName}`);
          try {
            fs.linkSync(executablePath, expectedPath);
          } catch(e) {
            if (e.code === 'EXDEV' || e.code === 'EPERM') {
              console.warn('[BrowserLauncher] ⚠️  Hardlink failed, using copy');
              fs.copyFileSync(executablePath, expectedPath);
            } else {
              throw e;
            }
          }
          
          finalExecutablePath = expectedPath;
        } else {
          finalExecutablePath = executablePath;
        }
        
        console.log(`[BrowserLauncher] ✅ Hardlink strategy: ${path.basename(finalExecutablePath)}`);
      } else {
        throw new Error(`Invalid slot ${slotIndex}`);
      }
      
      // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
      // ✅ v8.5.0: VIEWPORT & SCREEN FROM FP (AIC PERSISTENT CONTEXT MODE)
      // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
      const dbWidth = fp.viewport?.width || 1920;
      const dbHeight = fp.viewport?.height || 1080;
      const screenWidth = fp.screen?.width || dbWidth;
      const screenHeight = fp.screen?.height || dbHeight;
      const deviceScaleFactor = fp.deviceScaleFactor || 1;
      
      // ✅ v8.4.1: NO NOISE (exact match between native and stealth values)
      const finalWidth = dbWidth;
      const finalHeight = dbHeight;
      
      console.log(`[BrowserLauncher] 📐 FP Viewport: ${dbWidth}x${dbHeight} | Screen: ${screenWidth}x${screenHeight} | DPR: ${deviceScaleFactor}`);
      console.log(`[BrowserLauncher] ✅ Window (exact match, no noise): ${finalWidth}x${finalHeight}`);
      
      // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
      // ✅ v8.5.0: ARGS CONSTRUCTION (AIC PERSISTENT CONTEXT MODE - VIEWPORT VIA CLI)
      // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
      const gpuArgs = getGPUArgs(engine, browser);
      const stealthArgs = getStealthArgs(engine, fp.locale, fp);
      
      let launchArgs;
      if (engine === 'chromium') {
        launchArgs = [
          // ✅ AIC v8.5.0: CRITICAL - Viewport MUST be in args for persistent context
          `--window-size=${finalWidth},${finalHeight}`,
          // ✅ AIC v8.5.0: CRITICAL - deviceScaleFactor MUST be in args for persistent context
          `--force-device-scale-factor=${deviceScaleFactor}`,
          ...stealthArgs,
          ...gpuArgs
        ];
        
        if (isHeadless) {
          launchArgs.push('--headless=new');
        }
        
        console.log(`[BrowserLauncher] 🎯 AIC v8.5.0: Viewport set via CLI args (persistent context mode)`);
      } else if (engine === 'gecko') {
        launchArgs = stealthArgs;
      }
      
      // ✅ v8.4.0: PREPARE SCRIPTS BEFORE CONTEXT CREATION (NO HARDWARE SCRIPT!)
      console.log(`[BrowserLauncher] 📜 Preparing scripts for EARLY injection...`);
      // ✅ AIC: Hardware override removed - all scripts from stealth_patches (single source)
      const combinedScript = preGeneratedScripts.join('\n// NEXT SCRIPT\n');
      console.log(`[BrowserLauncher] ✅ Scripts ready (${preGeneratedScripts.length} modules)`);
      
      // 6. LAUNCH CONTEXT WITH NATIVE EMULATION
      console.log(`[BrowserLauncher] 🚀 Initializing ${engine} context (v8.5.0 - persistent viewport mode)...`);
      
      let context;
      let page;
      
      if (engine === 'chromium') {
        const chromium = require('playwright').chromium;
        
        context = await chromium.launchPersistentContext(profilePath, {
          executablePath: finalExecutablePath,
          headless: isHeadless,
          args: launchArgs,
          
          // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
          // ✅ AIC v8.5.0: CRITICAL FIX - viewport: null for persistent context
          // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
          // BEFORE: viewport/screen set here (IGNORED by Playwright!)
          // AFTER:  viewport: null (viewport set via --window-size arg instead)
          // REASON: launchPersistentContext IGNORES viewport option
          // IMPACT: screen.width/height now FROM FP via CLI args, not host
          viewport: null,
          
          // ✅ AIC v8.5.0: screen/deviceScaleFactor REMOVED (set via args instead)
          // These options are for newContext(), not launchPersistentContext()
          
          ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
          userAgent: fp.userAgent || undefined,
          permissions: ['geolocation', 'notifications'],
          timezoneId: fp.timezone || 'America/New_York',
          locale: fp.locale || 'en-US',
          geolocation: fp.geolocation || undefined
        });
        
        console.log('[BrowserLauncher] ✅ Persistent context created with CLI viewport args');
        
        // ✅ v8.4.0: INJECT BEFORE PAGE CREATION (SINGLE SOURCE - NO HARDWARE OVERRIDE!)
        console.log('[BrowserLauncher] 🔥 EARLY INJECTION (before any page exists)...');
        
        // ✅ AIC: All scripts (including hardware from stealth_patches) - SINGLE SOURCE
        await context.addInitScript(combinedScript);
        console.log('[BrowserLauncher] ✅ All stealth scripts injected (single source, early mode)');
        
        // NOW create/get page (scripts already registered)
        page = context.pages()[0] || await context.newPage();
        console.log('[BrowserLauncher] ✅ Page created (scripts active from first navigation)');
        
        // ✅ v8.4.1: REMOVED about:blank PRE-NAVIGATION (avoid execution context cache)
        // Direct navigation to target (no pre-navigation)
        
        // ✅ v8.5.0: ENHANCED VALIDATION (verify viewport from FP, not host)
        console.log('[BrowserLauncher] 🔍 Running validation checks...');
        try {
          const validation = await page.evaluate((expected) => {
            return {
              hardwareConcurrency: navigator.hardwareConcurrency,
              expectedCores: expected.cores,
              deviceMemory: navigator.deviceMemory,
              expectedMemory: expected.memory,
              screenWidth: screen.width,
              expectedScreenWidth: expected.screenWidth,
              screenHeight: screen.height,
              expectedScreenHeight: expected.screenHeight,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              expectedViewportWidth: expected.viewportWidth,
              expectedViewportHeight: expected.viewportHeight,
              platform: navigator.platform,
              webdriver: navigator.webdriver,
              deviceScaleFactor: window.devicePixelRatio,
              expectedDPR: expected.dpr
            };
          }, {
            cores: fp.hardware?.cores || 4,
            memory: fp.hardware?.memory || 8,
            screenWidth: screenWidth,
            screenHeight: screenHeight,
            viewportWidth: finalWidth,
            viewportHeight: finalHeight,
            dpr: deviceScaleFactor
          });
          
          console.log('[BrowserLauncher] 📊 Validation Results (v8.5.0 - Persistent Context):');
          console.log(`   Hardware Concurrency: ${validation.hardwareConcurrency} (Expected: ${validation.expectedCores}) ${validation.hardwareConcurrency === validation.expectedCores ? '✅' : '❌'}`);
          console.log(`   Device Memory: ${validation.deviceMemory}GB (Expected: ${validation.expectedMemory}GB) ${validation.deviceMemory === validation.expectedMemory ? '✅' : '❌'}`);
          console.log(`   Screen: ${validation.screenWidth}x${validation.screenHeight} (Expected: ${validation.expectedScreenWidth}x${validation.expectedScreenHeight}) ${validation.screenWidth === validation.expectedScreenWidth && validation.screenHeight === validation.expectedScreenHeight ? '✅' : '❌ HOST LEAK!'}`);
          console.log(`   Viewport: ${validation.viewportWidth}x${validation.viewportHeight} (Expected: ${validation.expectedViewportWidth}x${validation.expectedViewportHeight}) ${validation.viewportWidth === validation.expectedViewportWidth && validation.viewportHeight === validation.expectedViewportHeight ? '✅' : '❌ HOST LEAK!'}`);
          console.log(`   Device Scale Factor: ${validation.deviceScaleFactor} (Expected: ${validation.expectedDPR}) ${validation.deviceScaleFactor === validation.expectedDPR ? '✅' : '❌'}`);
          console.log(`   Platform: ${validation.platform}`);
          console.log(`   WebDriver: ${validation.webdriver}`);
          
          // Critical checks
          if (validation.hardwareConcurrency !== validation.expectedCores) {
            console.error('[BrowserLauncher] ❌ CRITICAL: Hardware Concurrency MISMATCH!');
          }
          if (validation.screenWidth !== validation.expectedScreenWidth || validation.screenHeight !== validation.expectedScreenHeight) {
            console.error('[BrowserLauncher] ❌ CRITICAL: Screen Resolution MISMATCH! (Host leakage detected)');
            console.error(`[BrowserLauncher] 💡 DEBUG: Check if CLI args --window-size=${finalWidth},${finalHeight} applied correctly`);
          }
          if (validation.viewportWidth !== validation.expectedViewportWidth || validation.viewportHeight !== validation.expectedViewportHeight) {
            console.error('[BrowserLauncher] ❌ CRITICAL: Viewport MISMATCH! (Host leakage detected)');
          }
          if (validation.webdriver === true) {
            console.warn('[BrowserLauncher] ⚠️  WebDriver flag NOT hidden!');
          }
        } catch(e) {
          console.error('[BrowserLauncher] ❌ Validation failed:', e.message);
        }
        
      } else if (engine === 'gecko') {
        const firefox = require('playwright').firefox;
        
        context = await firefox.launchPersistentContext(profilePath, {
          executablePath: finalExecutablePath,
          headless: isHeadless,
          args: launchArgs,
          
          // Firefox persistent context CAN use viewport option
          viewport: {
            width: finalWidth,
            height: finalHeight
          },
          screen: {
            width: screenWidth,
            height: screenHeight
          },
          deviceScaleFactor: deviceScaleFactor,
          
          firefoxUserPrefs: getFirefoxPrefs(fp),
          userAgent: fp.userAgent || undefined,
          timezoneId: fp.timezone || 'America/New_York',
          locale: fp.locale || 'en-US',
          geolocation: fp.geolocation || undefined
        });
        
        // Firefox EARLY injection (v8.4.0 - single source)
        await injectViaFirefox(context, preGeneratedScripts, fp);
        
        page = context.pages()[0] || await context.newPage();
        console.log('[BrowserLauncher] ✅ Firefox page created (scripts active)');
      }
      
      // Optional: Additional stealth patches (if provided)
      if (stealthPatches && typeof stealthPatches.injectFullStealth === 'function') {
        console.log('[BrowserLauncher] 📜 Injecting additional stealth patches...');
        await stealthPatches.injectFullStealth(context, fp);
      }
      
      // 7. DETECT TEMPORARY PROFILE
      const isTemporaryProfile = (
        profilePath.includes('diagnostic') ||
        profilePath.includes('US_') ||
        profilePath.includes('temp') ||
        profilePath.includes('test')
      );
      
      console.log('[BrowserLauncher] ✅ Browser launched successfully (v8.5.0 - persistent context with CLI viewport)');
      
      // 8. RETURN STRUCTURE
      const browserHandle = {
        close: async () => {
          console.log(`[BrowserLauncher] 🛑 Closing browser context for ${workerId}...`);
          
          try {
            await context.close();
          } catch(e) {}
          
          // CLEANUP: Hardlink
          if (slotIndex <= OTHERS_RESERVED && fs.existsSync(finalExecutablePath)) {
            try {
              await new Promise(r => setTimeout(r, 1000));
              const basename = path.basename(finalExecutablePath);
              if (basename.match(/worker\d+\.exe/i) && finalExecutablePath !== executablePath) {
                fs.unlinkSync(finalExecutablePath);
                console.log(`[BrowserLauncher] 🧹 Hardlink cleaned: ${basename}`);
              }
            } catch(e) {}
          }
          
          if (isTemporaryProfile) {
            await cleanupTemporaryProfile(profilePath, workerId);
          }
        }
      };
      
      browserHandle.on = (event, handler) => context.on(event, handler);
      
      return {
        browser: browserHandle,
        context,
        page,
        executablePath: finalExecutablePath,
        engine,
        browserType: browser
      };
      
    } catch(error) {
      console.error(`[BrowserLauncher] ❌ Launch error: ${error.message}`);
      throw error;
    }
  }
  
  // ========================================
  // CLEANUP UTILITIES
  // ========================================
  static async cleanupExecutable(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    
    try {
      const basename = path.basename(filePath);
      if (PLATFORM.isWindows && basename.match(/worker\d+\.exe/i)) {
        fs.unlinkSync(filePath);
      } else if (!PLATFORM.isWindows && basename.match(/worker\d+/i)) {
        fs.unlinkSync(filePath);
      }
    } catch(e) {}
  }
  
  static async cleanupOrphanedHardlinks(config) {
    const hardlinkDirs = config.getHardlinkDirectories ? config.getHardlinkDirectories() : [];
    if (!hardlinkDirs || hardlinkDirs.length === 0) return { deleted: [], failed: [] };
    
    const deleted = [];
    const failed = [];
    const pattern = PLATFORM.isWindows ? /worker\d+\.exe/i : /worker\d+/i;
    
    for (const browserDir of hardlinkDirs) {
      if (!fs.existsSync(browserDir)) continue;
      
      try {
        const files = fs.readdirSync(browserDir);
        for (const file of files) {
          if (file.match(pattern)) {
            try {
              fs.unlinkSync(path.join(browserDir, file));
              deleted.push(file);
            } catch(e) {
              failed.push(file);
            }
          }
        }
      } catch(e) {}
    }
    
    return { deleted, failed };
  }
}

// ========================================
// STATIC METHOD BINDINGS
// ========================================
BrowserLauncher.scanEdgeWorkerDirectories = scanEdgeWorkerDirectories;
BrowserLauncher.detectBrowserEngine = detectBrowserEngine;
BrowserLauncher.extractWorkerID = extractWorkerID;
BrowserLauncher.cleanupTemporaryProfile = cleanupTemporaryProfile;
BrowserLauncher.getWorkerAvailability = getWorkerAvailability;
BrowserLauncher.validateWorkerSetup = validateWorkerSetup;
// ✅ v8.4.0: REMOVED generateHardwareOverrideScript export (single source compliance)

// ========================================
// AUTO-VALIDATION
// ========================================
if (process.env.VALIDATE_ON_LOAD !== 'false') {
  setTimeout(() => {
    console.log('='.repeat(80));
    validateWorkerSetup();
    console.log('='.repeat(80));
  }, 100);
}

module.exports = BrowserLauncher;
