/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * utils.js v2.3.1 - Core Utilities & Cleanup Management
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 🔥 CHANGELOG v2.3.1 (2026-02-14 20:00 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ RESTORED: csv-parse/sync for robust CSV reading (Supports Quoted Strings)
 * - Replaces manual split(',') which broke on UserAgents with commas.
 * ✅ ADDED: killWorkerProcesses(slotIndex)
 * - Targeted cleanup for workerXXX.exe & ip_workerXXX.exe using taskkill.
 * ✅ ADDED: runSystemCommand(command)
 * - Safe wrapper for execSync interactions.
 * ✅ PRESERVED: Chaos Math & Slot Formatting logic from v2.2.0.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CHAOS MATH UTILITIES (ENTROPY GENERATION)
// ═══════════════════════════════════════════════════════════════════════════════

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function paretoRandom(min, max, alpha = 2.0) {
    const u = Math.random();
    const x = min / Math.pow(u, 1 / alpha);
    return Math.min(x, max);
}

function gaussianRandom(mean, stdDev) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
}

function randomChoice(array) {
    if (!array || !Array.isArray(array) || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FLOW CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sleep utility for Promise-based delay
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. WORKER SLOT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format slot index into 3 or 4 digit string
 * @param {number} slotIndex - The index of the slot
 * @returns {string} - Formatted ID (e.g., 001, 1001)
 */
function formatSlotId(slotIndex) {
    if (slotIndex <= 999) {
        return String(slotIndex).padStart(3, '0');
    } else if (slotIndex <= 9999) {
        return String(slotIndex).padStart(4, '0');
    } else {
        return String(slotIndex); // Fallback for huge numbers
    }
}

/**
 * Pattern to match worker executable names
 */
const WORKER_PATTERN = /^worker(\d{3,4})\.exe$/i;

/**
 * Extract slot index from a filename
 * @param {string} filename 
 * @returns {number|null}
 */
function extractSlotIndex(filename) {
    const match = filename.match(WORKER_PATTERN);
    return match ? parseInt(match[1], 10) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. SYSTEM & PROCESS CONTROL (CLEANUP OPS)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execute a system shell command synchronously
 * @param {string} command - The command to run
 * @returns {string|null} - Command output or null if failed
 */
function runSystemCommand(command) {
    try {
        return execSync(command, { stdio: 'pipe' }).toString();
    } catch (e) {
        // Command failure is often expected (e.g., process not found)
        return null;
    }
}

/**
 * Kill a Windows process by its executable name
 * @param {string} processName - Name like "worker001.exe"
 */
function killProcessByName(processName) {
    if (os.platform() !== 'win32') return;
    // /F = Force, /IM = Image Name, /T = Tree (kill child processes)
    runSystemCommand(`taskkill /F /IM "${processName}" /T`);
}

/**
 * Specifically kill processes related to a worker slot (Targeted Cleanup)
 * @param {number} slotIndex - The slot index to clean
 */
function killWorkerProcesses(slotIndex) {
    const slotId = formatSlotId(slotIndex);
    const workerExe = `worker${slotId}.exe`;
    const validatorExe = `ip_worker${slotId}.exe`;

    // Kill primary browser worker hardlink
    killProcessByName(workerExe);
    
    // Kill C++ validator hardlink
    killProcessByName(validatorExe);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. HASH & LOGGING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function generateStableHash(inputString, length = 32) {
    return crypto.createHash('sha256').update(inputString).digest('hex').substring(0, length);
}

function selectProbabilistically(options) {
    if (!options || options.length === 0) return null;
    
    // Calculate total weight
    let totalShare = options.reduce((sum, opt) => sum + (opt.market_share || 0), 0);
    
    // If no weights, use random
    if (totalShare === 0) return randomChoice(options);

    let r = Math.random() * totalShare;
    let cumulativeShare = 0;

    for (const option of options) {
        cumulativeShare += (option.market_share || 0);
        if (r <= cumulativeShare) {
            return option;
        }
    }
    return options[options.length - 1];
}

let LOG_FILE_PATH = null;

function setupLogging() {
    const d = new Date();
    const ts = `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours()}${d.getMinutes()}`;
    const logDir = path.join(__dirname, 'logs');

    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    LOG_FILE_PATH = path.join(logDir, `engine_log_${ts}.txt`);

    const origLog = console.log;
    const origErr = console.error;

    function write(level, msg) {
        try { fs.appendFileSync(LOG_FILE_PATH, `[${new Date().toISOString()}] [${level}] ${msg}\n`); } catch(e){}
    }

    console.log = (m, ...a) => { write('INFO', m); origLog(m, ...a); };
    console.error = (m, ...a) => { write('ERROR', m); origErr(m, ...a); };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DATA UTILITIES (CSV)
// ═══════════════════════════════════════════════════════════════════════════════

function readCSV(filename) {
    const fp = path.join(__dirname, filename);
    if (!fs.existsSync(fp)) throw new Error(`File not found: ${filename}`);

    const content = fs.readFileSync(fp, 'utf-8');
    const firstLine = content.split('\n')[0];

    let delimiter = ',';
    if (firstLine && firstLine.includes(';')) delimiter = ';';

    // Using csv-parse/sync for reliable parsing of quoted strings (UserAgents etc)
    return parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        delimiter: delimiter
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Chaos Math
    getRandomInt,
    paretoRandom,
    gaussianRandom,
    randomChoice,
    
    // Flow Control
    sleep,
    
    // Slot & Worker
    formatSlotId,
    WORKER_PATTERN,
    extractSlotIndex,
    
    // Cleanup & System
    runSystemCommand,
    killProcessByName,
    killWorkerProcesses,
    
    // Hashing & Logic
    generateStableHash,
    selectProbabilistically,
    
    // Logging & Data
    setupLogging,
    readCSV,
    os
};