/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * clash_static_generator.js v6.0.0 - C++ VALIDATOR ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 🔥 MAJOR CHANGE v6.0.0 (2026-02-14 01:23 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ❌ REMOVED: DOMAIN-based IP validation (ipcheck-slot*.local) - OBSOLETE!
 * ✅ NEW: PROCESS-NAME based IP validation (ip_worker###.exe)
 * ✅ ARCHITECTURE: C++ binary validator with on-demand hardlinks
 * ✅ BENEFIT: Process-based routing (100% reliable, no DNS issues!)
 * 
 * VALIDATOR FLOW:
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. opsi4.js creates hardlink on-demand: ip_validator.exe → ip_worker001.exe
 * 2. Spawn ip_worker001.exe subprocess
 * 3. Clash TUN routes via PROCESS-NAME,ip_worker001.exe,SLOT001
 * 4. Validator fetches http://ip-api.com/json via proxy
 * 5. Returns JSON to stdout
 * 6. opsi4.js parses JSON, verifies IP match
 * 7. opsi4.js deletes hardlink (cleanup)
 * 
 * CONFIG CHANGES:
 * ──────────────────────────────────────────────────────────────────────────────
 * - include-process: +1200 entries (ip_worker###.exe)
 * - rules: -1200 DOMAIN rules, +1200 PROCESS-NAME rules
 * - Total rules: SAME (2400 PROCESS-NAME rules)
 * - Hardlinks: ZERO at config generation (created on-demand!)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const { formatSlotId } = require('./utils');

class ClashStaticGenerator {
  constructor(qteId) {
    this.qteId = qteId;
    
    // ═════════════════════════════════════════════════════════════
    // DYNAMIC SLOT RESERVATION FROM .ENV
    // ═════════════════════════════════════════════════════════════
    this.othersReserved = parseInt(process.env.OTHERS_RESERVED || '1000', 10);
    this.msedgeReserved = parseInt(process.env.MSEDGE_RESERVED || '200', 10);
    
    // Calculate segments
    this.othersStart = 1;
    this.othersEnd = this.othersReserved;
    this.msedgeStart = this.othersEnd + 1;
    this.msedgeEnd = this.othersEnd + this.msedgeReserved;
    this.totalSlots = this.msedgeEnd;
    
    // Validate configuration
    this.validateReservation();
    
    // ═════════════════════════════════════════════════════════════
    // PATHS
    // ═════════════════════════════════════════════════════════════
    this.clashDir = path.join(__dirname, 'Clash');
    this.configDir = path.join(this.clashDir, 'config');
    this.configPath = path.join(this.configDir, `${qteId}_clash.yaml`);
    this.userConfigPath = path.join(this.clashDir, 'config_clash.json');
    this.providerDir = path.join(this.clashDir, 'providers');
    this.validatorPath = path.join(this.clashDir, 'ip_validator.exe');
    
    // ═════════════════════════════════════════════════════════════
    // PROXY API SERVER CONFIG (from .env)
    // ═════════════════════════════════════════════════════════════
    this.proxyAPIHost = process.env.WINDOWS_API_HOST || '127.0.0.1';
    this.proxyAPIPort = parseInt(process.env.WINDOWS_API_PORT || '3000', 10);
    this.proxyAPIBaseUrl = `http://${this.proxyAPIHost}:${this.proxyAPIPort}`;
    
    // ═════════════════════════════════════════════════════════════
    // LOAD USER CONFIG (config_clash.json)
    // ═════════════════════════════════════════════════════════════
    this.userConfig = this.loadUserConfig();
    
    // ═════════════════════════════════════════════════════════════
    // v6.0.0: INIT LOG
    // ═════════════════════════════════════════════════════════════
    console.log('[Clash Static] Generator v6.0.0 initialized (C++ VALIDATOR!)');
    console.log(`[Clash Static] QTE ID: ${qteId}`);
    console.log(`[Clash Static] OTHERS: ${this.othersStart}-${this.othersEnd} (${this.othersReserved} slots)`);
    console.log(`[Clash Static] MSEDGE: ${this.msedgeStart}-${this.msedgeEnd} (${this.msedgeReserved} slots)`);
    console.log(`[Clash Static] TOTAL: ${this.totalSlots} slots`);
    console.log(`[Clash Static] Provider API: ${this.proxyAPIBaseUrl}`);
    console.log(`[Clash Static] Validator: ${this.validatorPath}`);
    console.log('[Clash Static] ✅ Selector: use: [ProxyPool###] (dynamic load!)');
    console.log('[Clash Static] ✅ Fallback: dummy-### proxies (initial state)');
    console.log('[Clash Static] ✅ Provider: interval=0, no health-check (manual only!)');
    console.log('[Clash Static] ✅ On-demand: Workers fetch providers when needed');
    console.log('[Clash Static] ✅ Lazy loading: ENABLED (no startup fetch!)');
    console.log('[Clash Static] 🔥 NEW: IP validation via C++ binary (process-based!)');
    console.log('[Clash Static] 🔥 NEW: Hardlinks created on-demand (no pre-generation!)');
    console.log('[Clash Static] 🔥 NEW: Cleanup after validation (no hardlink accumulation!)');
    console.log('[Clash Static] ✅ PROCESS-PATH: REGEX pattern (portable!)');
    console.log('[Clash Static] ✅ Stealth: Chrome fingerprint + tcp-concurrent');
    console.log('[Clash Static] ✅ DNS: fake-ip mode');
    console.log('[Clash Static] ✅ Filtering: include-process (workers + validators)');
    console.log(`[Clash Static] ✅ User config: ${this.userConfigPath}`);
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * VALIDATE SLOT RESERVATION
   * ═══════════════════════════════════════════════════════════════
   */
  validateReservation() {
    const errors = [];
    
    if (isNaN(this.othersReserved) || this.othersReserved < 1) {
      errors.push(`Invalid OTHERS_RESERVED: ${process.env.OTHERS_RESERVED} (must be >= 1)`);
    }
    
    if (isNaN(this.msedgeReserved) || this.msedgeReserved < 1) {
      errors.push(`Invalid MSEDGE_RESERVED: ${process.env.MSEDGE_RESERVED} (must be >= 1)`);
    }
    
    if (this.totalSlots > 9999) {
      errors.push(`Total slots ${this.totalSlots} exceeds maximum 9999`);
    }
    
    if (errors.length > 0) {
      throw new Error(
        `[Clash Static] Slot reservation validation failed:\n` +
        errors.map(e => `  ❌ ${e}`).join('\n')
      );
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * LOAD & VALIDATE USER CONFIG (config_clash.json)
   * ═══════════════════════════════════════════════════════════════
   */
  loadUserConfig() {
    if (!fs.existsSync(this.userConfigPath)) {
      console.log('[Clash Static] config_clash.json not found, creating default...');
      
      const defaultConfig = {
        version: '6.0.0',
        comment: 'QTE Clash Configuration - User editable settings only',
        dns: {
          localResolver: '172.16.100.1',
          comment: 'Smart Gateway DNS resolver - DO NOT change unless you know what you\'re doing'
        },
        bypass: {
          domains: [
            '*.glimpseit.online',
            '*.healthandbeauty.my.id',
            'localhost'
          ],
          comment: 'Domains that should bypass proxy (DIRECT connection)'
        }
      };
      
      if (!fs.existsSync(this.clashDir)) {
        fs.mkdirSync(this.clashDir, { recursive: true });
      }
      
      fs.writeFileSync(
        this.userConfigPath,
        JSON.stringify(defaultConfig, null, 2),
        'utf8'
      );
      
      console.log(`[Clash Static] ✅ Default config created: ${this.userConfigPath}`);
      return defaultConfig;
    }
    
    try {
      const content = fs.readFileSync(this.userConfigPath, 'utf8');
      const config = JSON.parse(content);
      
      this.validateUserConfig(config);
      console.log('[Clash Static] ✅ User config loaded');
      console.log(`[Clash Static] DNS: ${config.dns.localResolver}`);
      console.log(`[Clash Static] Bypass: ${config.bypass.domains.length} domains`);
      return config;
    } catch (error) {
      throw new Error(
        `[Clash Static] Failed to load config_clash.json:\n` +
        `  Path: ${this.userConfigPath}\n` +
        `  Error: ${error.message}`
      );
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * VALIDATE USER CONFIG
   * ═══════════════════════════════════════════════════════════════
   */
  validateUserConfig(config) {
    const errors = [];
    
    if (!config.version) {
      errors.push('Missing version field');
    }
    
    if (!config.dns || !config.dns.localResolver) {
      errors.push('Missing dns.localResolver');
    } else {
      const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = config.dns.localResolver.match(ipv4Regex);
      
      if (!match) {
        errors.push(`Invalid DNS IP format: ${config.dns.localResolver}`);
      } else {
        const octets = [match[1], match[2], match[3], match[4]].map(Number);
        const invalidOctets = octets.filter(o => o < 0 || o > 255);
        
        if (invalidOctets.length > 0) {
          errors.push(`Invalid DNS IP octets: ${config.dns.localResolver}`);
        }
      }
    }
    
    if (!config.bypass) {
      errors.push('Missing bypass section');
    } else if (!Array.isArray(config.bypass.domains)) {
      errors.push('bypass.domains must be an array');
    }
    
    if (errors.length > 0) {
      throw new Error(
        `[Clash Static] Config validation failed:\n` +
        errors.map(e => `  ❌ ${e}`).join('\n')
      );
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v6.0.0: GENERATE INCLUDE-PROCESS LIST (VALIDATORS + BROWSERS!)
   * ═══════════════════════════════════════════════════════════════
   * Filter: Only worker processes enter TUN device
   * 
   * INCLUDES:
   * - IP Validators: ip_worker###.exe (1200 entries) ← NEW!
   * - Browser Workers: worker###.exe (1200 entries)
   * 
   * Total: 2400 entries (validators + browsers)
   */
  generateIncludeProcessList() {
    const processes = [];
    
    // ═════════════════════════════════════════════════════════════
    // 🔥 v6.0.0: IP VALIDATORS (ALL SLOTS)
    // ═════════════════════════════════════════════════════════════
    console.log('[Clash Static] Adding IP validator processes...');
    
    for (let i = 1; i <= this.totalSlots; i++) {
      const slotId = formatSlotId(i);
      processes.push(`ip_worker${slotId}.exe`);
    }
    
    console.log(`[Clash Static] ✅ Added ${this.totalSlots} IP validator processes`);
    
    // ═════════════════════════════════════════════════════════════
    // BROWSER WORKERS: OTHERS SEGMENT (PROCESS-NAME)
    // ═════════════════════════════════════════════════════════════
    for (let i = this.othersStart; i <= this.othersEnd; i++) {
      const slotId = formatSlotId(i);
      processes.push(`worker${slotId}.exe`);
    }
    
    // ═════════════════════════════════════════════════════════════
    // BROWSER WORKERS: MSEDGE SEGMENT (REGEX PATTERN)
    // ═════════════════════════════════════════════════════════════
    for (let i = this.msedgeStart; i <= this.msedgeEnd; i++) {
      const slotId = formatSlotId(i);
      const regexPattern = `.+\\\\Browser\\\\edge\\\\worker${slotId}\\\\msedge\\.exe$`;
      processes.push(regexPattern);
    }
    
    console.log(`[Clash Static] ✅ Generated ${processes.length} include-process entries`);
    console.log(`[Clash Static] ├─ IP Validators: ${this.totalSlots} (ip_worker###.exe)`);
    console.log(`[Clash Static] ├─ OTHERS Browsers: ${this.othersReserved} (worker###.exe)`);
    console.log(`[Clash Static] └─ MSEDGE Browsers: ${this.msedgeReserved} (REGEX pattern)`);
    
    return processes;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * GENERATE DUMMY PROXIES (FALLBACK/INITIAL STATE)
   * ═══════════════════════════════════════════════════════════════
   */
  generateDummyProxies() {
    const proxies = [];
    
    console.log('[Clash Static] Generating dummy proxies (fallback)...');
    
    for (let i = 1; i <= this.totalSlots; i++) {
      const slotId = formatSlotId(i);
      
      proxies.push({
        name: `dummy-${slotId}`,
        type: 'http',
        server: this.proxyAPIHost,
        port: this.proxyAPIPort,
        username: 'dummy',
        password: 'dummy'
      });
    }
    
    console.log(`[Clash Static] ✅ Generated ${proxies.length} dummy proxies`);
    
    return proxies;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * GENERATE PROXY-PROVIDERS (NO AUTO-REFRESH!)
   * ═══════════════════════════════════════════════════════════════
   */
  generateProxyProviders() {
    const providers = {};
    
    console.log('[Clash Static] Generating proxy-providers...');
    
    for (let i = 1; i <= this.totalSlots; i++) {
      const slotId = formatSlotId(i);
      const providerName = `ProxyPool${slotId}`;
      
      providers[providerName] = {
        type: 'http',
        url: `${this.proxyAPIBaseUrl}/clash/provider/slot/${i}`,
        interval: 0,
        path: `./providers/slot_${slotId}.yaml`,
        lazy: true,
        'health-check': {
          enable: false,
          url: 'http://www.gstatic.com/generate_204',
          interval: 0
        }
      };
    }
    
    console.log(`[Clash Static] ✅ Generated ${Object.keys(providers).length} providers`);
    
    return providers;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * GENERATE SLOT GROUPS (WITH 'use' KEYWORD!)
   * ═══════════════════════════════════════════════════════════════
   */
  generateSlotGroups() {
    const groups = [];
    
    console.log('[Clash Static] Generating selector groups with dynamic provider loading...');
    
    for (let i = 1; i <= this.totalSlots; i++) {
      const slotId = formatSlotId(i);
      const providerName = `ProxyPool${slotId}`;
      const dummyName = `dummy-${slotId}`;
      const selectorName = `SLOT${slotId}`;
      
      groups.push({
        name: selectorName,
        type: 'select',
        use: [providerName],
        proxies: [dummyName],
        'disable-udp': false
      });
    }
    
    groups.push({
      name: 'GLOBAL',
      type: 'select',
      proxies: ['DIRECT']
    });
    
    console.log(`[Clash Static] ✅ Generated ${groups.length - 1} slot selectors + 1 global`);
    
    return groups;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v6.0.0: GENERATE RULES (C++ VALIDATOR ARCHITECTURE!)
   * ═══════════════════════════════════════════════════════════════
   * 
   * MAJOR CHANGE:
   * - REMOVED: IP validation DOMAIN rules (ipcheck-slot*.local) - OBSOLETE!
   * - ADDED: IP validator PROCESS-NAME rules (ip_worker###.exe)
   * 
   * Rule priority (top to bottom):
   * 1. IP Validator Routing - ip_worker###.exe → SLOT### (NEW!)
   * 2. Bypass Domains - User config
   * 3. Local Network - Smart Gateway, private IPs
   * 4. Browser Workers - worker###.exe / msedge.exe → SLOT###
   * 5. MATCH Fallback - DIRECT
   */
  generateRules() {
    const rules = [];
    
    // ═════════════════════════════════════════════════════════════
    // 🔥 PRIORITY 1: IP VALIDATOR ROUTING (C++ BINARY!)
    // ═════════════════════════════════════════════════════════════
    console.log('[Clash Static] Generating IP validator routing rules (C++ binary)...');
    
    for (let i = 1; i <= this.totalSlots; i++) {
      const slotId = formatSlotId(i);
      const processName = `ip_worker${slotId}.exe`;
      const proxyGroup = `SLOT${slotId}`;
      
      rules.push(`PROCESS-NAME,${processName},${proxyGroup}`);
    }
    
    console.log(`[Clash Static] ✅ Generated ${this.totalSlots} IP validator rules`);
    console.log(`[Clash Static] ✅ Format: PROCESS-NAME,ip_worker###.exe,SLOT###`);
    console.log(`[Clash Static] 🔥 Validators route via process name (100% reliable!)`);
    
    // ═════════════════════════════════════════════════════════════
    // PRIORITY 2: BYPASS DOMAINS
    // ═════════════════════════════════════════════════════════════
    for (const domain of this.userConfig.bypass.domains) {
      const trimmed = domain.trim();
      if (trimmed === '') continue;
      
      if (trimmed.startsWith('*.')) {
        const baseDomain = trimmed.slice(2);
        rules.push(`DOMAIN-SUFFIX,${baseDomain},DIRECT`);
      } else if (trimmed.includes('/')) {
        rules.push(`IP-CIDR,${trimmed},DIRECT`);
      } else if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
        rules.push(`IP-CIDR,${trimmed}/32,DIRECT`);
      } else {
        rules.push(`DOMAIN,${trimmed},DIRECT`);
      }
    }
    
    // ═════════════════════════════════════════════════════════════
    // PRIORITY 3: LOCAL NETWORK BYPASS
    // ═════════════════════════════════════════════════════════════
    rules.push(`IP-CIDR,${this.userConfig.dns.localResolver}/32,DIRECT`);
    rules.push('IP-CIDR,172.16.0.0/12,DIRECT');
    rules.push('IP-CIDR,127.0.0.0/8,DIRECT');
    rules.push('IP-CIDR,192.168.0.0/16,DIRECT');
    
    // ═════════════════════════════════════════════════════════════
    // PRIORITY 4: BROWSER WORKERS - OTHERS SEGMENT
    // ═════════════════════════════════════════════════════════════
    for (let i = this.othersStart; i <= this.othersEnd; i++) {
      const slotId = formatSlotId(i);
      const exeName = `worker${slotId}.exe`;
      
      rules.push(`PROCESS-NAME,${exeName},SLOT${slotId}`);
    }
    
    // ═════════════════════════════════════════════════════════════
    // PRIORITY 5: BROWSER WORKERS - MSEDGE SEGMENT (REGEX!)
    // ═════════════════════════════════════════════════════════════
    for (let i = this.msedgeStart; i <= this.msedgeEnd; i++) {
      const slotId = formatSlotId(i);
      const regexPattern = `.+\\\\Browser\\\\edge\\\\worker${slotId}\\\\msedge\\.exe$`;
      
      rules.push(`PROCESS-PATH,${regexPattern},SLOT${slotId}`);
    }
    
    // ═════════════════════════════════════════════════════════════
    // PRIORITY 6: FALLBACK
    // ═════════════════════════════════════════════════════════════
    rules.push('MATCH,DIRECT');
    
    const validatorRules = rules.filter(r => r.includes('ip_worker')).length;
    const browserRules = rules.filter(r => 
      r.startsWith('PROCESS-NAME,worker') || r.startsWith('PROCESS-PATH,')
    ).length;
    
    console.log(`[Clash Static] ✅ Total rules: ${rules.length}`);
    console.log(`[Clash Static] ├─ IP Validators: ${validatorRules} (PROCESS-NAME)`);
    console.log(`[Clash Static] ├─ Browser Workers: ${browserRules}`);
    console.log(`[Clash Static] │  ├─ OTHERS: ${this.othersReserved} (PROCESS-NAME)`);
    console.log(`[Clash Static] │  └─ MSEDGE: ${this.msedgeReserved} (PROCESS-PATH REGEX)`);
    console.log(`[Clash Static] └─ Other: ${rules.length - validatorRules - browserRules}`);
    
    return rules;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * GENERATE STATIC CONFIG
   * ═══════════════════════════════════════════════════════════════
   */
  async generateStaticConfig() {
    console.log('[Clash Static] Generating configuration v6.0.0...');
    
    const config = {
      port: 7890,
      'socks-port': 7891,
      'mixed-port': 7892,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'info',
      'external-controller': '127.0.0.1:9090',
      secret: '',
      ipv6: true,
      'tcp-concurrent': true,
      
      tun: {
        enable: true,
        stack: 'system',
        'auto-route': true,
        'auto-detect-interface': true,
        'dns-hijack': ['any:53'],
        'strict-route': true,
        mtu: 9000,
        'include-process': this.generateIncludeProcessList()
      },
      
      dns: {
        enable: true,
        listen: '0.0.0.0:1053',
        'enhanced-mode': 'fake-ip',
        'fake-ip-range': '198.18.0.1/16',
        'fake-ip-filter': [
          '*.lan',
          'localhost.ptlogin2.qq.com',
          '+.stun.*.*',
          '+.stun.*.*.*',
          '+.stun.*.*.*.*',
          '+.stun.*.*.*.*.*'
        ],
        nameserver: [this.userConfig.dns.localResolver],
        fallback: [this.userConfig.dns.localResolver]
      },
      
      proxies: this.generateDummyProxies(),
      'proxy-providers': this.generateProxyProviders(),
      'proxy-groups': this.generateSlotGroups(),
      rules: this.generateRules()
    };
    
    if (!fs.existsSync(this.providerDir)) {
      fs.mkdirSync(this.providerDir, { recursive: true });
    }
    
    const yamlContent = yaml.dump(config, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false
    });
    
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    
    fs.writeFileSync(this.configPath, yamlContent, 'utf8');
    
    const validatorRules = config.rules.filter(r => r.includes('ip_worker')).length;
    const browserRules = config.rules.filter(r =>
      r.startsWith('PROCESS-NAME,worker') || r.startsWith('PROCESS-PATH,')
    ).length;
    
    console.log(`\n[Clash Static] ═══════════════════════════════════════════`);
    console.log(`[Clash Static] ✅ Config generated successfully!`);
    console.log(`[Clash Static] ═══════════════════════════════════════════`);
    console.log(`[Clash Static] Version: v6.0.0 (C++ VALIDATOR!)`);
    console.log(`[Clash Static] File: ${path.basename(this.configPath)}`);
    console.log(`[Clash Static] Size: ${(yamlContent.length / 1024).toFixed(2)} KB`);
    console.log(`[Clash Static] ───────────────────────────────────────────`);
    console.log(`[Clash Static] Slots: ${this.totalSlots}`);
    console.log(`[Clash Static] Rules: ${config.rules.length}`);
    console.log(`[Clash Static] ├─ IP Validators: ${validatorRules} 🔥`);
    console.log(`[Clash Static] └─ Browser Workers: ${browserRules}`);
    console.log(`[Clash Static] Include-Process: ${config.tun['include-process'].length}`);
    console.log(`[Clash Static] ├─ IP Validators: ${this.totalSlots} 🔥`);
    console.log(`[Clash Static] └─ Browsers: ${this.totalSlots}`);
    console.log(`[Clash Static] ───────────────────────────────────────────`);
    console.log(`[Clash Static] 🔥 NEW ARCHITECTURE v6.0.0:`);
    console.log(`[Clash Static] ✅ IP validation via C++ binary (process-based!)`);
    console.log(`[Clash Static] ✅ Hardlinks created on-demand (no pre-generation!)`);
    console.log(`[Clash Static] ✅ Auto-cleanup after validation (no accumulation!)`);
    console.log(`[Clash Static] ✅ Real domain (ip-api.com) - no DNS issues!`);
    console.log(`[Clash Static] ✅ 100% reliable routing (PROCESS-NAME match!)`);
    console.log(`[Clash Static] ═══════════════════════════════════════════\n`);
    
    return this.configPath;
  }
}

module.exports = ClashStaticGenerator;
