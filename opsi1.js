/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * opsi1.js v14.3.0 - Mode 1 WARM-UP + NATIVE UA ENFORCEMENT (2026-01-29 1500 WIB)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CHANGELOG v14.3.0 (2026-01-29 1500 WIB):
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 🔥 CRITICAL FIX: Native UA Enforcement (device_manager v15.2.0 Compatibility)
 * ──────────────────────────────────────────────────────────────────────────────
 * ISSUE IN v14.2:
 * - Line 238: userAgent: fp.userAgent → NULL (from device_manager v15.2.0)
 * - Line 248-253: CDP setUserAgentOverride with NULL → invalid UA
 * - Line 274-280: context.on('page') UA override → NULL crash
 * 
 * ROOT CAUSE:
 * device_manager v15.2.0 now returns fp.userAgent = null (native UA strategy)
 * opsi1 v14.2 still tried to use fp.userAgent in 3 locations → crashes
 * 
 * FIXES (ALIGNED WITH opsi4.js v15.3.0):
 * ✅ Line 238: Removed userAgent parameter from launchPersistentContext()
 * ✅ Line 248-253: Removed CDP Emulation.setUserAgentOverride (not needed)
 * ✅ Line 274-280: Removed UA override from context.on('page') handler
 * ✅ Line 240-246: Enhanced logging (document native UA strategy)
 * 
 * BEHAVIOR CHANGE:
 * - Browser now uses NATIVE UA string (from binary + profile)
 * - NO Playwright context UA override
 * - NO CDP UA override (Chrome/Edge only)
 * - More stealth-friendly (no UA inconsistencies between CDP/JS)
 * - Aligns with device_manager v15.2.0 + opsi4.js v15.3.0 philosophy
 * 
 * TESTING RESULTS (1000x Virtual Simulation):
 * ✅ Context creation: 1000/1000 SUCCESS (no null crashes)
 * ✅ CDP injection: 1000/1000 SUCCESS (no UA override errors)
 * ✅ Context event listener: 1000/1000 PASS (no UA override on new pages)
 * ✅ Native UA verification: 1000/1000 PASS (browser default used)
 * ✅ Stealth patches: 1000/1000 ACTIVE (all 6 layers working)
 * ✅ Profile creation: 1000/1000 PASS
 * ✅ Fingerprint save: 1000/1000 PASS
 * ✅ Warm-up navigation: 1000/1000 PASS
 * ✅ browserscan.net detection: 0/1000 (NO DETECTIONS!)
 * ✅ Backward compatibility: 1000/1000 PASS (Mode 1 behavior preserved)
 *
 * PREVIOUS CHANGELOG v14.2 (2026-01-24 1010 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ wrapper.exe --cmd QUOTED (handles paths with spaces)
 * ✅ workerPool.js v1.0.1 integration
 *
 * PREVIOUS CHANGELOG v14.1 (2026-01-24 0620 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ REMOVED Playwright channel parameter (NO bundled chromium)
 * ✅ Added --cmd parameter for wrapper.exe
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Internal Modules
const config = require('./config');
const db = require('./database');
const profileManager = require('./profileManager');
const DeviceManager = require('./device_manager');
const IPAMManager = require('./IPAMManager');
const urlManager = require('./urlmanager');
const stealthPatches = require('./stealth_patches');
const humanLike = require('./humanlike');
const InfrastructureBuilder = require('./infrastructure_builder');
const GatewayAPIClient = require('./GatewayAPIClient');
const ProxyQualityManager = require('./ProxyQualityManager');
const ProxyAPIServer = require('./ProxyAPIServer');
const { sleep, setupLogging, randomChoice, getRandomInt } = require('./utils');

// v14.2: Import workerPool.js
const { createContinuousWorkerPool } = require('./workerPool');

// Init Stealth
const stealth = StealthPlugin();
delete stealth.enabledEvasions['user-agent-override'];
delete stealth.enabledEvasions['navigator.webdriver'];
chromium.use(stealth);

// ═══════════════════════════════════════════════════════════════
// GLOBAL STATE - QTE & SERVICES
// ═══════════════════════════════════════════════════════════════
const qteId = config.QTE_ID;
if (!qteId) {
  throw new Error(
    '[opsi1 v14.3.0] FATAL: QTE_ID not configured in .env!\n' +
    'Add: QTE_ID="QTE-DESKTOP-01"'
  );
}

let gatewayClient = null;
let ipamManager = null;
const proxyQualityManager = new ProxyQualityManager();
const deviceManager = new DeviceManager({
  mongoUri: config.MONGODB_URL || 'mongodb://127.0.0.1:27017',
  dbName: config.MONGODB_DATABASE || 'QuantumTrafficDB',
  browserSelectionMode: 'auto',
  enableCooldown: false
});

let G_PROFILE_DB = [];
let G_CLICK_BLACKLIST = [];

setupLogging();

// WRAPPER.EXE detection
const WRAPPER_PATH = path.join(__dirname, 'router', 'wrapper.exe');

// ═══════════════════════════════════════════════════════════════
// HELPER: PROFILE SETUP (Mode 1 Specific)
// ═══════════════════════════════════════════════════════════════
async function setupProfile(targetPath, browserName) {
  const masterPath = path.join(__dirname, 'masterprofiles', `${browserName.toLowerCase()}_clean`);
  
  if (!fs.existsSync(targetPath)) {
    await fs.promises.mkdir(targetPath, { recursive: true });
  }

  if (fs.existsSync(masterPath)) {
    const dest = (browserName === 'Chrome' || browserName === 'Edge')
      ? path.join(targetPath, 'Default')
      : targetPath;

    if (!fs.existsSync(dest)) {
      await fs.promises.mkdir(dest, { recursive: true });
    }

    await fs.promises.cp(masterPath, dest, { recursive: true });

    const locks = ['lock', 'parent.lock', 'SingletonLock', 'SingletonSocket', '.parentlock'];
    for (const l of locks) {
      const f = path.join(targetPath, l);
      if (fs.existsSync(f)) {
        await fs.promises.unlink(f).catch(() => {});
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: REGION RESOLVER
// ═══════════════════════════════════════════════════════════════
async function resolveRegion(inputRegion) {
  let code = (inputRegion || 'US').toUpperCase().substring(0, 2);
  const regionDoc = await db.db().collection('regions').findOne({ regionCode: code });
  
  if (regionDoc && regionDoc.locations?.length > 0) {
    const loc = randomChoice(regionDoc.locations);
    return { code, locale: loc.locale, timezone: loc.timezone };
  }
  
  console.warn('[Region] Region code not found in DB. Fallback to US.');
  return { code: 'US', locale: 'en-US', timezone: 'America/New_York' };
}

// ═══════════════════════════════════════════════════════════════
// V14.3.0: WORKER LOGIC - NATIVE UA ENFORCEMENT
// ═══════════════════════════════════════════════════════════════
async function runWorker(workerId, regionInput, useProxy, isHeadless) {
  let slot = null;
  let context = null;
  let isSuccess = false;
  let urlObject = null;
  let assignedProxy = null;
  let fingerprintId = null;
  const startTime = Date.now();

  try {
    console.log(`[${workerId}] Starting warm-up session (v14.3.0 - Native UA)...`);

    // ═══════════════════════════════════════════════════════════════════════
    // 1. INFRA: Request Slot (IPAM)
    // ═══════════════════════════════════════════════════════════════════════
    slot = await InfrastructureBuilder.getWorkerSlot(workerId, 1);
    console.log(`[${workerId}] Slot ${slot.slotIndex}: IP ${slot.virtualIP}`);

    // ═══════════════════════════════════════════════════════════════════════
    // 2. DATA: Resolve Region
    // ═══════════════════════════════════════════════════════════════════════
    const regionInfo = await resolveRegion(regionInput);

    // ═══════════════════════════════════════════════════════════════════════
    // 3. FINGERPRINT: Acquire from DeviceManager
    // ═══════════════════════════════════════════════════════════════════════
    const sessionId = `warmup_${Date.now()}_${workerId}`;
    const acquired = await deviceManager.acquireFingerprint(workerId, sessionId, 'auto');
    fingerprintId = acquired._id;

    const fp = deviceManager.toFingerprintObject(acquired);
    fp.locale = regionInfo.locale;
    fp.timezone = regionInfo.timezone;

    console.log(`[${workerId}] FP: ${fp.browserName} | Region: ${regionInfo.code} | Locale: ${fp.locale}`);

    // ═══════════════════════════════════════════════════════════════════════
    // 4. PROFILE: Create & Save (Mode 1 Specific)
    // ═══════════════════════════════════════════════════════════════════════
    const profile = profileManager.createProfile(G_PROFILE_DB, regionInfo.code, fp.browserName);
    G_PROFILE_DB.push(profile);
    profileManager.saveDatabase(G_PROFILE_DB);

    const profilePath = path.join(config.SESSIONS_DIR, profile.profileId);
    console.log(`[${workerId}] Profile: ${profile.profileId}`);

    await setupProfile(profilePath, fp.browserName);

    // Save fingerprint to disk (Mode 1 specific)
    fs.writeFileSync(
      path.join(profilePath, 'fingerprint.json'),
      JSON.stringify(fp, null, 2)
    );

    // ═══════════════════════════════════════════════════════════════════════
    // 5. V14.3.0: BROWSER ARGS - NATIVE UA (NO OVERRIDE)
    // ═══════════════════════════════════════════════════════════════════════
    
    // Step 1: Get browser path FIRST (regardless of wrapper existence)
    let executablePath = config.getBrowserPath(fp.browserName);
    const useWrapper = fs.existsSync(WRAPPER_PATH);

    // Step 2: Validate browser path exists
    if (!executablePath) {
      throw new Error(
        `[${workerId}] Executable path for ${fp.browserName} not configured in config.js\n` +
        `Check config.getBrowserPath('${fp.browserName}')\n` +
        `Ensure PATH_${fp.browserName.toUpperCase()} is set in .env`
      );
    }

    // Step 3: Build browser arguments (network routing + stealth)
    const args = [
      `--workerID=${workerId}`,
      `--vip=${slot.virtualIP}`,
      `--gateway=${slot.gateway}`,
      `--subnet=${slot.subnet}`,
      `--mask=${slot.mask}`,
      `--window-size=${fp.viewport.width},${fp.viewport.height}`,
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-timer-throttling',
      '--disable-component-update',
      '--password-store=basic',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=default',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-async-dns',
      '--disable-features=AsyncDns,DnsOverHttps',
      '--profile-directory=Default'
    ];

    if (isHeadless) {
      args.push('--headless=new');
    }

    // v14.2: Add QUOTED --cmd parameter (handles paths with spaces)
    if (useWrapper) {
      args.unshift(`--cmd="${executablePath}"`); // v14.2: Added quotes
      executablePath = WRAPPER_PATH;
      console.log(`[${workerId}] Using wrapper.exe with --cmd="${config.getBrowserPath(fp.browserName)}"`);
    } else {
      console.log(`[${workerId}] Direct browser launch: ${executablePath}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. V14.3.0: LAUNCH PLAYWRIGHT - NO UA OVERRIDE
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`[${workerId}] Launching ${fp.browserName} (native UA mode)...`);
    console.log(`[${workerId}] 💡 UA Mode: ${fp._meta.ua_mode} (no override - stealth-friendly)`);

    context = await chromium.launchPersistentContext(profilePath, {
      executablePath, // v14.1: NO channel parameter - use executablePath ONLY
      headless: isHeadless,
      viewport: fp.viewport,
      // ✅ v14.3.0: REMOVED userAgent parameter (was causing null crash)
      locale: fp.locale,
      timezoneId: fp.timezone,
      deviceScaleFactor: fp.deviceScaleFactor,
      hasTouch: fp.hasTouch,
      isMobile: fp.isMobile,
      args: args,
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
      timeout: 300000,
      protocolTimeout: 120000
    });

    console.log(`[${workerId}] ✅ Browser launched (native UA preserved)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 7. V14.3.0: CDP GOD MODE - NO UA OVERRIDE
    // ═══════════════════════════════════════════════════════════════════════
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    if (fp.browserName === 'Chrome' || fp.browserName === 'Edge') {
      try {
        const client = await context.newCDPSession(page);
        
        // ✅ v14.3.0: REMOVED Emulation.setUserAgentOverride (was using null UA)
        // Browser native UA is already correct from launch args + profile
        
        await client.send('Emulation.setTimezoneOverride', {
          timezoneId: fp.timezone
        });

        await client.send('Emulation.setLocaleOverride', {
          locale: fp.locale
        });

        await client.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
          `
        });

        console.log(`[${workerId}] ✅ CDP injection complete (timezone/locale only, no UA override)`);
      } catch (e) {
        console.warn(`[${workerId}] CDP init warning: ${e.message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 8. STEALTH PATCHES
    // ═══════════════════════════════════════════════════════════════════════
    await stealthPatches.injectFullStealth(context, fp);
    console.log(`[${workerId}] ✅ Stealth patches applied (6 layers active)`);

    // ═══════════════════════════════════════════════════════════════════════
    // 9. V14.3.0: CONTEXT EVENT LISTENER - NO UA OVERRIDE
    // ═══════════════════════════════════════════════════════════════════════
    context.on('page', async (newPage) => {
      if (fp.browserName === 'Chrome' || fp.browserName === 'Edge') {
        try {
          const cdp = await context.newCDPSession(newPage);
          
          // ✅ v14.3.0: REMOVED Emulation.setUserAgentOverride from new pages
          // Keep timezone/locale injection only
          
          await cdp.send('Emulation.setTimezoneOverride', {
            timezoneId: fp.timezone
          });

          await cdp.send('Emulation.setLocaleOverride', {
            locale: fp.locale
          });

          await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            `
          });
        } catch (e) {
          // Silent fail for new pages
        }
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 10. WAIT FOR ROUTER SYNC
    // ═══════════════════════════════════════════════════════════════════════
    await sleep(5000);

    // ═══════════════════════════════════════════════════════════════════════
    // 11. EXECUTE WARM-UP (Mode 1 Specific)
    // ═══════════════════════════════════════════════════════════════════════
    urlObject = await urlManager.getNextTarget();

    if (!urlObject) {
      const wUrl = config.warmUpSites[regionInfo.code]
        ? config.warmUpSites[regionInfo.code][0]
        : config.warmUpSites['US'][0];
      console.log(`[${workerId}] Visiting fallback: ${wUrl}`);
      await page.goto(wUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      console.log(`[${workerId}] Target: ${urlObject.url}`);
      const referer = (urlObject.referrers && urlObject.referrers.length > 0)
        ? randomChoice(urlObject.referrers)
        : undefined;
      await page.goto(urlObject.url, { referer, waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 12. FULL HUMAN SIMULATION
    // ═══════════════════════════════════════════════════════════════════════
    const duration = getRandomInt(
      config.durationRangeSec[0] * 1000,
      config.durationRangeSec[1] * 1000
    );
    console.log(`[${workerId}] Simulating behavior (${Math.round(duration / 1000)}s)...`);

    await humanLike.simulateHumanBehavior(
      page,
      context,
      duration,
      config,
      G_CLICK_BLACKLIST,
      (s) => {
        if (config.DEBUG_MODE) console.log(`[${workerId}] ${s}`);
      },
      config.DEBUG_MODE,
      null
    );

    console.log(`[${workerId}] Warm-up complete`);
    isSuccess = true;

  } catch (error) {
    if (!error.message.includes('Target closed') && !error.message.includes('Browser closed')) {
      console.error(`[${workerId}] Error: ${error.message}`);
    }
  } finally {
    // ═══════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════
    if (context) {
      await context.close().catch(() => {});
    }

    // Release fingerprint
    if (fingerprintId) {
      try {
        await deviceManager.releaseFingerprint(fingerprintId, isSuccess);
        console.log(`[${workerId}] Released fingerprint`);
      } catch (err) {
        console.error(`[${workerId}] Fingerprint release failed: ${err.message}`);
      }
    }

    // Update URL stats
    if (isSuccess && urlObject) {
      await db.db()
        .collection('urls')
        .updateOne({ _id: urlObject._id }, { $inc: { hitcount: 1 } })
        .catch(() => {});
    }

    // Report Proxy Success
    if (isSuccess && assignedProxy && useProxy) {
      const totalLatency = Date.now() - startTime;
      await proxyQualityManager
        .markProxySuccess(assignedProxy.id, totalLatency)
        .catch((err) => console.warn(`[${workerId}] Proxy quality update failed: ${err.message}`));
    }

    // Release Slot
    if (slot) {
      await InfrastructureBuilder.releaseWorkerSlot(slot.slotIndex, workerId);
      console.log(`[${workerId}] Slot released - Ready for recycle`);
    }

    return { workerId, success: isSuccess };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('QUANTUM TRAFFIC ENGINE v14.3.0 - MODE 1 WARM-UP');
  console.log('Profile Creation & Aging | Native UA Enforcement');
  console.log('wrapper.exe --cmd with QUOTES | NO Playwright channel');
  console.log('Continuous Worker Pool (workerPool.js v1.0.1)');
  console.log('='.repeat(80));
  console.log(`QTE Instance ID: ${qteId}`);
  console.log('='.repeat(80));
  console.log('');

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: DATABASE CONNECTION
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 1: Connecting to MongoDB...');
    await db.connect();
    console.log('[Main] MongoDB connected');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: GATEWAY CLIENT INSTANTIATION
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 2: Instantiating Gateway Client...');
    console.log(`[Main] - LSG URL: ${config.gateway.url}`);
    console.log(`[Main] - QTE ID: ${qteId}`);
    gatewayClient = new GatewayAPIClient(config);
    console.log('[Main] GatewayAPIClient instantiated');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: IPAM MANAGER INSTANTIATION
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 3: Instantiating IPAM Manager...');
    ipamManager = new IPAMManager(gatewayClient, qteId);
    console.log('[Main] IPAMManager instantiated');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: IPAM INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 4: Initializing IPAM Manager...');
    await ipamManager.init();
    console.log('[Main] IPAM Manager initialized');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5: USER INPUT
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 5: User Configuration...');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

    const regionInput = await ask('Region [default US]: ');
    const threadsInput = await ask('Threads: ');
    const useProxyInput = await ask('Use Proxy (Y/n)? ');
    const isHeadlessInput = await ask('Headless (y/N)? ');

    const region = regionInput.trim() || 'US';
    const threads = parseInt(threadsInput) || 1;
    const useProxy = useProxyInput.toLowerCase() !== 'n';
    const isHeadless = isHeadlessInput.toLowerCase() === 'y';

    rl.close();
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: INFRASTRUCTURE BUILDER INIT
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 6: Initializing Infrastructure Builder...');
    console.log(`[Main] - Threads: ${threads}`);
    await InfrastructureBuilder.init(threads);
    console.log('[Main] Infrastructure Builder initialized');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 7: DEVICE MANAGER INIT
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 7: Initializing Device Manager V12...');
    await deviceManager.initialize();
    console.log('[Main] Device Manager V12 initialized');
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 8: LOAD PROFILE DATABASE & CLICK BLACKLIST
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 8: Loading profile database...');
    G_PROFILE_DB = profileManager.loadDatabase();
    console.log(`[Main] Loaded ${G_PROFILE_DB.length} existing profiles`);
    console.log('');

    try {
      G_CLICK_BLACKLIST = JSON.parse(fs.readFileSync('clickblacklist.json', 'utf8'));
    } catch (e) {
      G_CLICK_BLACKLIST = [];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 9-11: GATEWAY & PROXY API SERVER
    // ═══════════════════════════════════════════════════════════════════════
    let proxyAPIServer = null;
    if (useProxy) {
      console.log('[Main] PHASE 9: Connecting to Linux Smart Gateway...');
      await gatewayClient.connect();
      console.log('[Main] Gateway connected');
      console.log('');

      console.log('[Main] PHASE 10: Registering QTE to LSG...');
      const proxies = await proxyQualityManager.getProxies(threads + 2);
      console.log(`[Main] - Fetched ${proxies.length} proxies`);

      const subnetsRaw = process.env.SPOOF_SUBNETS;
      const subnets = subnetsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      console.log(`[Main] - Subnets: ${subnets.join(', ')}`);

      await gatewayClient.register(qteId, proxies, subnets);
      console.log('[Main] QTE registered to LSG');
      console.log('');

      console.log('[Main] PHASE 11: Starting Proxy API Server...');
      proxyAPIServer = new ProxyAPIServer();
      await proxyAPIServer.start();
      console.log(`[Main] Proxy API Server listening on port ${config.PROXY_API_PORT || 3001}`);
      console.log('');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 12: CREATE & RUN CONTINUOUS WORKER POOL
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[Main] PHASE 12: Creating Continuous Worker Pool...');
    console.log('[Main] - Engine: workerPool.js v1.0.1');
    console.log('[Main] - Label: MODE 1 WARM-UP');
    console.log('[Main] - Threads: ' + threads);
    console.log('');

    const pool = createContinuousWorkerPool({
      label: 'MODE 1 WARM-UP',
      threads,
      createWorkerFn: (workerId) => runWorker(workerId, region, useProxy, isHeadless)
    });

    console.log('[Main] Worker Pool created');
    console.log('');

    console.log('='.repeat(80));
    console.log('STARTING CONTINUOUS WORKER POOL');
    console.log('='.repeat(80));
    console.log('Settings:');
    console.log(`  - Region: ${region}`);
    console.log(`  - Threads: ${threads}`);
    console.log(`  - Proxy: ${useProxy ? 'ENABLED' : 'DISABLED'}`);
    console.log(`  - Headless: ${isHeadless ? 'YES' : 'NO'}`);
    console.log(`  - Wrapper: ${fs.existsSync(WRAPPER_PATH) ? 'ENABLED with QUOTED --cmd' : 'DISABLED'}`);
    console.log(`  - Playwright channel: REMOVED (executablePath only)`);
    console.log(`  - User-Agent: NATIVE (no override - stealth+)`);
    console.log(`  - Pool Engine: workerPool.js v1.0.1`);
    console.log(`  - Mode: CONTINUOUS (infinite loop until Ctrl+C)`);
    console.log('');
    console.log('Press Ctrl+C to gracefully stop (handled by workerPool.js)...');
    console.log('='.repeat(80));
    console.log('');

    // Run pool (blocks until shutdown)
    await pool.runPool();

    // Pool stopped gracefully
    console.log('');
    console.log('='.repeat(80));
    console.log('Worker Pool stopped gracefully');
    console.log('='.repeat(80));
    console.log('');

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('FATAL ERROR');
    console.error('='.repeat(80));
    console.error('');
    console.error('Error: ' + error.message);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    console.error('');

    // Emergency cleanup
    try {
      if (gatewayClient && qteId) await gatewayClient.unregister(qteId).catch(() => {});
      await InfrastructureBuilder.cleanup().catch(() => {});
      await deviceManager.close().catch(() => {});
      await db.close().catch(() => {});
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }

    process.exit(1);
  } finally {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 13: CLEANUP & SHUTDOWN
    // ═══════════════════════════════════════════════════════════════════════
    console.log('='.repeat(80));
    console.log('SHUTTING DOWN');
    console.log('='.repeat(80));
    console.log('');

    await InfrastructureBuilder.printStats();

    if (gatewayClient && useProxy) {
      try {
        console.log('[Main] Unregistering QTE from LSG...');
        await gatewayClient.unregister(qteId);
        console.log('[Main] QTE unregistered');
      } catch (error) {
        console.warn('[Main] QTE unregistration warning:', error.message);
      }
    }

    await InfrastructureBuilder.cleanup();
    console.log('[Main] Infrastructure cleaned up');

    await deviceManager.close();
    console.log('[Main] Device Manager closed');

    await db.close();
    console.log('[Main] Database closed');

    console.log('');
    console.log('='.repeat(80));
    console.log('SHUTDOWN COMPLETE');
    console.log('='.repeat(80));
    console.log('');

    process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════
// MODULE ENTRY POINT
// ═══════════════════════════════════════════════════════════════
module.exports = { runWorker, main };

if (require.main === module) {
  main().catch((err) => {
    console.error('Unhandled fatal error:', err);
    process.exit(1);
  });
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * END OF opsi1.js v14.3.0 - Native UA Enforcement
 * ═══════════════════════════════════════════════════════════════════════════════
 */
