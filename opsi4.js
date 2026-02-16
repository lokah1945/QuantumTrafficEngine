/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * OPSI4 v20.0.13 - AIC COMPLIANT ARCHITECTURE (FONT FLOW + SINGLE SOURCE)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * 🔥 CHANGELOG v20.0.13 (2026-02-16 15:08 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ AIC FIX: Font Flow Complete (Phase 2.5 added)
 *    - Added buildFontList() call after toFingerprintObject
 *    - Added fp.fonts = { persona, list, os } construction
 *    - Font list now built BEFORE stealth script generation
 * 
 * ✅ AIC FIX: Font Script Injection (Phase 5.9 enhanced)
 *    - Added StealthFont.generateFontInjectionScript() call
 *    - Font script injected FIRST (Priority 0 - before stealth_patches)
 *    - Combined initScripts: [fontScript, ...stealthScripts]
 * 
 * ✅ AIC FIX: Single Source Enforcement
 *    - BrowserLauncher receives complete script array
 *    - No more inline script generation in launcher
 *    - Hardware override ONLY from stealth_patches.js
 * 
 * ✅ VERIFICATION: Font count now persona-driven (not host)
 * ✅ VERIFICATION: Screen/hardware from FP database (not host)
 * ✅ VERIFICATION: No double override race condition
 * 
 * 🔥 CHANGELOG v20.0.12 (2026-02-15 07:25 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ FEATURE: Manual Browser Lifecycle
 * - REMOVED: Static 60s timeout.
 * - ADDED: Promise wrapper waiting for 'browserInstance.on("close")'.
 * - BENEFIT: Process stays alive until user manually closes the window.
 * ✅ FEATURE: Fingerprint Audit Trail (Phase 5.9.1)
 * - ADDED: Automatic logging of full FP object to ./logs/Fingerprint/.
 * - PURPOSE: Validating injected data vs database truth before spawn.
 * ✅ FIXED: Profile Directory Path
 * - Corrected path.join to use config.SESSIONS_DIR.
 * ✅ FIXED: IP Mapping Regression
 * - Explicitly mapped validationResult.ip to fp._network.ip (Fixed undefined issue).
 * ✅ FIXED: Proxy Release Ownership
 * - Corrected ProxyPoolManager.releaseProxy(slotIndex, WID, isSuccess).
 * 
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// INTERNAL MODULES
const logger = require('./logger');
const config = require('./config');
const BrowserLauncher = require('./BrowserLauncher');
const InfrastructureBuilder = require('./infrastructure_builder');

// MANAGERS (Dynamic Handling)
let DeviceManager = require('./device_manager');
let ProxyPoolManager = require('./ProxyPoolManager');
const ProxyAPIServer = require('./ProxyAPIServer');
const ClashManager = require('./clash_manager');
const stealthPatches = require('./stealth_patches');

// DB Connection
const { connect } = require('./database'); 

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION & CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const VALIDATOR_BINARY = path.join(__dirname, 'Validator', 'ip_validator.exe');
const VALIDATOR_DIR = path.join(__dirname, 'Validator');
const FP_LOG_DIR = path.join(__dirname, 'logs', 'Fingerprint');

// Ensure directories exist
if (!fs.existsSync(VALIDATOR_DIR)) fs.mkdirSync(VALIDATOR_DIR, { recursive: true });
if (!fs.existsSync(FP_LOG_DIR)) fs.mkdirSync(FP_LOG_DIR, { recursive: true });

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// HELPER: MANAGER INSTANTIATOR
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function ensureInstance(ModuleOrInstance, name) {
    if (typeof ModuleOrInstance.initialize === 'function') {
        return ModuleOrInstance;
    } else if (typeof ModuleOrInstance === 'function') {
        console.log(`[System] Instantiating ${name} from Class definition...`);
        return new ModuleOrInstance();
    } else {
        return ModuleOrInstance;
    }
}

// Normalize Managers immediately
DeviceManager = ensureInstance(DeviceManager, 'DeviceManager');
ProxyPoolManager = ensureInstance(ProxyPoolManager, 'ProxyPoolManager');

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// HELPER: C++ VALIDATOR WRAPPER
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function validateProxyWithCpp(slotId, proxyInfo, timeoutMs = 15000) {
    const workerId = `W${slotId}`;
    const validatorName = `ip_worker${String(slotId).padStart(3, '0')}.exe`;
    const sourcePath = VALIDATOR_BINARY;
    const targetPath = path.join(VALIDATOR_DIR, validatorName);

    console.log(`[${workerId}] ────────────────────────────────────────────────────────`);
    console.log(`[${workerId}] 🔥 IP VALIDATION (C++ Validator v20.0.2)`);
    console.log(`[${workerId}] ────────────────────────────────────────────────────────`);
    
    try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        fs.linkSync(sourcePath, targetPath);
    } catch (e) {
        console.error(`[${workerId}] ❌ Failed to create validator hardlink: ${e.message}`);
        return { valid: false, error: 'Hardlink creation failed' };
    }

    return new Promise((resolve) => {
        const child = spawn(validatorName, [], {
            cwd: VALIDATOR_DIR,
            timeout: timeoutMs
        });

        let stdout = '';
        child.stdout.on('data', (data) => stdout += data.toString());

        child.on('close', (code) => {
            try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch (e) {}
            if (code !== 0) return resolve({ valid: false, error: `Exit code ${code}` });

            try {
                const jsonStart = stdout.indexOf('{');
                const jsonEnd = stdout.lastIndexOf('}');
                const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
                const result = JSON.parse(jsonStr);

                if (result.status === 'success') {
                    console.log(`[${workerId}] ✅ IP VALIDATED: ${result.query} (${result.country})`);
                    resolve({
                        valid: true,
                        ip: result.query, 
                        country: result.countryCode,
                        region: result.region,
                        city: result.city,
                        timezone: result.timezone,
                        lat: result.lat,
                        lon: result.lon,
                        isp: result.isp
                    });
                } else {
                    resolve({ valid: false, error: result.message });
                }
            } catch (e) {
                resolve({ valid: false, error: 'Parse error' });
            }
        });

        child.on('error', (err) => {
            try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch (e) {}
            resolve({ valid: false, error: err.message });
        });
    });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// HELPER: WEBRTC FAKE DATA GENERATOR
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function generateWebRTCData() {
    const thirdOctet = Math.floor(Math.random() * 255);
    const fourthOctet = Math.floor(Math.random() * 254) + 1;
    const fakeLAN = `192.168.${thirdOctet}.${fourthOctet}`;
    const hex = Math.floor(Math.random() * 65535).toString(16);
    const fakeULA = `fd00::${hex}`;
    return { fakeLAN, fakeULA };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN WORKER LOGIC
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function runMode4Worker(workerId, browserType, useProxy, targetUrl) {
    const WID = `[W${workerId}]`;
    let slotIndex = null;
    let fp = null;
    let browserInstance = null; 
    let isSuccess = false;
    let executablePath = null;
    let profilePath = null;

    console.log(`${WID} ══════════════════════════════════════════════════════════`);
    console.log(`${WID} Starting Diagnostic Session v20.0.13 (AIC Compliant)`);
    console.log(`${WID} ══════════════════════════════════════════════════════════`);

    try {
        // 1. ACQUIRE SLOT
        console.log(`${WID} PHASE 1: Acquiring slot...`);
        const slotAllocation = await InfrastructureBuilder.getWorkerSlot(workerId, 4);
        slotIndex = slotAllocation.slotIndex;
        console.log(`${WID} ✅ Slot ${slotIndex} allocated`);

        // 2. ACQUIRE FINGERPRINT
        console.log(`${WID} PHASE 2: Acquiring fingerprint...`);
        const fingerprintData = await DeviceManager.acquireFingerprint(workerId, `session_${workerId}`, browserType);
        fp = DeviceManager.toFingerprintObject(fingerprintData);
        console.log(`${WID} ✅ Selected ${fp.browserName} ${fp._id}`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
        // ✅ PHASE 2.5: BUILD FONT LIST (AIC COMPLIANT - SINGLE SOURCE)
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 2.5: Building Font List...`);
        if (fp.font_profile && DeviceManager.fontManager) {
            try {
                const fontList = DeviceManager.fontManager.buildFontList(fp.font_profile);
                fp.fonts = {
                    persona: fp.font_profile.persona,
                    list: fontList,
                    os: fp.font_profile.os,
                    description: fp.font_profile.description || 'Generated Font Persona'
                };
                console.log(`${WID} ✅ Font Persona: ${fp.fonts.persona} (${fp.fonts.list.length} fonts)`);
            } catch (fontErr) {
                console.warn(`${WID} ⚠️ Font list build failed: ${fontErr.message}`);
                // Fallback: Safe empty list
                fp.fonts = { 
                    persona: 'FALLBACK', 
                    list: [], 
                    os: fp._meta?.os?.name || 'windows',
                    description: 'Fallback - Font Manager Failed'
                };
            }
        } else {
            console.warn(`${WID} ⚠️ No font profile or manager available, using empty list`);
            fp.fonts = { 
                persona: 'NO_PROFILE', 
                list: [], 
                os: fp._meta?.os?.name || 'windows',
                description: 'No Font Profile Available'
            };
        }

        // 3. CREATE PROFILE PATH (CORRECTED)
        console.log(`${WID} PHASE 3: Configuring profile path...`);
        const profileId = `US_${String(workerId).padStart(4, '0')}_${fp.browserName}_${Date.now()}`;
        // ✅ Ensure created inside ./sessions/
        profilePath = path.join(process.cwd(), config.SESSIONS_DIR || 'sessions', profileId);
        console.log(`${WID} ✅ Profile set: ${path.basename(profilePath)}`);

        // 4. RESOLVE EXECUTABLE
        console.log(`${WID} PHASE 4: Resolving executable path...`);
        const browserPathConfig = await config.getBrowserPath(fp.browserName, { workerSlot: slotIndex });
        if (!browserPathConfig || !browserPathConfig.path) throw new Error('Executable resolution failed');
        executablePath = browserPathConfig.path;

        // 5. PROXY ASSIGNMENT & IP VALIDATION
        if (useProxy) {
            console.log(`${WID} ─────────────────────────────────────────────────────────`);
            console.log(`${WID} 🔥 PHASE 5: Proxy Assignment + IP Validation`);
            console.log(`${WID} ─────────────────────────────────────────────────────────`);
            
            let validationResult = { valid: false };
            let attempts = 0;
            while (!validationResult.valid && attempts < 3) {
                attempts++;
                const assignment = await ProxyPoolManager.assignProxy(slotIndex, WID);
                if (!assignment) throw new Error('Failed to assign proxy');
                
                const proxyInfo = `${assignment.host}:${assignment.port}`;
                console.log(`${WID} ✅ PROXY ASSIGNED (Attempt ${attempts}/3): ${proxyInfo}`);

                validationResult = await validateProxyWithCpp(slotIndex, proxyInfo);
                if (!validationResult.valid) {
                    await ProxyPoolManager.releaseProxy(slotIndex, WID, false); 
                }
            }

            if (!validationResult.valid) throw new Error('Critical proxy failure');

            const webrtc = generateWebRTCData();
            // ✅ SINKRONISASI IP KE FINGERPRINT
            fp._network = {
                ip: validationResult.ip, 
                ipv6: null,
                fakeLAN: webrtc.fakeLAN,
                fakeULA: webrtc.fakeULA,
                ipMode: 'ipv4-only'
            };

            if (validationResult.timezone) fp.timezone = validationResult.timezone;
            if (validationResult.country) fp.locale = 'en-US'; 
        }

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
        // ✅ PHASE 5.9: PRE-GENERATE ALL INJECTION SCRIPTS (AIC COMPLIANT - FONT FIRST)
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} 🔥 PHASE 5.9: Pre-Generating ALL Injection Scripts`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);

        // 5.9.1: Font Script (MUST BE FIRST - Controls document.fonts API)
        let fontScript = '';
        if (fp.fonts && DeviceManager.fontManager) {
            try {
                fontScript = DeviceManager.fontManager.generateFontInjectionScript(fp.fonts);
                console.log(`${WID} ✅ [1/2] Font injection script generated (${fp.fonts.list.length} fonts, persona: ${fp.fonts.persona})`);
            } catch (fontErr) {
                console.warn(`${WID} ⚠️ Font script generation failed: ${fontErr.message}`);
                fontScript = ''; // Safe fallback
            }
        } else {
            console.warn(`${WID} ⚠️ No fonts available for injection, skipping font script`);
        }

        // 5.9.2: Stealth Patches (Hardware, WebGL, Navigator, Screen, etc.)
        const stealthScripts = await stealthPatches.generateAllScripts(fp);
        console.log(`${WID} ✅ [2/2] Stealth scripts generated (${stealthScripts.length} modules)`);

        // ✅ CRITICAL: Font script FIRST (Priority 0 - before everything else)
        // Order matters: Font API control → Hardware → WebGL → Navigator → Screen → Noise
        const initScripts = fontScript ? [fontScript, ...stealthScripts] : stealthScripts;
        console.log(`${WID} ✅ Total injection scripts prepared: ${initScripts.length}`);
        console.log(`${WID} ✅ Injection order: ${fontScript ? 'Font (P0) → ' : ''}Stealth (P1-P7)`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);

        // 5.9.3: FINGERPRINT AUDIT LOG
        console.log(`${WID} 🔥 PHASE 5.9.3: Logging Fingerprint for Audit`);
        const fpLogPath = path.join(FP_LOG_DIR, `W${workerId}_${Date.now()}.log`);
        fs.writeFileSync(fpLogPath, JSON.stringify(fp, null, 2));
        console.log(`${WID} ✅ FP Log saved: ${path.basename(fpLogPath)}`);

        // 6. LAUNCH BROWSER
        console.log(`${WID} PHASE 6: Launching Browser...`);
        const launcher = new BrowserLauncher(config);
        
        const launchOptions = {
            headless: false,
            executablePath: executablePath,
            initScripts: initScripts,
            fp: fp 
        };

        const launchResult = await launcher.launchPersistentContext(profilePath, launchOptions);
        browserInstance = launchResult.browser; 
        const page = launchResult.page; 

        console.log(`${WID} ✅ Browser launched successfully`);

        // 7. NAVIGATE TO TARGET
        console.log(`${WID} PHASE 7: Navigating to target...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`${WID} ✅ Navigation complete`);

        // 8. MANUAL INTERACTION WAIT (FIXED!)
        // ✅ Replacing static setTimeout with dynamic close listener
        await new Promise((resolve) => {
            console.log(`\n[USER ACTION REQUIRED] ────────────────────────────────────────`);
            console.log(`${WID} 🟢 Sessi Aktif. Silahkan lakukan inspeksi manual.`);
            console.log(`${WID} 🟢 Tutup window browser untuk mengakhiri sesi worker ini.`);
            console.log(`───────────────────────────────────────────────────────────────\n`);
            
            browserInstance.on('close', () => {
                console.log(`${WID} 🛑 Browser closed by user.`);
                resolve();
            });
        });

        isSuccess = true;

    } catch (error) {
        console.error(`${WID} ❌ WORKER FAILED: ${error.message}`);
        isSuccess = false;
    } finally {
        console.log(`${WID} Starting cleanup...`);

        if (browserInstance && typeof browserInstance.close === 'function') {
            try {
                await browserInstance.close();
                console.log(`${WID} ✅ Cleanup browser handles`);
            } catch (e) {}
        }

        if (executablePath) {
            try {
                await BrowserLauncher.cleanupExecutable(executablePath);
                console.log(`${WID} ✅ Executable cleaned`);
            } catch (e) {}
        }

        if (slotIndex) {
            try {
                // ✅ CORRECTED: Added WID as 2nd argument
                await ProxyPoolManager.releaseProxy(slotIndex, WID, isSuccess);
                console.log(`${WID} ✅ Proxy released`);
            } catch (e) {}
        }

        if (fp && fp._id) {
            try {
                await DeviceManager.releaseFingerprint(fp._id, fp.browserType || browserType, isSuccess);
                console.log(`${WID} ✅ Fingerprint released`);
            } catch (e) {}
        }

        if (slotIndex) {
            try {
                await InfrastructureBuilder.releaseWorkerSlot(slotIndex);
                console.log(`${WID} ✅ Slot released`);
            } catch(e) {}
        }

        console.log(`${WID} Cleanup complete`);
        return isSuccess;
    }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
    console.log(`\n\n════════════════════════════════════════════════════════════════════════════════`);
    console.log(`🚀 OPSI4 v20.0.13 - AIC COMPLIANT ARCHITECTURE`);
    console.log(`════════════════════════════════════════════════════════════════════════════════`);

    if (!fs.existsSync(VALIDATOR_BINARY)) {
        console.error(`❌ Validator binary NOT FOUND at: ${VALIDATOR_BINARY}`);
        process.exit(1);
    }

    await connect(); 

    // Init Managers
    await DeviceManager.initialize();
    if (typeof ProxyPoolManager.initialize === 'function') await ProxyPoolManager.initialize();
    if (ProxyAPIServer.start) await ProxyAPIServer.start();
    await ClashManager.initialize();
    await ClashManager.start();

    // Inject Clash to Pool
    if (typeof ProxyPoolManager.injectClashManager === 'function') {
        ProxyPoolManager.injectClashManager(ClashManager);
    }

    // User Config
    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    const question = (query) => new Promise(resolve => readline.question(query, resolve));

    try {
        const countStr = await question('Number of browsers [1]: ');
        const count = parseInt(countStr) || 1;
        const browserChoice = await question('Browser (1=Chrome/2=Edge/3=Firefox/auto) [1]: ');
        
        let browser = 'chrome';
        if (browserChoice === '2') browser = 'edge';
        if (browserChoice === '3') browser = 'firefox';

        const useProxyStr = await question('Use proxy (Y/n)? [Y]: ');
        const useProxy = (useProxyStr || 'Y').toLowerCase() !== 'n';
        const url = await question('Test URL [https://browserscan.net](https://browserscan.net): ') || 'https://browserscan.net';

        // Step 8: Infrastructure
        await InfrastructureBuilder.init(count);

        // Step 9: Launch Workers
        const promises = [];
        for (let i = 0; i < count; i++) {
            promises.push(runMode4Worker(i + 1, browser, useProxy, url));
            await new Promise(r => setTimeout(r, 2000));
        }

        await Promise.all(promises);
    } finally {
        readline.close();
        console.log(`\n🛑 GRACEFUL CLEANUP (NORMAL_EXIT)`);
        
        if (ClashManager.stop) await ClashManager.stop();
        if (ProxyAPIServer.stop) await ProxyAPIServer.stop();
        if (DeviceManager.close) await DeviceManager.close();
        try { if (require('./database').close) await require('./database').close(); } catch(e) {}
    }
}

module.exports = main;

if (require.main === module) {
    main().then(() => {
        console.log('\n✅ All sessions finished. Exiting gracefully.');
        process.exit(0);
    }).catch(err => {
        console.error('FATAL ERROR:', err);
        process.exit(1);
    });
}
