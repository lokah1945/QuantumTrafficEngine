/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * clash_manager.js v4.0.0 - STANDARDIZED SINGLETON ARCHITECTURE (FULL)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 🔥 CHANGELOG v4.0.0 (2026-02-15 05:45 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ REFACTOR: Converted to Singleton Pattern
 * - Export is now an INSTANCE (new ClashManager())
 * - Auto-loads configuration from process.env / config.js
 * ✅ ADDED: initialize() method
 * - Standardizes interface with other Managers (DeviceManager, ProxyPoolManager)
 * - Safe to call multiple times (idempotent)
 * ✅ KEPT: All v3.9.2 features (Smart Logging, Provider Testing, API)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const { spawn, execSync } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const TestLogger = require('./logger');

class ClashManager {
  constructor() {
    // SINGLETON STATE INITIALIZATION
    this.initialized = false;
    this.qteId = null;
    this.maxWorkers = null;
    
    // ENV-DRIVEN SLOT CALCULATION
    this.othersReserved = 1000;
    this.msedgeReserved = 200;
    this.totalSlots = 1200;

    this.clashProcess = null;
    this.isRunning = false;

    // PATHS (Dynamic setup in initialize)
    this.clashDir = path.join(__dirname, 'Clash');
    this.clashBinary = path.join(this.clashDir, 'clash.exe');
    this.configDir = path.join(this.clashDir, 'config');
    this.logDir = path.join(process.cwd(), 'logs', 'clash');
    this.configPath = null;
    this.logPath = null;

    // API CONFIGURATION
    this.apiBase = 'http://127.0.0.1:9090';
    this.apiClient = axios.create({
      baseURL: this.apiBase,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: (status) => status >= 200 && status < 500
    });

    // STATE TRACKING
    this.startTime = null;
    this.lastHealthCheck = null;
    this.proxySwapCount = 0;
    this.tunInterfaceName = null;
    this.tunInterfaceIndex = null;
    this.routeInjected = false;

    // LOGGING CONTROL
    this.clashLogLevel = 3;
    this.providerInitCount = 0;
    this.providerTotalCount = 0;
    this.lastProviderSummary = Date.now();
    this.summaryInterval = 2000;
    this.debugMode = false;
    this.logger = null;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v4.0.0: STANDARD INITIALIZE METHOD
   * ═══════════════════════════════════════════════════════════════
   */
  async initialize() {
    if (this.initialized) {
        console.log('[Clash Manager] Already initialized');
        return;
    }

    // 1. Load Environment & Config
    require('dotenv').config();
    let config = {};
    try {
        config = require('./config');
    } catch (e) {
        // Fallback if config.js not found/needed
    }

    // 2. Set Config Values
    this.qteId = process.env.QTE_ID || config.QTE_ID;
    this.maxWorkers = parseInt(process.env.MAX_WORKERS || config.MAX_WORKERS || '1200', 10);

    // Validate QTE_ID
    if (!this.qteId || typeof this.qteId !== 'string' || this.qteId.trim() === '') {
        throw new Error('FATAL: QTE_ID is missing from .env or config.js');
    }

    // 3. Set Derived Paths
    this.configPath = path.join(this.configDir, `${this.qteId}_clash.yaml`);

    // 4. Set Slot Ranges
    this.othersReserved = parseInt(process.env.OTHERS_RESERVED || '1000', 10);
    this.msedgeReserved = parseInt(process.env.MSEDGE_RESERVED || '200', 10);
    
    this.othersStart = 1;
    this.othersEnd = this.othersReserved;
    this.msedgeStart = this.othersEnd + 1;
    this.msedgeEnd = this.othersEnd + this.msedgeReserved;
    this.totalSlots = this.msedgeEnd;
    
    this.providerTotalCount = this.totalSlots;

    // 5. Setup Logging
    this.clashLogLevel = parseInt(process.env.CLASH_LOG || '3', 10);
    if (this.clashLogLevel < 0 || this.clashLogLevel > 3) this.clashLogLevel = 3;

    this.debugMode = process.env.DEBUG_MODE === 'true';

    if (this.debugMode) {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      
      this.logger = new TestLogger(`clash_${this.qteId}`);
      this.logger.info('═'.repeat(70));
      this.logger.info('CLASH MANAGER v4.0.0 - STANDARDIZED SINGLETON');
      this.logger.info('═'.repeat(70));
      this.logger.info(`QTE ID: ${this.qteId}`);
      this.logger.info(`Max Workers (legacy): ${this.maxWorkers}`);
      this.logger.info(`Total Slots (env): ${this.totalSlots}`);
      this.logger.info(`API Base: ${this.apiBase}`);
      this.logger.info(`Log Dir: ${this.logDir}`);
      this.logger.info('═'.repeat(70));
    }

    console.log('[Clash Manager] v4.0.0 initialized (SINGLETON)');
    console.log(`[Clash Manager] QTE ID: ${this.qteId} | API: ${this.apiBase}`);
    console.log(`[Clash Manager] Total Slots: ${this.totalSlots}`);
    
    this.initialized = true;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.2: GET LOG LEVEL NAME
   * ═══════════════════════════════════════════════════════════════
   */
  getLogLevelName() {
    const names = {
      0: 'NO LOG',
      1: 'TERMINAL ONLY',
      2: 'TERMINAL + FILE',
      3: 'FILE ONLY'
    };
    return names[this.clashLogLevel] || 'UNKNOWN';
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.2: GET EFFECTIVE BEHAVIOR
   * ═══════════════════════════════════════════════════════════════
   */
  getEffectiveBehavior() {
    if (!this.debugMode) {
      return 'Production (terminal silent, file-only)';
    }
    
    switch (this.clashLogLevel) {
      case 0: return 'Development (silent, no logs)';
      case 1: return 'Development (terminal only, no file)';
      case 2: return 'Development (filtered terminal + file)';
      case 3: return 'Development (clean terminal, file-only)';
      default: return 'Development (unknown mode)';
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * ✅ v3.3.0: SMART SLOT ID FORMATTING
   * ═══════════════════════════════════════════════════════════════
   */
  formatSlotId(slotIndex) {
    if (slotIndex <= 999) {
      return String(slotIndex).padStart(3, '0');
    } else {
      return String(slotIndex).padStart(4, '0');
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * Helper method for conditional logging
   * ═══════════════════════════════════════════════════════════════
   */
  _log(level, message) {
    if (!this.debugMode || !this.logger) return;

    switch (level) {
      case 'info':
        this.logger.info(message);
        break;
      case 'success':
        this.logger.success(message);
        break;
      case 'error':
        this.logger.error(message);
        break;
      case 'warn':
        this.logger.warn(message);
        break;
      case 'debug':
        this.logger.debug(message);
        break;
      case 'section':
        this.logger.section(message);
        break;
      case 'write':
        this.logger.write(message);
        break;
      default:
        this.logger.write(message);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * Sleep helper
   * ═══════════════════════════════════════════════════════════════
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.2: SHOULD DISPLAY LINE (SMART FILTERING)
   * ═══════════════════════════════════════════════════════════════
   */
  shouldDisplayLine(line) {
    if (!line || typeof line !== 'string') return false;
    
    const trimmed = line.trim();
    if (!trimmed) return false;
    
    // Always suppress patterns (high noise)
    const suppressPatterns = [
      /Start initial provider ProxyPool/,     // Provider init (1200 lines!)
      /Start initial compatible provider SLOT/, // Selector init (1200 lines!)
      /health check succeed/,                 // Health checks
      /health check failed/,                  // Health checks
    ];
    
    for (const pattern of suppressPatterns) {
      if (pattern.test(trimmed)) return false;
    }
    
    // Always show patterns (critical info)
    const alwaysShowPatterns = [
      /level=error/,                          // Errors
      /level=warning/,                        // Warnings
      /Initial configuration complete/,       // Milestone
      /RESTful API listening/,                // API ready
      /TUN adapter listening/,                // TUN ready
      /SOCKS proxy listening/,                // SOCKS ready
      /HTTP proxy listening/,                 // HTTP ready
      /Mixed.*proxy listening/,               // Mixed ready
    ];
    
    for (const pattern of alwaysShowPatterns) {
      if (pattern.test(trimmed)) return true;
    }
    
    // Default: show (for other messages)
    return true;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.2: INCREMENT PROVIDER COUNT (SUMMARY TRACKING)
   * ═══════════════════════════════════════════════════════════════
   */
  incrementProviderCount() {
    this.providerInitCount++;
    
    const now = Date.now();
    const timeSinceLastSummary = now - this.lastProviderSummary;
    
    // Print summary every 100 providers OR every 2 seconds
    if (this.providerInitCount % 100 === 0 || timeSinceLastSummary >= this.summaryInterval) {
      const progress = Math.round((this.providerInitCount / this.providerTotalCount) * 100);
      console.log(`[Clash] Initializing providers... ${this.providerInitCount}/${this.providerTotalCount} (${progress}%)`);
      this.lastProviderSummary = now;
    }
    
    // Final message when complete
    if (this.providerInitCount === this.providerTotalCount) {
      console.log(`[Clash] ✅ All ${this.providerTotalCount} providers initialized`);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.0: START CLASH (WITH PROVIDER TEST!)
   * ═══════════════════════════════════════════════════════════════
   */
  async start() {
    // 🔥 Ensure initialized
    if (!this.initialized) await this.initialize();

    if (this.isRunning) {
      console.log('[Clash Manager] ⚠️  Already running');
      this._log('warn', 'Start called but already running');
      return;
    }

    console.log('[Clash Manager] Starting Clash Meta...');
    this._log('section', 'Clash Manager Startup Sequence (v4.0.0 - Singleton)');

    try {
      this._log('info', 'Step 1/11: Verifying admin privileges...');
      this.verifyAdminPrivileges();

      this._log('info', 'Step 2/11: Ensuring directory structure...');
      this.ensureDirectories();

      this._log('info', 'Step 3/11: Verifying Clash binary...');
      this.verifyBinary();

      this._log('info', 'Step 4/11: 🔥 Deleting old config (Force Regeneration)...');
      if (fs.existsSync(this.configPath)) {
        this._log('debug', `Found existing config: ${path.basename(this.configPath)}`);
        try {
          fs.unlinkSync(this.configPath);
          console.log(`[Clash Manager] 🗑️  Deleted old config: ${path.basename(this.configPath)}`);
          this._log('success', 'Old config deleted');
        } catch (err) {
          this._log('error', `Failed to delete old config: ${err.message}`);
          throw new Error(`Cannot delete old config: ${this.configPath}\nReason: ${err.message}`);
        }
      } else {
        this._log('debug', 'No existing config found (first run or already deleted)');
      }

      this._log('info', 'Step 5/11: 🔥 Generating new Clash config v10.1.0 (with use + dummy)...');
      await this.generateNewConfig();

      this._log('info', 'Step 6/11: Verifying generated config...');
      this.verifyConfig();

      this._log('info', 'Step 7/11: Preparing log file...');
      this.prepareLogFile();

      this._log('info', 'Step 8/11: Spawning Clash process...');
      this.spawnClashProcess();

      this._log('info', 'Step 9/11: Waiting for TUN interface...');
      await this.waitForTUNInterface(30);

      this._log('info', 'Step 10/11: Injecting fake-IP route...');
      await this.injectFakeIPRoute();

      this._log('info', 'Step 11/11: Waiting for API ready...');
      await this.waitForAPI(30);

      // ─────────────────────────────────────────────────────────────
      // 🔥 v3.9.0: PROVIDER TEST MECHANISM
      // ─────────────────────────────────────────────────────────────
      console.log('');
      console.log('[Clash Manager] ✅ Clash Meta started successfully!');
      console.log('');
      console.log('[Clash Manager] 🧪 Running provider mechanism test...');
      console.log('[Clash Manager] ⏳ Testing SLOT001 to verify system works...');
      console.log('');

      const testResult = await this.testProviderMechanism();

      if (testResult.success) {
        console.log('');
        console.log('[Clash Manager] ✅ PROVIDER TEST SUCCESS!');
        console.log('[Clash Manager] ✅ System verified! Safe to serve 1200 workers.');
        console.log('');
        this._log('success', 'Provider test SUCCESS');
      } else {
        console.error('');
        console.error('[Clash Manager] ❌ PROVIDER TEST FAILED!');
        console.error(`[Clash Manager] ❌ Error: ${testResult.error}`);
        console.error('[Clash Manager] ❌ Cannot serve workers safely!');
        console.error('');
        this._log('error', `Provider test FAILED: ${testResult.error}`);
        
        throw new Error(
          `[Clash Manager] FATAL: Provider test failed!\n` +
          `\n` +
          `Test Slot: SLOT001\n` +
          `Error: ${testResult.error}\n` +
          `\n` +
          `POSSIBLE CAUSES:\n` +
          `  1. ProxyAPIServer not running or not responding\n` +
          `  2. Provider endpoint returns invalid data\n` +
          `  3. Selector group not configured with 'use' keyword\n` +
          `  4. Clash API not responding to proxy switch requests\n` +
          `\n` +
          `ACTION:\n` +
          `  1. Verify ProxyAPIServer is running on port 3000\n` +
          `  2. Check ClashStaticGenerator v10.1.0 is deployed\n` +
          `  3. Verify config has 'use: [ProxyPool001]' in SLOT001\n` +
          `  4. Check Clash logs for errors\n` +
          `\n`
        );
      }

      this.isRunning = true;
      this.startTime = Date.now();

      console.log('[Clash Manager] ✅ STARTUP COMPLETE!');
      console.log(`[Clash Manager] HTTP: 127.0.0.1:7890 | SOCKS5: 127.0.0.1:7891 | API: ${this.apiBase}`);
      console.log(`[Clash Manager] Provider Test: SLOT${this.formatSlotId(testResult.testSlot)} PASSED`);
      console.log(`[Clash Manager] Ready to serve: ${this.totalSlots} slots (on-demand loading)`);
      if (this.logPath) {
        console.log(`[Clash Manager] Clash Logs: ${path.basename(this.logPath)}`);
      }
      console.log('');
      
      this._log('success', 'Clash Meta startup complete');
      this._log('info', `HTTP Proxy: 127.0.0.1:7890`);
      this._log('info', `SOCKS5 Proxy: 127.0.0.1:7891`);
      this._log('info', `API: ${this.apiBase}`);
      this._log('info', `Provider Test: SLOT${this.formatSlotId(testResult.testSlot)} PASSED`);
      this._log('info', `Ready to serve: ${this.totalSlots} slots`);
      this._log('info', '');

      return { pid: this.clashProcess.pid, testResult };

    } catch (error) {
      console.error('[Clash Manager] ❌ Startup failed:');
      console.error(error.message);
      
      this._log('error', '');
      this._log('error', '═'.repeat(70));
      this._log('error', 'CLASH MANAGER STARTUP FAILED');
      this._log('error', '═'.repeat(70));
      this._log('error', error.message);
      this._log('error', '');
      
      if (error.stack) {
        this._log('error', 'Stack trace:');
        this._log('write', error.stack);
      }
      
      this._log('error', '═'.repeat(70));
      
      await this.stop();
      throw error;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.9.0: TEST PROVIDER MECHANISM (SMOKE TEST)
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async testProviderMechanism() {
    const TEST_SLOT = 1;
    const slotPadded = this.formatSlotId(TEST_SLOT);
    const providerName = `ProxyPool${slotPadded}`;
    const selectorName = `SLOT${slotPadded}`;
    const dummyName = `dummy-${slotPadded}`;
    
    console.log('[Clash Manager] ═══════════════════════════════════════════');
    console.log('[Clash Manager] 🧪 PROVIDER MECHANISM TEST');
    console.log('[Clash Manager] ═══════════════════════════════════════════');
    console.log(`[Clash Manager] Test Slot: ${TEST_SLOT}`);
    console.log(`[Clash Manager] Provider: ${providerName}`);
    console.log(`[Clash Manager] Selector: ${selectorName}`);
    console.log(`[Clash Manager] Dummy: ${dummyName}`);
    console.log('[Clash Manager] ═══════════════════════════════════════════');
    
    this._log('section', 'Provider Mechanism Test');
    this._log('info', `Test Slot: ${TEST_SLOT}`);
    this._log('info', `Provider: ${providerName}`);
    this._log('info', `Selector: ${selectorName}`);
    this._log('info', '');
    
    try {
      // Step 1: Fetch provider
      console.log(`[Clash Manager] Step 1/5: Fetching provider ${providerName}...`);
      this._log('info', `Step 1/5: Fetching provider ${providerName}...`);
      
      const fetchResult = await this.fetchProviderOnce(TEST_SLOT);
      
      console.log(`[Clash Manager] ✅ Provider ${providerName} fetched`);
      this._log('success', `Provider ${providerName} fetched`);
      
      await this.sleep(500);
      
      // Step 2: Get selector info
      console.log(`[Clash Manager] Step 2/5: Getting selector ${selectorName} info...`);
      this._log('info', `Step 2/5: Getting selector ${selectorName} info...`);
      
      const selectorInfo = await this.getSelectorInfo(selectorName);
      
      console.log(`[Clash Manager] 📋 Selector has ${selectorInfo.all.length} proxies available`);
      console.log(`[Clash Manager]    Current: ${selectorInfo.now}`);
      this._log('info', `Selector has ${selectorInfo.all.length} proxies`);
      this._log('debug', `Available: ${selectorInfo.all.join(', ')}`);
      this._log('debug', `Current: ${selectorInfo.now}`);
      
      // Step 3: Verify provider proxies available
      console.log(`[Clash Manager] Step 3/5: Verifying provider proxies...`);
      this._log('info', `Step 3/5: Verifying provider proxies...`);
      
      const providerProxies = selectorInfo.all.filter(p => !p.includes('dummy'));
      
      if (providerProxies.length === 0) {
        throw new Error('No provider proxies available in selector! Only dummy found.');
      }
      
      console.log(`[Clash Manager] ✅ Provider proxies available: ${providerProxies.length}`);
      console.log(`[Clash Manager]    Proxies: ${providerProxies.slice(0, 3).join(', ')}${providerProxies.length > 3 ? '...' : ''}`);
      this._log('success', `Provider proxies available: ${providerProxies.length}`);
      this._log('debug', `Proxies: ${providerProxies.join(', ')}`);
      
      // Step 4: Switch to provider proxy
      console.log(`[Clash Manager] Step 4/5: Switching to provider proxy...`);
      this._log('info', `Step 4/5: Switching to provider proxy...`);
      
      const targetProxy = providerProxies[0];
      
      await this.switchSlotProxy(TEST_SLOT, targetProxy);
      
      console.log(`[Clash Manager] 🔄 Switched to: ${targetProxy}`);
      this._log('success', `Switched to: ${targetProxy}`);
      
      await this.sleep(500);
      
      // Step 5: Verify current proxy
      console.log(`[Clash Manager] Step 5/5: Verifying current proxy...`);
      this._log('info', `Step 5/5: Verifying current proxy...`);
      
      const currentProxy = await this.getCurrentProxy(selectorName);
      
      if (currentProxy === targetProxy) {
        console.log(`[Clash Manager] ✅ Current proxy verified: ${currentProxy}`);
        console.log('[Clash Manager] ═══════════════════════════════════════════');
        console.log('[Clash Manager] ✅ PROVIDER MECHANISM TEST PASSED!');
        console.log('[Clash Manager] ═══════════════════════════════════════════');
        console.log('[Clash Manager] System verified! Safe to serve 1200 workers.');
        console.log('[Clash Manager] Workers will fetch providers on-demand.');
        console.log('[Clash Manager] ═══════════════════════════════════════════');
        
        this._log('success', `Current proxy verified: ${currentProxy}`);
        this._log('success', 'PROVIDER MECHANISM TEST PASSED!');
        this._log('info', '');
        
        return {
          success: true,
          testSlot: TEST_SLOT,
          providerName: providerName,
          selectorName: selectorName,
          providerFetched: true,
          providerProxies: providerProxies,
          switchSuccess: true,
          targetProxy: targetProxy,
          currentProxy: currentProxy,
          message: 'Provider mechanism verified! Safe to serve 1200 workers.'
        };
      } else {
        throw new Error(
          `Proxy switch verification failed!\n` +
          `Expected: ${targetProxy}\n` +
          `Got: ${currentProxy}`
        );
      }
      
    } catch (error) {
      console.error('[Clash Manager] ═══════════════════════════════════════════');
      console.error('[Clash Manager] ❌ PROVIDER TEST FAILED!');
      console.error('[Clash Manager] ═══════════════════════════════════════════');
      console.error(`[Clash Manager] Error: ${error.message}`);
      console.error('[Clash Manager] ═══════════════════════════════════════════');
      
      this._log('error', 'PROVIDER TEST FAILED!');
      this._log('error', error.message);
      this._log('error', '');
      
      return {
        success: false,
        testSlot: TEST_SLOT,
        error: error.message,
        message: 'Provider mechanism FAILED! Cannot serve workers safely.'
      };
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.9.0: FETCH SINGLE PROVIDER
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async fetchProviderOnce(slotId) {
    const slotPadded = this.formatSlotId(slotId);
    const providerName = `ProxyPool${slotPadded}`;
    
    this._log('debug', `Fetching provider: ${providerName}`);
    
    try {
      const response = await this.apiClient.put(
        `/providers/proxies/${encodeURIComponent(providerName)}`,
        {}
      );
      
      if (response.status === 204 || response.status === 200) {
        this._log('debug', `${providerName} fetched successfully (HTTP ${response.status})`);
        return { success: true, slotId, providerName, status: response.status };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMsg = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.message;
      
      this._log('error', `Failed to fetch ${providerName}: ${errorMsg}`);
      throw new Error(`Slot ${slotId} provider fetch failed: ${errorMsg}`);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.9.0: GET SELECTOR INFO
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async getSelectorInfo(selectorName) {
    this._log('debug', `Getting selector info: ${selectorName}`);
    
    try {
      const response = await this.apiClient.get(`/proxies/${encodeURIComponent(selectorName)}`);
      
      if (response.status === 200 && response.data) {
        const info = {
          type: response.data.type,
          now: response.data.now,
          all: response.data.all || []
        };
        
        this._log('debug', `Selector ${selectorName}: type=${info.type}, now=${info.now}, all=${info.all.length} proxies`);
        return info;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMsg = error.response 
        ? `HTTP ${error.response.status}: ${error.response.statusText}`
        : error.message;
      
      this._log('error', `Failed to get selector info for ${selectorName}: ${errorMsg}`);
      throw new Error(`Get selector info failed: ${errorMsg}`);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.9.0: GET CURRENT PROXY
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async getCurrentProxy(selectorName) {
    const info = await this.getSelectorInfo(selectorName);
    return info.now;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.7.0: SWITCH SLOT PROXY
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async switchSlotProxy(slotId, targetProxyName, retries = 3) {
    const slotPadded = this.formatSlotId(slotId);
    const selectorName = `SLOT${slotPadded}`;
    
    this._log('debug', `Switching ${selectorName} to ${targetProxyName}`);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.apiClient.put(
          `/proxies/${encodeURIComponent(selectorName)}`,
          { name: targetProxyName }
        );
        
        if (response.status === 204 || response.status === 200) {
          this._log('success', `${selectorName} switched to ${targetProxyName}`);
          this.proxySwapCount++;
          return { success: true, slotId, selector: selectorName, proxy: targetProxyName };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText || 'Unknown error'}`);
        }
      } catch (error) {
        const errorMsg = error.response 
          ? `HTTP ${error.response.status}: ${error.response.data?.message || error.response.statusText}`
          : error.message;
        
        this._log('warn', `Attempt ${attempt}/${retries} failed: ${errorMsg}`);
        
        if (attempt === retries) {
          this._log('error', `Failed to switch ${selectorName} after ${retries} attempts`);
          throw new Error(`Proxy switch failed after ${retries} attempts: ${errorMsg}`);
        }
        
        const delay = Math.pow(2, attempt - 1) * 500;
        await this.sleep(delay);
      }
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.5.0: GENERATE CONFIG VIA ClashStaticGenerator
   * ═══════════════════════════════════════════════════════════════
   */
  async generateNewConfig() {
    const ClashStaticGenerator = require('./clash_static_generator');
    
    console.log('[Clash Manager] 🔧 Generating new Clash config v10.1.0 (use + dummy)...');
    this._log('section', 'Config Generation via ClashStaticGenerator v10.1.0');
    this._log('info', `Target: ${path.basename(this.configPath)}`);
    this._log('info', `QTE_ID: ${this.qteId}`);
    this._log('info', '');
    
    try {
      const generator = new ClashStaticGenerator(this.qteId);
      const generatedPath = await generator.generateStaticConfig();
      
      console.log(`[Clash Manager] ✅ Config generated: ${path.basename(generatedPath)}`);
      this._log('success', `Config generated: ${path.basename(generatedPath)}`);
      this._log('debug', `Full path: ${generatedPath}`);
      
      if (!fs.existsSync(generatedPath)) {
        throw new Error(`Config generation reported success but file not found: ${generatedPath}`);
      }
      
      const stats = fs.statSync(generatedPath);
      if (stats.size === 0) {
        throw new Error(`Config file is empty: ${generatedPath}`);
      }
      
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`[Clash Manager] ✅ Config verified: ${sizeKB} KB`);
      this._log('success', `Config size: ${sizeKB} KB`);
      this._log('info', '');
      
    } catch (err) {
      console.error(`[Clash Manager] ❌ Config generation failed: ${err.message}`);
      this._log('error', `Config generation failed: ${err.message}`);
      throw new Error(
        `[Clash Manager] FATAL: Clash config generation failed!\n` +
        `\n` +
        `Error: ${err.message}\n` +
        `\n` +
        `POSSIBLE CAUSES:\n` +
        `  1. QTE_ID invalid: "${this.qteId}"\n` +
        `  2. config_clash.json missing or corrupted\n` +
        `  3. OTHERS_RESERVED/MSEDGE_RESERVED misconfigured in .env\n` +
        `  4. Write permissions denied for ${this.configDir}\n` +
        `\n` +
        `ACTION:\n` +
        `  1. Verify QTE_ID in .env: QTE_ID=QTE-DESKTOP-01\n` +
        `  2. Check ./Clash/config_clash.json syntax\n` +
        `  3. Ensure write permissions on ./Clash/config/\n` +
        `  4. Check ClashStaticGenerator.js v10.1.0 is deployed\n` +
        `\n` +
        `Full error: ${err.stack || err.message}`
      );
    }
  }

  verifyAdminPrivileges() {
    this._log('debug', 'Testing admin privileges...');
    
    try {
      const testPath = path.join(process.env.windir, 'Temp', `qte_admin_test_${Date.now()}.tmp`);
      
      try {
        fs.writeFileSync(testPath, 'test', 'utf8');
        fs.unlinkSync(testPath);
        console.log('[Clash Manager] ✅ Admin privileges verified');
        this._log('success', 'Admin privileges verified (write test passed)');
        return;
      } catch (error) {
        this._log('error', `Admin write test failed: ${error.message}`);
        throw new Error(
          `[Clash Manager] FATAL: Administrator privileges required!\n` +
          `\n` +
          `TUN mode requires elevated privileges to:\n` +
          `  1. Create virtual network interface\n` +
          `  2. Modify routing table\n` +
          `  3. Intercept network packets\n` +
          `\n` +
          `ACTION:\n` +
          `  1. Close this application\n` +
          `  2. Right-click on Node.js or your terminal\n` +
          `  3. Select "Run as Administrator"\n` +
          `  4. Restart QTE\n`
        );
      }
    } catch (error) {
      if (error.message.includes('FATAL')) {
        throw error;
      }
      
      this._log('debug', 'Fallback: Testing with net session command...');
      try {
        execSync('net session', { stdio: 'ignore', windowsHide: true });
        console.log('[Clash Manager] ✅ Admin privileges verified');
        this._log('success', 'Admin privileges verified (net session passed)');
      } catch {
        this._log('error', 'net session command failed');
        throw new Error(`[Clash Manager] FATAL: Administrator privileges required for TUN mode!`);
      }
    }
  }

  ensureDirectories() {
    const dirs = [this.configDir, this.logDir];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this._log('debug', `Created directory: ${dir}`);
      } else {
        this._log('debug', `Directory exists: ${dir}`);
      }
    }
  }

  verifyBinary() {
    this._log('debug', `Checking binary: ${this.clashBinary}`);
    
    if (!fs.existsSync(this.clashBinary)) {
      this._log('error', `Binary not found: ${this.clashBinary}`);
      throw new Error(
        `[Clash Manager] FATAL: clash.exe not found!\n` +
        `\n` +
        `Expected: ${this.clashBinary}\n` +
        `\n` +
        `ACTION:\n` +
        `  1. Download mihomo-windows-amd64-compatible.exe\n` +
        `  2. Rename to clash.exe\n` +
        `  3. Place in: ${this.clashDir}\n` +
        `\n` +
        `Download: https://github.com/MetaCubeX/mihomo/releases`
      );
    }
    
    const stats = fs.statSync(this.clashBinary);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    
    console.log(`[Clash Manager] ✅ Binary verified: clash.exe (${sizeMB} MB)`);
    this._log('success', `Binary verified: ${this.clashBinary} (${sizeMB} MB)`);
  }

  verifyConfig() {
    this._log('debug', `Checking config: ${this.configPath}`);
    
    if (!fs.existsSync(this.configPath)) {
      this._log('error', `Config not found: ${this.configPath}`);
      throw new Error(
        `[Clash Manager] FATAL: Config file not found!\n` +
        `\n` +
        `Expected: ${this.configPath}\n` +
        `\n` +
        `This should have been generated in previous step!`
      );
    }
    
    const content = fs.readFileSync(this.configPath, 'utf8');
    if (content.trim() === '') {
      throw new Error('[Clash Manager] FATAL: Config file is empty!');
    }
    
    const stats = fs.statSync(this.configPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    
    console.log(`[Clash Manager] ✅ Config verified: ${sizeKB} KB`);
    this._log('success', `Config verified: ${this.configPath} (${sizeKB} KB)`);
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.2: PREPARE LOG FILE (TIMESTAMPED FILENAME!)
   * ═══════════════════════════════════════════════════════════════
   */
  prepareLogFile() {
    // Generate timestamp: YYYYMMDD_HHmmss (sortable, compact)
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    
    const logFilename = `clash_${this.qteId}_${timestamp}.log`;
    this.logPath = path.join(this.logDir, logFilename);
    
    // Create empty log file
    fs.writeFileSync(this.logPath, '', 'utf8');
    
    console.log(`[Clash Manager] ✅ Log file ready: ${logFilename}`);
    this._log('success', `Log file ready: ${this.logPath}`);
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v3.9.2: SPAWN CLASH PROCESS (SMART LOGGING!)
   * ═══════════════════════════════════════════════════════════════
   */
  spawnClashProcess() {
    const args = ['-d', this.clashDir, '-f', this.configPath];
    
    this._log('debug', `Spawning: ${this.clashBinary} ${args.join(' ')}`);
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 DETERMINE STDIO CONFIG BASED ON CLASH_LOG & DEBUG_MODE
    // ═══════════════════════════════════════════════════════════════
    let stdioConfig;
    let shouldLogToFile = false;
    let shouldLogToConsole = false;
    
    if (!this.debugMode) {
      // PRODUCTION MODE: Always silent terminal, file-only
      stdioConfig = ['ignore', 'pipe', 'pipe'];
      shouldLogToFile = true;
      shouldLogToConsole = false;
      
      this._log('debug', 'Production mode: terminal silent, file-only logging');
      
    } else {
      // DEVELOPMENT MODE: Controlled by CLASH_LOG
      switch (this.clashLogLevel) {
        case 0: // NO LOG
          stdioConfig = ['ignore', 'ignore', 'ignore'];
          shouldLogToFile = false;
          shouldLogToConsole = false;
          this._log('debug', 'CLASH_LOG=0: Silent mode (no logging)');
          break;
          
        case 1: // TERMINAL ONLY
          stdioConfig = ['ignore', 'inherit', 'inherit'];
          shouldLogToFile = false;
          shouldLogToConsole = false; // inherit handles console directly
          this._log('debug', 'CLASH_LOG=1: Terminal only (inherit mode)');
          break;
          
        case 2: // TERMINAL + FILE
          stdioConfig = ['ignore', 'pipe', 'pipe'];
          shouldLogToFile = true;
          shouldLogToConsole = true; // With smart filtering
          this._log('debug', 'CLASH_LOG=2: Terminal + file (filtered output)');
          break;
          
        case 3: // FILE ONLY (DEFAULT)
        default:
          stdioConfig = ['ignore', 'pipe', 'pipe'];
          shouldLogToFile = true;
          shouldLogToConsole = false;
          this._log('debug', 'CLASH_LOG=3: File only (clean terminal)');
          break;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SPAWN PROCESS
    // ═══════════════════════════════════════════════════════════════
    this.clashProcess = spawn(this.clashBinary, args, {
      cwd: this.clashDir,
      stdio: stdioConfig,
      windowsHide: true
    });

    // ═══════════════════════════════════════════════════════════════
    // 🔥 CONDITIONAL EVENT HANDLERS (PERFORMANCE OPTIMIZATION!)
    // ═══════════════════════════════════════════════════════════════
    if (shouldLogToFile || shouldLogToConsole) {
      const logStream = shouldLogToFile 
        ? fs.createWriteStream(this.logPath, { flags: 'a', encoding: 'utf8' })
        : null;
      
      // STDOUT Handler
      this.clashProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Always log to file (if enabled)
          if (logStream) {
            logStream.write(`STDOUT: ${line}\n`);
          }
          
          // Conditional console output (if enabled)
          if (shouldLogToConsole) {
            // Track provider initialization for summary
            if (/Start initial provider ProxyPool/.test(line)) {
              this.incrementProviderCount();
            } 
            // Show other lines if they pass filter
            else if (this.shouldDisplayLine(line)) {
              console.log(`[Clash] ${line.trim()}`);
            }
          }
        }
      });
      
      // STDERR Handler
      this.clashProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // Always log to file (if enabled)
          if (logStream) {
            logStream.write(`STDERR: ${line}\n`);
          }
          
          // Conditional console output (if enabled)
          if (shouldLogToConsole) {
            // STDERR is typically errors/warnings, always show if console enabled
            console.error(`[Clash STDERR] ${line.trim()}`);
          }
        }
      });
      
      // Cleanup on exit
      this.clashProcess.on('exit', (code, signal) => {
        if (logStream) {
          logStream.write(`\nEXIT: code=${code}, signal=${signal}\n`);
          logStream.end();
        }
      });
      
      this._log('debug', `Event handlers configured: file=${shouldLogToFile}, console=${shouldLogToConsole}`);
    } else {
      this._log('debug', 'No event handlers (silent or inherit mode)');
    }

    // ═══════════════════════════════════════════════════════════════
    // PROCESS EVENT HANDLERS (ALWAYS ACTIVE)
    // ═══════════════════════════════════════════════════════════════
    this.clashProcess.on('error', (error) => {
      console.error(`[Clash Manager] ❌ Process error: ${error.message}`);
      this._log('error', `Process error: ${error.message}`);
    });

    this.clashProcess.on('exit', (code, signal) => {
      console.log(`[Clash Manager] Process exited: code=${code}, signal=${signal}`);
      this._log('info', `Process exited: code=${code}, signal=${signal}`);
      this.isRunning = false;
    });

    console.log(`[Clash Manager] ✅ Process spawned: PID ${this.clashProcess.pid}`);
    this._log('success', `Process spawned: PID ${this.clashProcess.pid}`);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.9.1: WAIT FOR TUN INTERFACE (WITH INDEX PARSING!)
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async waitForTUNInterface(timeoutSeconds = 30) {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;

    this._log('debug', 'Waiting for TUN interface...');

    while (Date.now() - startTime < timeout) {
      try {
        const output = execSync('netsh interface show interface', {
          encoding: 'utf8',
          windowsHide: true
        });

        const lines = output.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes('clash') || 
              line.toLowerCase().includes('meta') || 
              line.toLowerCase().includes('mihomo')) {
            
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 4) {
              const ifName = parts.slice(3).join(' ');
              
              // ✅ GET INTERFACE INDEX (proper method!)
              try {
                const indexCmd = `netsh interface ipv4 show interfaces`;
                const indexOutput = execSync(indexCmd, {
                  encoding: 'utf8',
                  windowsHide: true
                });
                
                // Parse output: Idx     Met         MTU          State                Name
                const indexLines = indexOutput.split('\n');
                for (const idxLine of indexLines) {
                  if (idxLine.includes(ifName)) {
                    const idxParts = idxLine.trim().split(/\s+/);
                    if (idxParts.length >= 1 && /^\d+$/.test(idxParts[0])) {
                      this.tunInterfaceIndex = parseInt(idxParts[0], 10);
                      this.tunInterfaceName = ifName;
                      
                      console.log(`[Clash Manager] ✅ TUN interface found: ${ifName} (Index: ${this.tunInterfaceIndex})`);
                      this._log('success', `TUN interface found: ${ifName} (Index: ${this.tunInterfaceIndex})`);
                      return ifName;
                    }
                  }
                }
              } catch (err) {
                this._log('debug', `Failed to get interface index: ${err.message}`);
              }
              
              // Fallback: Store name only if index parsing failed
              this.tunInterfaceName = ifName;
              this.tunInterfaceIndex = null;
              
              console.log(`[Clash Manager] ✅ TUN interface found: ${ifName} (Index: unavailable)`);
              this._log('success', `TUN interface found: ${ifName}`);
              this._log('warn', 'Interface index not available (route injection may use fallback)');
              return ifName;
            }
          }
        }
      } catch (error) {
        this._log('debug', `TUN check error: ${error.message}`);
      }

      await this.sleep(500);
    }

    throw new Error('[Clash Manager] TUN interface not found within timeout!');
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 🔥 v3.9.1: INJECT FAKE-IP ROUTE (PROPER METHOD + OPTIONAL!)
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async injectFakeIPRoute() {
    // ✅ FIXED: Variables at function scope (not block scope)
    const fakeIPRange = '198.18.0.0';
    const mask = '255.254.0.0';
    
    // Step 1: Clean up existing route
    try {
      execSync(`route delete ${fakeIPRange}`, { windowsHide: true, stdio: 'ignore' });
      this._log('debug', 'Existing fake-IP route deleted');
    } catch {
      // Ignore errors if route doesn't exist
    }

    // Step 2: Try injection with proper method
    let injectionSuccess = false;
    let lastError = null;

    // ✅ METHOD 1: With interface index (PROPER WAY!)
    if (this.tunInterfaceIndex) {
      try {
        const cmd = `route add ${fakeIPRange} mask ${mask} 0.0.0.0 if ${this.tunInterfaceIndex}`;
        execSync(cmd, { encoding: 'utf8', windowsHide: true });
        
        injectionSuccess = true;
        console.log(`[Clash Manager] ✅ Fake-IP route injected (via interface ${this.tunInterfaceIndex})`);
        this._log('success', `Fake-IP route injected via interface ${this.tunInterfaceIndex} (${this.tunInterfaceName})`);
      } catch (error) {
        lastError = error;
        this._log('debug', `Method 1 failed (interface index ${this.tunInterfaceIndex}): ${error.message}`);
      }
    } else {
      this._log('debug', 'Interface index not available, skipping method 1');
    }

    // ✅ METHOD 2: Without interface specification (FALLBACK)
    if (!injectionSuccess) {
      try {
        const cmd = `route add ${fakeIPRange} mask ${mask} 0.0.0.0`;
        execSync(cmd, { encoding: 'utf8', windowsHide: true });
        
        injectionSuccess = true;
        console.log(`[Clash Manager] ✅ Fake-IP route injected (auto-route)`);
        this._log('success', 'Fake-IP route injected (Windows auto-routing)');
      } catch (error) {
        lastError = error;
        this._log('debug', `Method 2 failed (auto-route): ${error.message}`);
      }
    }

    // Step 3: Handle result
    if (injectionSuccess) {
      this.routeInjected = true;
    } else {
      // ✅ OPTIONAL: Don't throw error, just warn and continue
      console.warn(`[Clash Manager] ⚠️  Route injection skipped: ${lastError?.message || 'All methods failed'}`);
      console.warn(`[Clash Manager] ⚠️  TUN interface will handle routing automatically`);
      this._log('warn', `Route injection failed: ${lastError?.message || 'Unknown error'}`);
      this._log('warn', 'TUN interface will handle fake-IP routing automatically (no manual route needed)');
      this._log('warn', 'System will continue without manual route injection');
      
      this.routeInjected = false;
      // ✅ DON'T THROW - Continue startup!
    }
  }

  async waitForAPI(timeoutSeconds = 30) {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;

    this._log('debug', 'Waiting for Clash API...');

    while (Date.now() - startTime < timeout) {
      try {
        const response = await this.apiClient.get('/version');
        if (response.status === 200) {
          console.log(`[Clash Manager] ✅ API ready: ${response.data.version || 'unknown'}`);
          this._log('success', `API ready: ${JSON.stringify(response.data)}`);
          return true;
        }
      } catch (error) {
        this._log('debug', `API check error: ${error.message}`);
      }

      await this.sleep(500);
    }

    throw new Error('[Clash Manager] API not ready within timeout!');
  }

  async stop() {
    if (!this.clashProcess) {
      console.log('[Clash Manager] No process to stop');
      return;
    }

    console.log('[Clash Manager] Stopping Clash...');
    this._log('info', 'Stopping Clash process...');

    try {
      if (this.routeInjected) {
        try {
          execSync('route delete 198.18.0.0', { windowsHide: true, stdio: 'ignore' });
          console.log('[Clash Manager] ✅ Fake-IP route removed');
          this._log('success', 'Fake-IP route removed');
        } catch (err) {
          this._log('warn', `Route cleanup failed: ${err.message}`);
        }
      }

      this.clashProcess.kill('SIGTERM');
      
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.clashProcess && !this.clashProcess.killed) {
            this.clashProcess.kill('SIGKILL');
            this._log('warn', 'Process force killed (SIGKILL)');
          }
          resolve();
        }, 5000);

        this.clashProcess.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      console.log('[Clash Manager] ✅ Clash stopped');
      this._log('success', 'Clash stopped successfully');
      
    } catch (error) {
      console.error(`[Clash Manager] Stop error: ${error.message}`);
      this._log('error', `Stop error: ${error.message}`);
    } finally {
      this.clashProcess = null;
      this.isRunning = false;
      this.tunInterfaceName = null;
      this.tunInterfaceIndex = null;
      this.routeInjected = false;
      this.providerInitCount = 0;
    }
  }

  async getStats() {
    if (!this.isRunning) {
      return { status: 'stopped' };
    }

    try {
      const response = await this.apiClient.get('/version');
      
      return {
        status: 'running',
        pid: this.clashProcess?.pid,
        version: response.data.version,
        uptime: Date.now() - this.startTime,
        proxySwaps: this.proxySwapCount,
        tunInterface: this.tunInterfaceName,
        tunInterfaceIndex: this.tunInterfaceIndex,
        routeInjected: this.routeInjected,
        clashLogLevel: this.clashLogLevel,
        clashLogMode: this.getLogLevelName(),
        logFile: this.logPath ? path.basename(this.logPath) : null,
        api: this.apiBase
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}

// 🔥 EXPORT SINGLETON INSTANCE
module.exports = new ClashManager();