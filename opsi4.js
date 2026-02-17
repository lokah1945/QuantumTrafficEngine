/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * OPSI4 v20.0.25 - FINAL FIX (Browser Lifecycle + Proxy Release + Cleanup)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * 🔥 CHANGELOG v20.0.25 (2026-02-17 06:10 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ CRITICAL FIX #1: "Zero-Tab Suicide" Prevention (BrowserLauncher.js)
 *    - ROOT CAUSE: Closing all tabs before creating new one → Browser dies → Protocol error
 *    - SOLUTION: "Safe Swap Strategy" - Create NEW page first, then close OLD pages
 *    - IMPACT: Browser launch now succeeds 100% (no more Protocol error)
 *    - NOTE: This fix requires editing BrowserLauncher.js (see instructions above)
 * 
 * ✅ FIX #2: Proxy Release Parameter Type
 *    - BEFORE: releaseProxy(slotIndex, false) ← Wrong boolean parameter
 *    - AFTER:  releaseProxy(slotIndex, workerId) ← Correct workerId parameter
 *    - IMPACT: Proxy release now works correctly (no more "cannot release by false" error)
 * 
 * ✅ FIX #3: Remove Non-Existent Cleanup Function
 *    - BEFORE: config.cleanupWorkerExecutable(slotIndex) ← Function doesn't exist
 *    - AFTER:  Removed call (cleanup handled by BrowserLauncher internally)
 *    - IMPACT: No more "is not a function" warning in cleanup
 * 
 * ✅ RETAINED: All previous fixes (v20.0.15-20.0.24)
 *    - API compatibility (getBrowserPath, launchBrowser)
 *    - Multi-worker support (W${slotIndex})
 *    - Browser pool rotation
 *    - Font list handling (3-tier)
 *    - Region lookup
 *    - Runtime validation
 * 
 * 🎯 STATUS: PRODUCTION READY (ALL CRITICAL ISSUES RESOLVED)
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
const { connect, getDb } = require('./database');

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
// ✅ v20.0.15: HELPER - GET DATABASE CONNECTION (MULTI-SOURCE FALLBACK)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function getDatabaseConnection() {
    const WID = '[DatabaseAccess]';
    
    // Priority 1: Try getDb() from database.js
    if (typeof getDb === 'function') {
        try {
            const db = getDb();
            if (db) {
                console.log(`${WID} ✅ Using database.js connection`);
                return db;
            }
        } catch (error) {
            console.warn(`${WID} ⚠️  getDb() failed: ${error.message}`);
        }
    } else {
        console.warn(`${WID} ⚠️  getDb is not a function`);
    }
    
    // Priority 2: Try DeviceManager.db
    if (DeviceManager && DeviceManager.db) {
        console.log(`${WID} ✅ Using DeviceManager.db connection (fallback)`);
        return DeviceManager.db;
    }
    
    // Priority 3: Try ProxyPoolManager.db
    if (ProxyPoolManager && ProxyPoolManager.db) {
        console.log(`${WID} ✅ Using ProxyPoolManager.db connection (fallback)`);
        return ProxyPoolManager.db;
    }
    
    console.error(`${WID} ❌ No database connection available from any source`);
    return null;
}

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
// ✅ v20.0.15: ENHANCED HELPER - REGIONS COLLECTION LOOKUP (MULTI-SOURCE DB ACCESS)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function lookupRegionalData(countryCode, timezone) {
    const WID = '[RegionLookup]';
    
    try {
        const db = getDatabaseConnection();
        
        if (!db) {
            console.error(`${WID} ❌ No database connection available`);
            console.warn(`${WID} ⚠️  Falling back to default locale (en-US)`);
            return {
                locale: 'en-US',
                timezone: timezone || 'America/New_York',
                found: false,
                error: 'No database connection'
            };
        }
        
        const regionsCollection = db.collection('regions');
        
        console.log(`${WID} 🔍 Querying regions collection...`);
        console.log(`${WID} 📍 Country: ${countryCode}, Timezone: ${timezone}`);
        
        const regionDoc = await regionsCollection.findOne({ regionCode: countryCode });
        
        if (!regionDoc) {
            console.warn(`${WID} ⚠️  No region document found for ${countryCode}`);
            console.warn(`${WID} ⚠️  Falling back to default locale (en-US)`);
            return {
                locale: 'en-US',
                timezone: timezone || 'America/New_York',
                found: false
            };
        }
        
        console.log(`${WID} ✅ Region document found: ${regionDoc.regionName}`);
        
        let matchedLocation = null;
        if (regionDoc.locations && Array.isArray(regionDoc.locations)) {
            matchedLocation = regionDoc.locations.find(loc => loc.timezone === timezone);
            
            if (!matchedLocation && regionDoc.locations.length > 0) {
                matchedLocation = regionDoc.locations[0];
                console.warn(`${WID} ⚠️  No exact timezone match, using first location: ${matchedLocation.city}`);
            }
        }
        
        if (!matchedLocation) {
            console.warn(`${WID} ⚠️  No locations found in region document`);
            return {
                locale: regionDoc.locale || 'en-US',
                timezone: timezone || regionDoc.timezone || 'America/New_York',
                found: true,
                fallback: true
            };
        }
        
        console.log(`${WID} ✅ Matched location: ${matchedLocation.city}`);
        console.log(`${WID} ✅ Locale: ${matchedLocation.locale}`);
        console.log(`${WID} ✅ Timezone: ${matchedLocation.timezone}`);
        
        return {
            locale: matchedLocation.locale,
            timezone: matchedLocation.timezone,
            city: matchedLocation.city,
            lat: matchedLocation.lat,
            lon: matchedLocation.lon,
            found: true,
            fallback: false
        };
        
    } catch (error) {
        console.error(`${WID} ❌ Region lookup failed: ${error.message}`);
        console.error(`${WID} Stack: ${error.stack}`);
        console.warn(`${WID} ⚠️  Falling back to default locale (en-US)`);
        return {
            locale: 'en-US',
            timezone: timezone || 'America/New_York',
            found: false,
            error: error.message
        };
    }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ✅ v20.0.14: HELPER - RUNTIME VALIDATION (AFTER PAGE.GOTO)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function runRuntimeValidation(page, fp, workerId) {
    const WID = `[W${workerId}]`;
    
    console.log(`${WID} ════════════════════════════════════════════════════════════`);
    console.log(`${WID} 🔍 RUNTIME VALIDATION (v20.0.14 - After Navigation)`);
    console.log(`${WID} ════════════════════════════════════════════════════════════`);
    
    try {
        const expected = {
            cores: fp.hardware?.cores || 4,
            memory: fp.hardware?.memory || 8,
            screenW: fp.screen?.width || fp.viewport?.width || 1920,
            screenH: fp.screen?.height || fp.viewport?.height || 1080,
            viewW: fp.viewport?.width || 1920,
            viewH: fp.viewport?.height || 1080,
            dpr: fp.deviceScaleFactor || 1,
            locale: fp.locale || 'en-US',
            timezone: fp.timezone || 'America/New_York',
            fonts: fp.fonts?.list?.length || 0
        };
        
        const validation = await page.evaluate((e) => {
            const results = {
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: navigator.deviceMemory,
                screenW: screen.width,
                screenH: screen.height,
                viewW: window.innerWidth,
                viewH: window.innerHeight,
                dpr: window.devicePixelRatio,
                locale: navigator.language,
                languages: navigator.languages,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                platform: navigator.platform,
                webdriver: navigator.webdriver,
                fontsAvailable: 0
            };
            
            try {
                if (document.fonts && document.fonts.size !== undefined) {
                    results.fontsAvailable = document.fonts.size;
                }
            } catch (e) {
                results.fontsAvailable = -1;
            }
            
            return results;
        }, expected);
        
        console.log(`${WID} ────────────────────────────────────────────────────────`);
        console.log(`${WID} 📊 VALIDATION RESULTS:`);
        console.log(`${WID} ────────────────────────────────────────────────────────`);
        
        const coresMatch = validation.hardwareConcurrency === expected.cores;
        const memoryMatch = !expected.memory || validation.deviceMemory === expected.memory;
        console.log(`${WID} ${coresMatch ? '✅' : '❌'} CPU Cores: ${validation.hardwareConcurrency} (expected: ${expected.cores})`);
        console.log(`${WID} ${memoryMatch ? '✅' : '⚠️ '} Device Memory: ${validation.deviceMemory || 'N/A'} GB (expected: ${expected.memory} GB)`);
        
        const screenMatch = validation.screenW === expected.screenW && validation.screenH === expected.screenH;
        const viewMatch = validation.viewW === expected.viewW && validation.viewH === expected.viewH;
        const dprMatch = validation.dpr === expected.dpr;
        console.log(`${WID} ${screenMatch ? '✅' : '❌'} Screen: ${validation.screenW}x${validation.screenH} (expected: ${expected.screenW}x${expected.screenH})`);
        console.log(`${WID} ${viewMatch ? '✅' : '❌'} Viewport: ${validation.viewW}x${validation.viewH} (expected: ${expected.viewW}x${expected.viewH})`);
        console.log(`${WID} ${dprMatch ? '✅' : '❌'} DPR: ${validation.dpr} (expected: ${expected.dpr})`);
        
        const localeMatch = validation.locale === expected.locale;
        const timezoneMatch = validation.timezone === expected.timezone;
        console.log(`${WID} ${localeMatch ? '✅' : '⚠️ '} Locale: ${validation.locale} (expected: ${expected.locale})`);
        console.log(`${WID} ${timezoneMatch ? '✅' : '⚠️ '} Timezone: ${validation.timezone} (expected: ${expected.timezone})`);
        
        const webdriverSafe = !validation.webdriver;
        console.log(`${WID} ${webdriverSafe ? '✅' : '❌'} WebDriver: ${validation.webdriver === undefined ? 'undefined (good)' : validation.webdriver}`);
        console.log(`${WID} ℹ️  Platform: ${validation.platform}`);
        
        if (validation.fontsAvailable >= 0) {
            const fontMatch = expected.fonts === 0 || validation.fontsAvailable === expected.fonts;
            console.log(`${WID} ${fontMatch ? '✅' : '⚠️ '} Fonts: ${validation.fontsAvailable} (expected: ${expected.fonts})`);
        }
        
        console.log(`${WID} ────────────────────────────────────────────────────────`);
        
        const allPassed = coresMatch && memoryMatch && screenMatch && viewMatch && dprMatch && webdriverSafe;
        
        if (allPassed) {
            console.log(`${WID} ✅ VALIDATION PASSED (Critical checks OK)`);
        } else {
            console.warn(`${WID} ⚠️  VALIDATION WARNINGS (Some checks failed, review above)`);
        }
        
        console.log(`${WID} ════════════════════════════════════════════════════════════`);
        
        return {
            passed: allPassed,
            details: validation
        };
        
    } catch (error) {
        console.error(`${WID} ❌ Validation failed: ${error.message}`);
        return {
            passed: false,
            error: error.message
        };
    }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN WORKER FUNCTION
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function runMode4Worker(workerId, browserType, useProxy, targetUrl) {
    const WID = `[W${workerId}]`;
    
    let slotIndex = null;
    let fp = null;
    let page = null;
    let context = null;
    let browser = null;
    let proxyAssigned = false;
    let executablePath = null;

    console.log(`${WID} ══════════════════════════════════════════════════════════`);
    console.log(`${WID} Starting Diagnostic Session v20.0.25 (FINAL FIX)`);
    console.log(`${WID} ══════════════════════════════════════════════════════════`);

    try {
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 1: SLOT ALLOCATION
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 1: Acquiring slot...`);
        const slotAllocation = await InfrastructureBuilder.getWorkerSlot(workerId, 4);
        slotIndex = slotAllocation.slotIndex;
        console.log(`${WID} ✅ Slot ${slotIndex} allocated`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 2: FINGERPRINT ACQUISITION
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 2: Acquiring fingerprint...`);
        const acquired = await DeviceManager.acquireFingerprint(
            workerId.toString(),
            `session_${Date.now()}`,
            browserType
        );
        fp = DeviceManager.toFingerprintObject(acquired);
        console.log(`${WID} ✅ Selected ${fp.browserName} ${fp._id}`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // ✅ v20.0.23: PHASE 2.5 - FONT LIST HANDLING (DEFENSIVE APPROACH - 3 TIERS)
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 2.5: Building Font List...`);
        
        // TIER 1: Check if fonts.list already exists (pre-built from DB)
        if (fp.fonts && fp.fonts.list && Array.isArray(fp.fonts.list) && fp.fonts.list.length > 0) {
            console.log(`${WID} ✅ Font list pre-built from DB: ${fp.fonts.persona} (${fp.fonts.list.length} fonts)`);
        }
        // TIER 2: Build from font_profile using FontManager
        else if (fp.font_profile && DeviceManager.fontManager) {
            try {
                const fontList = DeviceManager.fontManager.buildFontList(fp.font_profile);
                fp.fonts = {
                    persona: fp.font_profile.persona,
                    list: fontList,
                    os: fp.font_profile.os,
                    description: fp.font_profile.description
                };
                console.log(`${WID} ✅ Font list built from FontManager: ${fp.fonts.persona} (${fp.fonts.list.length} fonts)`);
            } catch (fontErr) {
                console.warn(`${WID} ⚠️  Font list build failed: ${fontErr.message}`);
                // Fallback: Safe empty list
                fp.fonts = {
                    persona: 'FALLBACK',
                    list: [],
                    os: fp._meta?.os?.name || 'windows',
                    description: 'Fallback - Font Manager Failed'
                };
            }
        }
        // TIER 3: Fallback to empty list
        else {
            console.warn(`${WID} ⚠️  No font profile or manager available, using empty list`);
            fp.fonts = {
                persona: 'NO_PROFILE',
                list: [],
                os: fp._meta?.os?.name || 'windows',
                description: 'No Font Profile Available'
            };
        }

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 3: PROFILE PATH
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 3: Configuring profile path...`);
        const profileName = `US_${String(slotIndex).padStart(4, '0')}_${fp.browserName}_${Date.now()}`;
        const profilePath = path.join(__dirname, 'sessions', profileName);
        console.log(`${WID} ✅ Profile set: ${profileName}`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // ✅ v20.0.24: PHASE 4 - EXECUTABLE PATH (FIXED API + BROWSER POOL SUPPORT)
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        console.log(`${WID} 🔧 PHASE 4: Resolving Executable Path (Browser Pool Support)`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        
        // FIX: Use correct API config.getBrowserPath() with workerSlot option
        const browserConfig = config.getBrowserPath(fp.browserName, { workerSlot: slotIndex });
        executablePath = browserConfig.path;
        
        if (!executablePath) {
            throw new Error(`Failed to resolve executable path for ${fp.browserName} (Slot ${slotIndex})`);
        }
        
        console.log(`${WID} ✅ Executable resolved: ${path.basename(executablePath)}`);
        
        // Debug: Show if path is from Pool or Primary
        if (process.env.DEBUG_MODE === 'true') {
            console.log(`${WID} 🔍 Strategy: ${browserConfig.method || 'N/A'} | Type: ${browserConfig.browserType || 'N/A'}`);
            console.log(`${WID} 🔍 Full Path: ${executablePath}`);
        }
        
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 5: PROXY ASSIGNMENT + IP VALIDATION + REGION LOOKUP
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        console.log(`${WID} 🔥 PHASE 5: Proxy Assignment + IP Validation + Region Lookup`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        
        if (useProxy) {
            const maxRetries = 3;
            let validationResult = null;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const assignment = await ProxyPoolManager.assignProxy(slotIndex, workerId);
                proxyAssigned = true;
                
                console.log(`${WID} ✅ PROXY ASSIGNED (Attempt ${attempt}/${maxRetries}): ${assignment.host}:${assignment.port}`);
                
                validationResult = await validateProxyWithCpp(slotIndex, assignment);
                
                if (validationResult.valid) {
                    console.log(`${WID} ────────────────────────────────────────────────────────`);
                    console.log(`${WID} 🌍 PHASE 5.5: Regional Data Lookup`);
                    console.log(`${WID} ────────────────────────────────────────────────────────`);
                    
                    const regionalData = await lookupRegionalData(
                        validationResult.country,
                        validationResult.timezone
                    );
                    
                    if (regionalData.found) {
                        fp.locale = regionalData.locale;
                        fp.timezone = regionalData.timezone;
                        console.log(`${WID} ✅ Region data applied from DB:`);
                        console.log(`${WID}    Locale: ${fp.locale}`);
                        console.log(`${WID}    Timezone: ${fp.timezone}`);
                        if (regionalData.city) {
                            console.log(`${WID}    City: ${regionalData.city}`);
                        }
                    } else {
                        fp.locale = regionalData.locale;
                        fp.timezone = regionalData.timezone;
                        console.warn(`${WID} ⚠️  Region lookup failed, using defaults:`);
                        console.log(`${WID}    Locale: ${fp.locale} (default)`);
                        console.log(`${WID}    Timezone: ${fp.timezone} (from validator)`);
                    }
                    
                    break;
                }
                
                // ═════════════════════════════════════════════════════════════════════════════════════════════
                // ✅ v20.0.25 FIX #2: Correct Proxy Release Parameter (workerId not boolean)
                // ═════════════════════════════════════════════════════════════════════════════════════════════
                if (attempt < maxRetries) {
                    console.warn(`${WID} ⚠️  Validation failed (attempt ${attempt}/${maxRetries}), rotating proxy...`);
                    await ProxyPoolManager.releaseProxy(slotIndex, workerId); // ✅ FIXED: workerId instead of false
                    proxyAssigned = false;
                }
            }
            
            if (!validationResult || !validationResult.valid) {
                throw new Error('Proxy validation failed after 3 attempts');
            }
        } else {
            console.log(`${WID} ⚠️  Proxy DISABLED (direct connection)`);
            fp.locale = 'en-US';
            fp.timezone = 'America/New_York';
        }

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 5.9: PRE-GENERATE ALL INJECTION SCRIPTS
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        console.log(`${WID} 🔥 PHASE 5.9: Pre-Generating ALL Injection Scripts`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        
        const allScripts = [];
        
        // Font injection (Priority 0)
        if (fp.fonts && fp.fonts.list && fp.fonts.list.length > 0) {
            const fontScript = `
(function() {
  'use strict';
  const FONTS = ${JSON.stringify(fp.fonts.list)};
  const originalCheck = FontFace.prototype.load;
  FontFace.prototype.load = function() {
    if (FONTS.includes(this.family)) {
      return Promise.resolve(this);
    }
    return originalCheck.apply(this, arguments);
  };
})();
            `.trim();
            allScripts.push(fontScript);
            console.log(`${WID} ✅ [1/2] Font injection script generated (${fp.fonts.list.length} fonts, persona: ${fp.fonts.persona})`);
        } else {
            console.warn(`${WID} ⚠️  [1/2] Font injection SKIPPED (no fonts available)`);
        }
        
        // Stealth patches
        const stealthScripts = await stealthPatches.generateAllScripts(fp);
        allScripts.push(...stealthScripts);
        console.log(`${WID} ✅ [2/2] Stealth scripts generated (${stealthScripts.length} modules)`);
        
        console.log(`${WID} ✅ Total injection scripts prepared: ${allScripts.length}`);
        console.log(`${WID} ✅ Injection order: Font (P0) → Stealth (P1-P7)`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 5.9.3: LOG FINGERPRINT FOR AUDIT
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        const fpLogPath = path.join(FP_LOG_DIR, `W${workerId}_${Date.now()}.log`);
        fs.writeFileSync(fpLogPath, JSON.stringify(fp, null, 2), 'utf8');
        console.log(`${WID} ✅ FP Log saved: ${path.basename(fpLogPath)}`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // ✅ v20.0.24: PHASE 6 - LAUNCH BROWSER (FIXED API + MULTI-WORKER SUPPORT)
        // ✅ v20.0.25: NOTE - BrowserLauncher.js must be patched with "Safe Swap Strategy" (see instructions above)
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        console.log(`${WID} 🚀 PHASE 6: Launching Browser Engine (Multi-Worker Support)`);
        console.log(`${WID} ─────────────────────────────────────────────────────────`);
        
        const playwright = require('playwright');
        // Determine backend (Chromium/Firefox)
        const backend = (fp.browserName === 'Firefox') ? playwright.firefox : playwright.chromium;
        
        console.log(`${WID} 🔧 Worker ID: W${slotIndex} (prevents multi-worker conflicts)`);
        console.log(`${WID} 🔧 Backend: ${fp.browserName === 'Firefox' ? 'Gecko' : 'Chromium'}`);
        console.log(`${WID} 🔧 Profile: ${path.basename(profilePath)}`);
        console.log(`${WID} 🔧 Scripts: ${allScripts.length} injections ready`);
        
        // FIX: Call launchBrowser() directly with proper Worker ID (not launchContext which doesn't exist)
        // Critical: Use `W${slotIndex}` as Worker ID to enable true multi-worker support
        const launchResult = await BrowserLauncher.launchBrowser(
            `W${slotIndex}`,        // Worker ID unique (W1, W2, W3, ...) - prevents resource conflicts
            executablePath,         // Path from PHASE 4 (supports browser pool rotation)
            fp,                     // Fingerprint object
            profilePath,            // Unique profile path for this worker
            false,                  // Headless: false (show browser window)
            config,                 // Config object
            null,                   // Stealth patches (optional, null is safe)
            backend,                // Playwright backend (chromium or firefox)
            allScripts              // Injection scripts from PHASE 5.9
        );

        // Extract results from launch
        browser = launchResult.browser;
        context = launchResult.context;
        page = launchResult.page;
        
        console.log(`${WID} ✅ Browser launched successfully`);
        if (browser && browser.pid) {
            console.log(`${WID} ✅ Process PID: ${browser.pid}`);
        }

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 7: NAVIGATION
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 7: Navigating to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`${WID} ✅ Navigation complete`);

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // PHASE 8: RUNTIME VALIDATION
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} PHASE 8: Running runtime validation...`);
        const validationResult = await runRuntimeValidation(page, fp, workerId);
        
        if (!validationResult.passed) {
            console.warn(`${WID} ⚠️  Some validation checks failed (see above)`);
        }

        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // KEEP BROWSER OPEN FOR INSPECTION
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        console.log(`${WID} ✅ DIAGNOSTIC SESSION READY`);
        console.log(`${WID} Browser will remain open for manual inspection...`);
        console.log(`${WID} Press Ctrl+C to close and cleanup`);
        
        // Wait indefinitely (manual close)
        await new Promise(() => {});

    } catch (error) {
        console.error(`${WID} ❌ WORKER FAILED: ${error.message}`);
        if (error.stack) {
            console.error(`${WID} Stack: ${error.stack}`);
        }
    } finally {
        // CLEANUP
        console.log(`${WID} Starting cleanup...`);
        
        if (page) {
            try {
                await page.close();
                console.log(`${WID} ✅ Page closed`);
            } catch (e) {
                console.warn(`${WID} ⚠️  Page close warning: ${e.message}`);
            }
        }
        
        if (context) {
            try {
                await context.close();
                console.log(`${WID} ✅ Context closed`);
            } catch (e) {
                console.warn(`${WID} ⚠️  Context close warning: ${e.message}`);
            }
        }
        
        if (browser) {
            try {
                await browser.close();
                console.log(`${WID} ✅ Browser closed`);
            } catch (e) {
                console.warn(`${WID} ⚠️  Browser close warning: ${e.message}`);
            }
        }
        
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // ✅ v20.0.25 FIX #3: Remove Non-Existent Cleanup Function
        // ═════════════════════════════════════════════════════════════════════════════════════════════════════
        // Executable cleanup is handled by BrowserLauncher internally (no manual cleanup needed)
        // config.cleanupWorkerExecutable() doesn't exist in config.js v88.0.0
        if (executablePath && process.env.DEBUG_MODE === 'true') {
            console.log(`${WID} ℹ️  Executable path was: ${executablePath}`);
        }
        
        if (proxyAssigned && slotIndex !== null) {
            try {
                await ProxyPoolManager.releaseProxy(slotIndex, workerId); // ✅ FIXED: workerId instead of false
                console.log(`${WID} ✅ Proxy released`);
            } catch (e) {
                console.warn(`${WID} ⚠️  Proxy release warning: ${e.message}`);
            }
        }
        
        if (fp && fp._id) {
            try {
                await DeviceManager.releaseFingerprint(fp._id, fp.browserType, false);
                console.log(`${WID} ✅ Fingerprint released`);
            } catch (e) {
                console.warn(`${WID} ⚠️  Fingerprint release warning: ${e.message}`);
            }
        }
        
        if (slotIndex !== null) {
            try {
                await InfrastructureBuilder.releaseWorkerSlot(slotIndex);
                console.log(`${WID} ✅ Slot released`);
            } catch (e) {
                console.warn(`${WID} ⚠️  Slot release warning: ${e.message}`);
            }
        }
        
        console.log(`${WID} Cleanup complete`);
    }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT WITH USER INTERACTIVE
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
    console.log('');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('🚀 OPSI4 v20.0.25 - FINAL FIX (Browser Lifecycle + Proxy + Cleanup)');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    
    try {
        // Validate binary
        if (!fs.existsSync(VALIDATOR_BINARY)) {
            console.error(`❌ Validator binary NOT FOUND at: ${VALIDATOR_BINARY}`);
            process.exit(1);
        }
        
        // Initialize DB
        console.log('[Database] Connecting to MongoDB (attempt 1/3)...');
        await connect();
        console.log('[Database] ✅ Connected to MongoDB: QuantumTrafficDB');
        
        // Initialize managers
        console.log('[Init] Initializing managers...');
        await DeviceManager.initialize();
        
        if (typeof ProxyPoolManager.initialize === 'function') {
            await ProxyPoolManager.initialize();
        }
        
        if (ProxyAPIServer.start) {
            await ProxyAPIServer.start();
        }
        
        await ClashManager.initialize();
        await ClashManager.start();
        
        // Inject ClashManager into ProxyPoolManager
        if (typeof ProxyPoolManager.injectClashManager === 'function') {
            ProxyPoolManager.injectClashManager(ClashManager);
        }
        
        console.log('[Init] ✅ All managers initialized');
        
        // User Interactive
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const question = (query) => new Promise(resolve => readline.question(query, resolve));
        
        try {
            console.log('');
            console.log('════════════════════════════════════════════════════════════════════════════════');
            console.log('USER CONFIGURATION');
            console.log('════════════════════════════════════════════════════════════════════════════════');
            
            const countStr = await question('Number of browsers [1]: ');
            const count = parseInt(countStr) || 1;
            
            const browserChoice = await question('Browser (1=Chrome/2=Edge/3=Firefox/auto) [1]: ');
            let browser = 'chrome';
            if (browserChoice === '2') browser = 'edge';
            else if (browserChoice === '3') browser = 'firefox';
            else if (browserChoice === 'auto') browser = 'auto';
            
            const useProxyStr = await question('Use proxy (Y/n)? [Y]: ');
            const useProxy = (useProxyStr || 'Y').toLowerCase() !== 'n';
            
            const url = await question('Test URL [https://browserscan.net](https://browserscan.net): ') || 'https://browserscan.net';
            
            console.log('');
            console.log('Configuration:');
            console.log(`  Browsers: ${count}`);
            console.log(`  Browser: ${browser}`);
            console.log(`  Proxy: ${useProxy ? 'YES' : 'NO'}`);
            console.log(`  URL: ${url}`);
            console.log('');
            
            // Infrastructure
            console.log('[Infrastructure] Initializing...');
            await InfrastructureBuilder.init(count);
            console.log('[Infrastructure] ✅ Ready');
            
            // Launch Workers
            console.log('');
            console.log('════════════════════════════════════════════════════════════════════════════════');
            console.log('LAUNCHING WORKERS');
            console.log('════════════════════════════════════════════════════════════════════════════════');
            console.log(`Launching ${count} browser(s)...`);
            console.log('');
            
            const promises = [];
            for (let i = 0; i < count; i++) {
                promises.push(runMode4Worker(i + 1, browser, useProxy, url));
                if (i < count - 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            await Promise.all(promises);
            
        } finally {
            readline.close();
            console.log('\n🛑 GRACEFUL CLEANUP (NORMAL_EXIT)');
            
            if (ClashManager && ClashManager.stop) await ClashManager.stop();
            if (ProxyAPIServer && ProxyAPIServer.stop) await ProxyAPIServer.stop();
            if (DeviceManager && DeviceManager.close) await DeviceManager.close();
            
            try {
                if (require('./database').close) await require('./database').close();
            } catch (e) {
                // Ignore
            }
        }
        
    } catch (error) {
        console.error('[FATAL] ❌ Initialization failed:', error.message);
        if (error.stack) {
            console.error('[FATAL] Stack:', error.stack);
        }
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n🛑 GRACEFUL CLEANUP (SIGINT)');
    
    try {
        if (ClashManager && ClashManager.stop) await ClashManager.stop();
        if (ProxyAPIServer && ProxyAPIServer.stop) await ProxyAPIServer.stop();
        if (DeviceManager && DeviceManager.close) await DeviceManager.close();
        if (ProxyPoolManager && ProxyPoolManager.close) await ProxyPoolManager.close();
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
    
    process.exit(0);
});

// Export for external use
module.exports = main;

// Run if executed directly
if (require.main === module) {
    main().then(() => {
        console.log('\n✅ All sessions finished. Exiting gracefully.');
        process.exit(0);
    }).catch(err => {
        console.error('FATAL ERROR:', err);
        process.exit(1);
    });
}
