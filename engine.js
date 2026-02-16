// ═══════════════════════════════════════════════════════════════════════════════
// engine.js v71.1.0 - Clash Meta + ProxyPoolManager Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// PROJECT: Quantum Traffic Engine v71.1
// FILE: engine.js
// VERSION: 71.1.0 (ProxyPoolManager Integration Documentation)
// DATE: 2026-02-06
//
// CHANGELOG v71.1.0 (2026-02-06 11:25 WIB):
// ═══════════════════════════════════════════════════════════════════════════════
//
// 🔥 NEW: ProxyPoolManager → ProxyAPIServer Integration (opsi4.js)
// ✅ ADDED: Integration documentation (ProxyPoolManager injection flow)
// ✅ ADDED: Provider reload architecture notes
// ✅ UPDATED: Mode 4 features (provider-based proxy switching)
// ✅ PRESERVED: All v71.0.0 functionality (no breaking changes)
//
// INTEGRATION ARCHITECTURE (opsi4.js v16.2.0+):
// ═══════════════════════════════════════════════════════════════════════════════
//
// INITIALIZATION FLOW (in opsi4.js main()):
// ──────────────────────────────────────────────────────────────────────────────
// 1. ProxyQualityManager.init()
//    └─ Load proxy health scoring system
//
// 2. ClashManager.init()
//    └─ Start Clash Meta (TUN mode)
//    └─ Wait for API ready (127.0.0.1:9090)
//
// 3. ProxyPoolManager = new ProxyPoolManager(proxyQualityManager, clashManager)
//    └─ Manages slot assignments (slotAssignments[1-9999])
//
// 4. ProxyAPIServer.init(proxyPoolManager)  ← 🔥 INJECTION POINT!
//    └─ Create Express server (127.0.0.1:3000)
//    └─ Register provider endpoints:
//       • GET /clash/provider/slot/:slotId
//         └─ Look up proxyPoolManager.getSlotProxy(slotId)
//         └─ Generate YAML with actual proxy from MongoDB
//       • GET /clash/provider/status
//         └─ Return proxyPoolManager.getActiveSlots()
//
// 5. Workers start → Request proxy
//    └─ proxyPoolManager.assignProxy(slotIndex, workerId)
//    └─ Update slotAssignments[slotIndex] = { proxy, workerId }
//    └─ proxyPoolManager.reloadProvider(slotIndex)
//    └─ Clash fetches: http://127.0.0.1:3000/clash/provider/slot/{slotIndex}
//    └─ ProxyAPIServer reads slotAssignments[slotIndex]
//    └─ Returns YAML with actual proxy credentials
//    └─ Clash updates provider cache
//    └─ Worker traffic routed via actual proxy!
//
// PROVIDER RELOAD FLOW:
// ──────────────────────────────────────────────────────────────────────────────
// Worker Task Complete:
//   ↓
// proxyPoolManager.rotateProxy(slotIndex, workerId)
//   ↓
// Release old proxy (cooldown)
//   ↓
// Assign new proxy (update slotAssignments[slotIndex])
//   ↓
// reloadProvider(slotIndex)
//   ↓ PUT /providers/proxies/PROV_001
// Clash Meta receives reload request
//   ↓
// Clash fetches: http://127.0.0.1:3000/clash/provider/slot/1
//   ↓
// ProxyAPIServer.getSlotProxy(1) → Returns new proxy YAML
//   ↓
// Clash updates provider cache
//   ↓
// Next request uses NEW proxy (NO RESTART!)
//
// CODE STRUCTURE (opsi4.js):
// ──────────────────────────────────────────────────────────────────────────────
// const ProxyQualityManager = require('./ProxyQualityManager');
// const ClashManager = require('./ClashManager');
// const ProxyPoolManager = require('./ProxyPoolManager');
// const ProxyAPIServer = require('./ProxyAPIServer');
//
// async function main() {
//   // 1. Init proxy health scoring
//   const proxyQualityManager = new ProxyQualityManager();
//   await proxyQualityManager.init();
//
//   // 2. Start Clash Meta
//   const clashManager = new ClashManager(qteId);
//   await clashManager.init();
//
//   // 3. Create ProxyPoolManager
//   const proxyPoolManager = new ProxyPoolManager(
//     proxyQualityManager,
//     clashManager
//   );
//
//   // 4. 🔥 INJECT ProxyPoolManager into ProxyAPIServer
//   const proxyAPIServer = new ProxyAPIServer();
//   await proxyAPIServer.init(proxyPoolManager);  // ← CRITICAL!
//
//   // 5. Workers start...
//   // Each worker calls:
//   const proxy = await proxyPoolManager.assignProxy(slotIndex, workerId);
//   // Provider auto-reloaded via reloadProvider()
// }
//
// REQUIRED UPDATES:
// ──────────────────────────────────────────────────────────────────────────────
// ✅ ProxyPoolManager.js v1.2.0 (reloadProvider method)
// ✅ ProxyAPIServer.js v3.3.0 (provider endpoints + injection)
// ✅ ClashStaticGenerator.js v5.3.0 (proxy-providers config)
// ✅ opsi4.js v16.2.0 (integration code - NEXT FILE!)
//
// PREVIOUS CHANGELOG v71.0.0 (2026-02-03):
// ──────────────────────────────────────────────────────────────────────────────
// 🔥 BREAKING CHANGES - ZERO BACKWARD COMPATIBILITY:
// ✅ REMOVED: ALL Native Router components (steering.exe, pid_tracker.exe, ETW, WinDivert)
// ✅ REMOVED: Sandboxie references (deprecated in v70.x)
// ✅ ADDED: Clash Meta infrastructure validation
// ✅ ADDED: QTE_ID requirement (CRITICAL for config generation)
// ✅ ADDED: Administrator privilege check (TUN mode requirement)
//
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// 🔴 CRITICAL: Load .env file FIRST
// ═══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { setupLogging } = require('./utils');

setupLogging();

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION INFO
// ═══════════════════════════════════════════════════════════════════════════════
const VERSION = '71.1.0';
const BUILD_DATE = '2026-02-06';
const CODENAME = 'Clash Meta + ProxyPoolManager Integration';

// ═══════════════════════════════════════════════════════════════════════════════
// CLASH META CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const CLASH_BINARY_PATH = process.env.CLASH_BINARY_PATH || './Clash/clash.exe';
const CLASH_CONFIG_DIR = process.env.CLASH_CONFIG_DIR || './Clash/config';
const CLASH_CONFIG_BASE = './Clash/config_clash.json';
const CLASH_LOG_DIR = process.env.CLASH_LOG_DIR || './Clash/logs';

// ═══════════════════════════════════════════════════════════════════════════════
// MODE CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════════
const MODES = {
    1: {
        name: 'WARM-UP',
        description: 'Create fresh profiles with initial warm-up visits',
        icon: '🔵',
        handler: './opsi1.js',
        color: '\x1b[36m',
        features: [
            'Generate new fingerprint (random browser)',
            'Setup profile from master template',
            'Visit warm-up site (region-based)',
            'Simple scrolling behavior only',
            'Profile saved for Mode 2 reuse',
            'Ideal for building profile inventory'
        ],
        requirements: [
            'MongoDB connection',
            'Clash Meta running (auto-started)',
            'Master profile templates',
            'Sufficient disk space'
        ],
        outputType: 'New profiles saved to sessions/',
        status: 'LEGACY (will be upgraded to Clash Meta architecture)'
    },
    2: {
        name: 'SIMULATION',
        description: 'Use mature profiles with full human behavior simulation',
        icon: '🟢',
        handler: './opsi2.js',
        color: '\x1b[32m',
        features: [
            'Use mature profiles (min hours requirement)',
            'Load existing fingerprint from disk',
            'Visit target URLs from database',
            'FULL human behavior simulation:',
            '  • Random scrolling with mouse tracking',
            '  • Random clicks (blacklist-aware)',
            '  • Link navigation (same-domain)',
            '  • Tab switching simulation',
            '  • Duration-based activity',
            'Update hit_count in database',
            'Best for realistic traffic simulation'
        ],
        requirements: [
            'Mature profiles (from Mode 1)',
            'Target URLs in database',
            'Click blacklist file',
            'MongoDB connection',
            'Proxy pool (MongoDB-based)'
        ],
        outputType: 'Database hit_count updates',
        status: 'LEGACY (will be upgraded to Clash Meta architecture)'
    },
    3: {
        name: 'FRESH',
        description: 'Temporary profiles with full behavior (auto-deleted)',
        icon: '🟡',
        handler: './opsi3.js',
        color: '\x1b[33m',
        features: [
            'Create temporary profile (one-time use)',
            'Generate fingerprint (can force browser)',
            'Visit target URLs from database',
            'FULL human behavior simulation',
            'Profile auto-deleted during recycle',
            'Perfect for:',
            '  • High-volume fresh traffic',
            '  • Clean slate testing',
            '  • Anonymous visits',
            'No profile storage overhead'
        ],
        requirements: [
            'Target URLs in database',
            'Master profile templates',
            'MongoDB connection',
            'Adequate recycle buffer'
        ],
        outputType: 'Temporary sessions (auto-cleaned)',
        status: 'LEGACY (will be upgraded to Clash Meta architecture)'
    },
    4: {
        name: 'TEST',
        description: 'Stealth fingerprint testing (browserscan.net validation)',
        icon: '🔵',
        handler: './opsi4.js',
        color: '\x1b[34m',
        features: [
            '✅ CLASH META + PROXYPOOLMANAGER (v71.1.0)',
            'STEALTH ONLY (No human-like behavior)',
            'Visit browserscan.net for fingerprint analysis',
            'Clash Meta TUN routing (SLOT-based):',
            '  • Slot 1-1000: Hardlink (Chrome/Firefox)',
            '  • Slot 1001-1200: Worker Dir (Edge)',
            '🔥 NEW: HTTP Provider Integration:',
            '  • ProxyPoolManager manages slotAssignments (RAM)',
            '  • ProxyAPIServer serves provider endpoints',
            '  • Clash fetches proxy on-demand (GET /clash/provider/slot/:id)',
            '  • Runtime proxy switching (NO browser restart!)',
            '  • Provider reload via Clash API (PUT /providers/proxies/PROV_###)',
            'Per-worker proxy assignment (DB-first pattern)',
            'Real-time fingerprint validation:',
            '  • WebRTC leak detection',
            '  • Canvas fingerprinting',
            '  • WebGL renderer spoofing',
            '  • Font enumeration',
            '  • Audio context fingerprint',
            '  • Timezone & locale spoofing',
            'FOCUS: Detection bypass validation',
            'NO scrolling, NO clicks, NO human simulation',
            'Pure technical stealth testing',
            'Proxy rotation after task completion (60s cooldown)',
            'Cooldown-based proxy management (success/fail/quarantine)'
        ],
        requirements: [
            'Clash Meta running (auto-started by opsi4.js)',
            'ProxyAPIServer (127.0.0.1:3000)',
            'MongoDB connection (proxy pool)',
            'Administrator privileges (TUN mode)',
            'Desktop environment (visible browser)',
            'QTE_ID configured in .env',
            'config_clash.json (DNS + bypass domains)'
        ],
        outputType: 'Visual browser window (manual inspection)',
        status: '✅ PRODUCTION READY (Clash Meta v71.1.0 + ProxyPoolManager Integration)'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ANSI COLORS
// ═══════════════════════════════════════════════════════════════════════════════
const RESET = '\x1b[0m';
const BRIGHT = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
function resetStdin() {
    try {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.resume();
        }
    } catch {
        // ignore
    }
}

async function askQuestion(query) {
    resetStdin();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    return new Promise((resolve) => {
        rl.question(query, (ans) => {
            rl.close();
            process.stdin.removeAllListeners('data');
            resolve(ans);
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if running as Administrator (Windows)
 * @returns {boolean} True if admin, false otherwise
 */
function isAdmin() {
    if (os.platform() !== 'win32') return false;
    
    try {
        const { execSync } = require('child_process');
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISPLAY FUNCTIONS (COMPACT LAYOUT v71.1.0)
// ═══════════════════════════════════════════════════════════════════════════════
function displayBanner() {
    console.clear();
    console.log('');
    console.log(CYAN + BRIGHT + '╔' + '═'.repeat(78) + '╗' + RESET);
    console.log(CYAN + BRIGHT + '║' + YELLOW + BRIGHT + 
        ` QUANTUM TRAFFIC ENGINE v${VERSION}`.padEnd(78) + CYAN + '║' + RESET);
    console.log(CYAN + BRIGHT + '║' + DIM + WHITE + 
        ` ${CODENAME}`.padEnd(78) + CYAN + BRIGHT + '║' + RESET);
    console.log(CYAN + BRIGHT + '║' + GREEN + 
        ' Clash Meta TUN + ProxyPoolManager + HTTP Providers'.padEnd(78) + CYAN + BRIGHT + '║' + RESET);
    console.log(CYAN + BRIGHT + '╚' + '═'.repeat(78) + '╝' + RESET);
    console.log('');
}

function displaySystemInfo() {
    console.log(BRIGHT + '📊 SYSTEM STATUS' + RESET);
    console.log('═'.repeat(80));
    console.log('');

    // Runtime Environment
    console.log(BRIGHT + '🔧 Runtime:' + RESET);
    console.log(`   Node.js: ${GREEN}${process.version}${RESET}`);
    console.log(`   Platform: ${process.platform} (${process.arch})`);
    console.log(`   PID: ${process.pid}`);
    console.log(`   Working Directory: ${DIM}${process.cwd()}${RESET}`);

    // Memory
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const heapPercent = Math.round((heapUsedMB / heapTotalMB) * 100);
    let memColor = GREEN;
    if (heapPercent > 80) memColor = RED;
    else if (heapPercent > 60) memColor = YELLOW;
    console.log(`   Memory: ${memColor}${heapUsedMB}MB${RESET} / ${heapTotalMB}MB (${heapPercent}%)`);
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // ✅ V71.1.0: CLASH META + PROXYPOOLMANAGER ARCHITECTURE
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(BRIGHT + '🔄 CLASH META + PROXYPOOLMANAGER:' + RESET);
    
    // QTE_ID
    const qteId = process.env.QTE_ID || '';
    if (qteId) {
        const configName = `${qteId}_clash.yaml`;
        console.log(`   ${GREEN}✓${RESET} QTE_ID: ${CYAN}${qteId}${RESET} (Config: ${DIM}${configName}${RESET})`);
    } else {
        console.log(`   ${RED}✗${RESET} QTE_ID: ${RED}NOT CONFIGURED${RESET} (Required in .env)`);
    }
    
    // Clash Binary
    if (fs.existsSync(CLASH_BINARY_PATH)) {
        console.log(`   ${GREEN}✓${RESET} Clash Binary: ${DIM}${CLASH_BINARY_PATH}${RESET}`);
    } else {
        console.log(`   ${RED}✗${RESET} Clash Binary: ${RED}NOT FOUND${RESET} (${CLASH_BINARY_PATH})`);
    }
    
    // Clash Base Config
    if (fs.existsSync(CLASH_CONFIG_BASE)) {
        try {
            const configData = JSON.parse(fs.readFileSync(CLASH_CONFIG_BASE, 'utf8'));
            const dnsResolver = configData.dns?.localResolver || 'NOT SET';
            const bypassCount = configData.bypass?.domains?.length || 0;
            console.log(`   ${GREEN}✓${RESET} Base Config: ${DIM}${CLASH_CONFIG_BASE}${RESET}`);
            console.log(`     ${DIM}• DNS Resolver: ${dnsResolver}${RESET}`);
            console.log(`     ${DIM}• Bypass Domains: ${bypassCount} domains${RESET}`);
        } catch (err) {
            console.log(`   ${YELLOW}!${RESET} Base Config: ${YELLOW}INVALID JSON${RESET} (${CLASH_CONFIG_BASE})`);
        }
    } else {
        console.log(`   ${RED}✗${RESET} Base Config: ${RED}NOT FOUND${RESET} (${CLASH_CONFIG_BASE})`);
    }
    
    // ✅ NEW v71.1.0: ProxyAPIServer Status
    const proxyAPIHost = process.env.WINDOWS_API_HOST || '127.0.0.1';
    const proxyAPIPort = parseInt(process.env.WINDOWS_API_PORT || '3000', 10);
    console.log(`   ${DIM}• ProxyAPIServer: ${proxyAPIHost}:${proxyAPIPort}${RESET}`);
    console.log(`     ${DIM}Provider Endpoint: http://${proxyAPIHost}:${proxyAPIPort}/clash/provider/slot/:id${RESET}`);
    
    // Administrator Status
    const adminStatus = isAdmin();
    if (adminStatus) {
        console.log(`   ${GREEN}✓${RESET} Administrator: ${GREEN}YES${RESET} (TUN mode ready)`);
    } else {
        console.log(`   ${YELLOW}!${RESET} Administrator: ${YELLOW}NO${RESET} (TUN mode requires Admin)`);
    }
    
    // Routing Strategy
    const othersReserved = parseInt(process.env.OTHERS_RESERVED || '1000', 10);
    const msedgeReserved = parseInt(process.env.MSEDGE_RESERVED || '200', 10);
    const maxSlot = othersReserved + msedgeReserved;
    console.log(`   ${DIM}• Routing Strategy:${RESET}`);
    console.log(`     ${DIM}Slot 1-${othersReserved}: Hardlink (Chrome/Firefox) - PROCESS-NAME${RESET}`);
    console.log(`     ${DIM}Slot ${othersReserved + 1}-${maxSlot}: Worker Dir (Edge) - PROCESS-PATH${RESET}`);
    console.log(`     ${DIM}Provider: HTTP type (on-demand loading via ProxyAPIServer)${RESET}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════════════════════
    // PREREQUISITES
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(BRIGHT + '✅ Prerequisites:' + RESET);

    // MongoDB - Multi-variable support
    const mongoUri = process.env.MONGO_URI ||
                     process.env.DB_CONNECTION_STRING ||
                     process.env.MONGODB_URL;
    if (mongoUri) {
        const maskedUri = mongoUri.replace(/mongodb:\/\/([^:]+):([^@]+)@/, 'mongodb://$1:****@');
        const varName = process.env.MONGO_URI ? 'MONGO_URI' :
                        process.env.DB_CONNECTION_STRING ? 'DB_CONNECTION_STRING' : 'MONGODB_URL';
        console.log(`   ${GREEN}✓${RESET} MongoDB (${DIM}${varName}${RESET}): ${DIM}${maskedUri}${RESET}`);
    } else {
        console.log(`   ${RED}✗${RESET} MongoDB: ${RED}Not configured in .env${RESET}`);
        console.log(`   ${DIM}Expected: MONGO_URI, DB_CONNECTION_STRING, or MONGODB_URL${RESET}`);
    }

    // Sessions directory
    const sessionsDir = path.join(process.cwd(), 'sessions');
    if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir);
        console.log(`   ${GREEN}✓${RESET} Sessions: ${files.length} profiles in ${DIM}${sessionsDir}${RESET}`);
    } else {
        console.log(`   ${YELLOW}!${RESET} Sessions: ${YELLOW}Directory will be created${RESET}`);
    }

    console.log('');
}

function displayMainMenu() {
    console.log('═'.repeat(80));
    console.log(BRIGHT + WHITE + 'SELECT OPERATION MODE' + RESET);
    console.log('═'.repeat(80));
    console.log('');

    for (const [num, mode] of Object.entries(MODES)) {
        const statusBadge = mode.status?.includes('✅') ? GREEN + '✅' + RESET :
                           mode.status?.includes('LEGACY') ? YELLOW + '⚠️' + RESET : '';
        
        console.log(mode.color + BRIGHT + `${mode.icon} [${num}] ${mode.name.toUpperCase()}` + RESET + 
                    (statusBadge ? ` ${statusBadge}` : ''));
        console.log(`    ${DIM}${mode.description}${RESET}`);
        
        if (mode.status && !mode.status.includes('✅')) {
            console.log(`    ${DIM}${YELLOW}Status: ${mode.status}${RESET}`);
        }
    }
    console.log('');
    console.log(RED + BRIGHT + '❌ [0] EXIT' + RESET);
    console.log('');
    console.log('═'.repeat(80));
    console.log('');
}

function displayModeDetails(modeNum) {
    const mode = MODES[modeNum];
    if (!mode) return;

    console.log('');
    console.log('═'.repeat(80));
    console.log(mode.color + BRIGHT + `${mode.icon} MODE ${modeNum}: ${mode.name.toUpperCase()}` + RESET);
    console.log('═'.repeat(80));
    console.log('');
    
    console.log(BRIGHT + '📋 Description:' + RESET);
    console.log(`   ${mode.description}`);
    console.log('');
    
    console.log(BRIGHT + '✨ Features:' + RESET);
    mode.features.forEach((feature) => {
        const indent = feature.startsWith('  ') ? '     ' : '   ';
        const bullet = feature.includes('✅') || feature.includes('🔥') ? '' : `${GREEN}•${RESET} `;
        console.log(`${indent}${bullet}${feature}`);
    });
    console.log('');
    
    console.log(BRIGHT + '📦 Requirements:' + RESET);
    mode.requirements.forEach((req, idx) => {
        console.log(`   ${CYAN}${idx + 1}.${RESET} ${req}`);
    });
    console.log('');
    
    console.log(BRIGHT + '📤 Output:' + RESET);
    console.log(`   ${mode.outputType}`);
    console.log('');
    
    if (mode.status) {
        console.log(BRIGHT + '🏷️  Status:' + RESET);
        const statusColor = mode.status.includes('✅') ? GREEN :
                           mode.status.includes('LEGACY') ? YELLOW : WHITE;
        console.log(`   ${statusColor}${mode.status}${RESET}`);
        console.log('');
    }
    
    console.log('═'.repeat(80));
    console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREREQUISITE VALIDATION (CLASH META v71.1.0)
// ═══════════════════════════════════════════════════════════════════════════════
function validatePrerequisites() {
    const errors = [];
    const warnings = [];

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. QTE_ID VALIDATION (REQUIRED)
    // ═══════════════════════════════════════════════════════════════════════════
    const qteId = process.env.QTE_ID;
    if (!qteId || qteId.trim() === '') {
        errors.push('QTE_ID is NOT configured in .env file');
        errors.push('  Example: QTE_ID=QTE-DESKTOP-01');
        errors.push('  Purpose: Used for Clash config naming ({QTE_ID}_clash.yaml)');
        errors.push('  Action: Add QTE_ID to .env and restart');
    } else if (!/^[a-zA-Z0-9\-_]+$/.test(qteId)) {
        errors.push('QTE_ID contains INVALID characters');
        errors.push('  Current: ' + qteId);
        errors.push('  Allowed: Alphanumeric, hyphens, underscores only');
        errors.push('  Example: QTE-DESKTOP-01, QTE_LAB_PC2');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. CLASH META BINARY CHECK
    // ═══════════════════════════════════════════════════════════════════════════
    if (!fs.existsSync(CLASH_BINARY_PATH)) {
        errors.push('Clash Meta binary NOT FOUND');
        errors.push('  Expected path: ' + CLASH_BINARY_PATH);
        errors.push('  Download: https://github.com/MetaCubeX/mihomo/releases');
        errors.push('  File: mihomo-windows-amd64-compatible.exe');
        errors.push('  Action: Rename to clash.exe and place in ./Clash/');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. CLASH BASE CONFIG (config_clash.json) VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════
    if (!fs.existsSync(CLASH_CONFIG_BASE)) {
        errors.push('Clash base config NOT FOUND');
        errors.push('  Expected path: ' + CLASH_CONFIG_BASE);
        errors.push('  Purpose: DNS resolver + bypass domains configuration');
        errors.push('  Action: Create config_clash.json with DNS and bypass settings');
    } else {
        try {
            const configData = JSON.parse(fs.readFileSync(CLASH_CONFIG_BASE, 'utf8'));
            
            // Validate DNS section
            if (!configData.dns || !configData.dns.localResolver) {
                warnings.push('config_clash.json: Missing dns.localResolver');
                warnings.push('  DNS interception may not work correctly');
                warnings.push('  Expected: "dns": { "localResolver": "172.16.100.1" }');
            }
            
            // Validate bypass section
            if (!configData.bypass || !Array.isArray(configData.bypass.domains)) {
                warnings.push('config_clash.json: Missing bypass.domains array');
                warnings.push('  All domains will be proxied (no bypass)');
                warnings.push('  Expected: "bypass": { "domains": ["*.example.com"] }');
            }
            
        } catch (jsonErr) {
            errors.push('config_clash.json: INVALID JSON format');
            errors.push('  Error: ' + jsonErr.message);
            errors.push('  Action: Fix JSON syntax errors');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. ADMINISTRATOR PRIVILEGES CHECK (TUN MODE REQUIREMENT)
    // ═══════════════════════════════════════════════════════════════════════════
    if (!isAdmin()) {
        warnings.push('NOT running as Administrator');
        warnings.push('  Clash Meta TUN mode REQUIRES Administrator privileges');
        warnings.push('  Impact: Browser traffic routing will FAIL without admin');
        warnings.push('  Action: Close this window, Right-click PowerShell → Run as Administrator');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. MONGODB CONNECTION STRING
    // ═══════════════════════════════════════════════════════════════════════════
    const mongoUri = process.env.MONGO_URI ||
                     process.env.DB_CONNECTION_STRING ||
                     process.env.MONGODB_URL;

    if (!mongoUri) {
        errors.push('MongoDB connection string NOT configured in .env');
        errors.push('  Expected one of: MONGO_URI, DB_CONNECTION_STRING, or MONGODB_URL');
        errors.push('  Example: MONGODB_URL=mongodb://user:pass@host:27017/database');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. CLASH CONFIG DIRECTORY
    // ═══════════════════════════════════════════════════════════════════════════
    if (!fs.existsSync(CLASH_CONFIG_DIR)) {
        try {
            fs.mkdirSync(CLASH_CONFIG_DIR, { recursive: true });
            console.log(`[engine.js v71.1.0] ✅ Created Clash config directory: ${CLASH_CONFIG_DIR}`);
        } catch (mkdirErr) {
            errors.push('Cannot create Clash config directory');
            errors.push('  Path: ' + CLASH_CONFIG_DIR);
            errors.push('  Error: ' + mkdirErr.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. CLASH LOG DIRECTORY
    // ═══════════════════════════════════════════════════════════════════════════
    if (!fs.existsSync(CLASH_LOG_DIR)) {
        try {
            fs.mkdirSync(CLASH_LOG_DIR, { recursive: true });
            console.log(`[engine.js v71.1.0] ✅ Created Clash log directory: ${CLASH_LOG_DIR}`);
        } catch (mkdirErr) {
            warnings.push('Cannot create Clash log directory: ' + mkdirErr.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. SLOT CONFIGURATION VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════
    const othersReserved = parseInt(process.env.OTHERS_RESERVED || '1000', 10);
    const msedgeReserved = parseInt(process.env.MSEDGE_RESERVED || '200', 10);
    
    if (isNaN(othersReserved) || othersReserved < 1 || othersReserved > 10000) {
        warnings.push('OTHERS_RESERVED out of range (expected 1-10000)');
        warnings.push('  Current: ' + process.env.OTHERS_RESERVED);
        warnings.push('  Using default: 1000');
    }
    
    if (isNaN(msedgeReserved) || msedgeReserved < 0 || msedgeReserved > 10000) {
        warnings.push('MSEDGE_RESERVED out of range (expected 0-10000)');
        warnings.push('  Current: ' + process.env.MSEDGE_RESERVED);
        warnings.push('  Using default: 200');
    }

    return {
        valid: errors.length === 0,
        errors: errors,
        warnings: warnings
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE EXECUTOR (UNCHANGED - opsi4.js handles ProxyPoolManager integration)
// ═══════════════════════════════════════════════════════════════════════════════
async function executeMode(modeNum) {
    const mode = MODES[modeNum];
    if (!mode) {
        console.error(RED + '❌ Invalid mode number' + RESET);
        return false;
    }

    const handlerPath = path.join(__dirname, mode.handler);
    if (!fs.existsSync(handlerPath)) {
        console.error('');
        console.error(RED + '═'.repeat(80) + RESET);
        console.error(RED + BRIGHT + '❌ MODE HANDLER NOT FOUND' + RESET);
        console.error(RED + '═'.repeat(80) + RESET);
        console.error('');
        console.error(`Expected: ${mode.handler}`);
        console.error(`Full path: ${handlerPath}`);
        console.error('');
        console.error('Please ensure the file exists in the project directory.');
        console.error('');
        console.error(RED + '═'.repeat(80) + RESET);
        console.error('');
        return false;
    }

    displayModeDetails(modeNum);

    try {
        console.log(mode.color + BRIGHT + `🚀 Launching ${mode.name}...` + RESET);
        console.log('');

        // Show loading animation
        process.stdout.write(DIM + '   Initializing' + RESET);
        for (let i = 0; i < 3; i++) {
            await sleep(300);
            process.stdout.write(DIM + '.' + RESET);
        }
        console.log('');
        console.log('');

        // Clear require cache to allow fresh execution
        delete require.cache[require.resolve(handlerPath)];

        // ═══════════════════════════════════════════════════════════════
        // Execute mode handler
        // For Mode 4: opsi4.js will handle:
        //   1. ProxyQualityManager.init()
        //   2. ClashManager.init()
        //   3. ProxyPoolManager creation
        //   4. ProxyAPIServer.init(proxyPoolManager) ← INJECTION!
        // ═══════════════════════════════════════════════════════════════
        const modeHandler = require(handlerPath);
        if (typeof modeHandler === 'function') {
            await modeHandler();
        } else {
            console.error('');
            console.error(RED + '═'.repeat(80) + RESET);
            console.error(RED + BRIGHT + '❌ INVALID MODE HANDLER' + RESET);
            console.error(RED + '═'.repeat(80) + RESET);
            console.error('');
            console.error(`File: ${mode.handler}`);
            console.error(`Error: Handler does not export a function`);
            console.error('');
            console.error('Expected: module.exports = async function main() { ... }');
            console.error('');
            console.error(RED + '═'.repeat(80) + RESET);
            console.error('');
            return false;
        }

        return true;
    } catch (error) {
        console.error('');
        console.error(RED + '═'.repeat(80) + RESET);
        console.error(RED + BRIGHT + '❌ MODE EXECUTION FAILED' + RESET);
        console.error(RED + '═'.repeat(80) + RESET);
        console.error('');
        console.error(`${BRIGHT}Mode:${RESET} ${mode.name}`);
        console.error(`${BRIGHT}Handler:${RESET} ${mode.handler}`);
        console.error(`${BRIGHT}Error:${RESET} ${error.message}`);
        console.error('');
        if (error.stack) {
            console.error(DIM + 'Stack trace:' + RESET);
            console.error(DIM + error.stack + RESET);
            console.error('');
        }
        console.error(RED + '═'.repeat(80) + RESET);
        console.error('');
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════
async function mainLoop() {
    let running = true;

    while (running) {
        displayBanner();
        displaySystemInfo();
        displayMainMenu();

        const choice = await askQuestion(BRIGHT + 'Enter mode number [0-4]: ' + RESET);
        const modeNum = parseInt(choice.trim(), 10);

        if (modeNum === 0) {
            console.log('');
            console.log(YELLOW + '👋 Exiting Quantum Traffic Engine...' + RESET);
            console.log('');
            console.log(DIM + 'Thank you for using QTE v71!' + RESET);
            console.log('');
            running = false;
            break;
        }

        if (isNaN(modeNum) || modeNum < 0 || modeNum > 4) {
            console.log('');
            console.log(RED + '❌ Invalid choice. Please enter a number between 0-4.' + RESET);
            console.log('');
            await askQuestion(DIM + 'Press Enter to continue...' + RESET);
            continue;
        }

        // Execute selected mode
        const success = await executeMode(modeNum);

        // After mode execution
        console.log('');
        console.log('═'.repeat(80));
        if (success) {
            console.log(GREEN + BRIGHT + '✅ Mode execution completed' + RESET);
        } else {
            console.log(RED + BRIGHT + '❌ Mode execution failed' + RESET);
        }
        console.log('═'.repeat(80));
        console.log('');

        const continueChoice = await askQuestion(BRIGHT + 'Return to main menu? (Y/n): ' + RESET);
        if (continueChoice.trim().toLowerCase() === 'n' || continueChoice.trim().toLowerCase() === 'no') {
            console.log('');
            console.log(YELLOW + '👋 Exiting Quantum Traffic Engine...' + RESET);
            console.log('');
            running = false;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
    // Graceful shutdown handler
    const shutdownHandler = () => {
        console.log('');
        console.log('');
        console.log(YELLOW + '🛑 Shutdown signal received' + RESET);
        console.log(YELLOW + '👋 Goodbye!' + RESET);
        console.log('');
        process.exit(0);
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

    try {
        // Initial banner
        displayBanner();
        console.log(BRIGHT + '🔍 Checking prerequisites...' + RESET);
        console.log('');

        // Validate prerequisites
        const validation = validatePrerequisites();

        // Show warnings if any
        if (validation.warnings.length > 0) {
            console.log(YELLOW + '⚠️  WARNINGS:' + RESET);
            console.log('');
            validation.warnings.forEach((warn) => {
                console.log(`   ${YELLOW}•${RESET} ${warn}`);
            });
            console.log('');
        }

        // Check for errors
        if (!validation.valid) {
            console.error(RED + '═'.repeat(80) + RESET);
            console.error(RED + BRIGHT + '❌ PREREQUISITE CHECK FAILED' + RESET);
            console.error(RED + '═'.repeat(80) + RESET);
            console.error('');
            console.error('The following issues were found:');
            console.error('');
            validation.errors.forEach((err) => {
                console.error(`   ${RED}•${RESET} ${err}`);
            });
            console.error('');
            console.error('Please fix these issues and try again.');
            console.error('');
            console.error(DIM + 'Quick fixes:' + RESET);
            console.error(DIM + '  1. Add QTE_ID to .env file (e.g., QTE_ID=QTE-DESKTOP-01)' + RESET);
            console.error(DIM + '  2. Download Clash Meta binary from https://github.com/MetaCubeX/mihomo/releases' + RESET);
            console.error(DIM + '  3. Create config_clash.json with DNS and bypass settings' + RESET);
            console.error(DIM + '  4. Ensure MongoDB is running and connection string is set' + RESET);
            console.error(DIM + '  5. Run PowerShell as Administrator (required for TUN mode)' + RESET);
            console.error('');
            console.error(RED + '═'.repeat(80) + RESET);
            console.error('');
            process.exit(1);
        }

        console.log(GREEN + '✅ All prerequisites met' + RESET);
        console.log('');

        // Show loading
        process.stdout.write(DIM + 'Starting QTE v71' + RESET);
        for (let i = 0; i < 3; i++) {
            await sleep(200);
            process.stdout.write(DIM + '.' + RESET);
        }
        console.log('');
        console.log('');

        await sleep(500);

        // Start main loop
        await mainLoop();

    } catch (error) {
        console.error('');
        console.error(RED + '═'.repeat(80) + RESET);
        console.error(RED + BRIGHT + '❌ FATAL ERROR' + RESET);
        console.error(RED + '═'.repeat(80) + RESET);
        console.error('');
        console.error(`${BRIGHT}Error:${RESET} ${error.message}`);
        console.error('');
        if (error.stack) {
            console.error(DIM + 'Stack trace:' + RESET);
            console.error(DIM + error.stack + RESET);
            console.error('');
        }
        console.error(RED + '═'.repeat(80) + RESET);
        console.error('');
        process.exit(1);
    }

    process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTE
// ═══════════════════════════════════════════════════════════════════════════════
if (require.main === module) {
    main().catch((error) => {
        console.error('');
        console.error(RED + 'Unhandled error:' + RESET, error);
        console.error('');
        process.exit(1);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
    main,
    executeMode,
    MODES,
    VERSION,
    CODENAME
};

// ═══════════════════════════════════════════════════════════════════════════════
// END OF engine.js v71.1.0 - ProxyPoolManager Integration Ready
// ═══════════════════════════════════════════════════════════════════════════════
//
// INTEGRATION FLOW SUMMARY (opsi4.js v16.2.0):
// ──────────────────────────────────────────────────────────────────────────────
// 1. engine.js → User selects Mode 4
// 2. engine.js → require('./opsi4.js') → Execute opsi4 main()
// 3. opsi4.js → Initialize components:
//    a. ProxyQualityManager.init()
//    b. ClashManager.init() (start Clash Meta)
//    c. ProxyPoolManager = new ProxyPoolManager(...)
//    d. ProxyAPIServer.init(proxyPoolManager) ← INJECTION POINT!
// 4. ProxyAPIServer → Register endpoints:
//    • GET /clash/provider/slot/:slotId
//      → proxyPoolManager.getSlotProxy(slotId)
//      → Return YAML with actual proxy from slotAssignments
// 5. Workers start → Proxy assignment:
//    • proxyPoolManager.assignProxy(slotIndex, workerId)
//    • Update slotAssignments[slotIndex] = { proxy, workerId }
//    • reloadProvider(slotIndex)
//      → PUT /providers/proxies/PROV_###
//      → Clash fetches from ProxyAPIServer
//      → Gets actual proxy credentials
// 6. Task complete → Proxy rotation:
//    • proxyPoolManager.rotateProxy(slotIndex, workerId)
//    • Release old (60s cooldown)
//    • Assign new
//    • Reload provider
//    • Next request uses NEW proxy (NO RESTART!)
//
// NEXT FILE: opsi4.js v16.2.0 (ProxyPoolManager + ProxyAPIServer integration)
// ═══════════════════════════════════════════════════════════════════════════════
