/**
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * STEALTH FONT MANAGER V7.1.0 - AIC COMPLIANT (COMPREHENSIVE FONT API HOOKS)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 * 
 * 🔥 CHANGELOG V7.1.0 (2026-02-16 15:33 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ AIC FIX: Comprehensive FontFaceSet API Hooks
 *    - Added document.fonts.size spoofing (return only allowed count)
 *    - Added document.fonts.has() intercept (return false for disallowed fonts)
 *    - Added document.fonts.forEach() iterator filter
 *    - Added document.fonts.values() iterator filter
 * 
 * ✅ AIC FIX: FontFace Constructor Intercept
 *    - Prevent dynamic font loading outside allowed list
 *    - throw error for disallowed font families
 * 
 * ✅ AIC FIX: REMOVED Duplicate Noise Logic
 *    - BEFORE: offsetWidth noise in stealth_font.js
 *    - AFTER:  Noise handled by stealth_patches.js (single source)
 *    - REASON: Avoid race condition with generateFontMetricNoiseScript
 * 
 * ✅ AIC FIX: Enhanced document.fonts.check
 *    - Better font family name extraction (quotes, variants)
 *    - Whitelist system fonts (serif, sans-serif, monospace, cursive, fantasy)
 *    - Deterministic behavior per persona
 * 
 * 🔥 CHANGELOG V7.0.0 (2026-02-14 17:00 WIB):
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * ✅ FEATURE: Architecture B Compliance (String-based Script Generation)
 * ✅ FEATURE: Database Integration (V7 Schemas)
 * ✅ FEATURE: Intelligent Persona Mapping
 * ✅ FEATURE: Font Masking Logic
 * 
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
 */

const { MongoClient } = require('mongodb');

class StealthFont {
  constructor(config = {}) {
    this.config = {
      mongoUri: config.mongoUri || 'mongodb://127.0.0.1:27017',
      dbName: config.dbName || 'quantumtraffic',
      fontDatabaseCollection: config.fontDatabaseCollection || 'font_database',
      fontPersonaCollection: config.fontPersonaCollection || 'font_persona',
      // Default weights if DB missing
      tierWeights: config.tierWeights || { 0: 50, 1: 30, 2: 12, 3: 5, 4: 2, 5: 1 }
    };

    this.client = null;
    this.db = null;
    this.fontDB = null;
    this.personaDB = null;
    this.isInitialized = false;
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async initialize() {
    if (this.isInitialized) return;

    console.log('[StealthFont] Initializing...');
    
    try {
      // Reuse connection if provided externally, else create new
      if (!this.client) {
        this.client = new MongoClient(this.config.mongoUri);
        await this.client.connect();
      }
      
      this.db = this.client.db(this.config.dbName);
      
      // Load entire Font Databases into memory (Performance Optimization)
      // These are relatively small (< 5MB), better cached than queried repeatedly
      const fontCollection = this.db.collection(this.config.fontDatabaseCollection);
      const personaCollection = this.db.collection(this.config.fontPersonaCollection);

      // Load Font Database (The list of fonts per pack)
      this.fontDB = await fontCollection.findOne({});
      if (!this.fontDB) {
        console.warn('[StealthFont] ⚠️ Font database empty/missing. Using minimal fallback.');
        this.fontDB = this._getFallbackFontDB();
      }

      // Load Persona Definitions (The rules for combining packs)
      this.personaDB = await personaCollection.findOne({});
      if (!this.personaDB) {
        console.warn('[StealthFont] ⚠️ Persona database empty/missing. Using minimal fallback.');
        this.personaDB = this._getFallbackPersonaDB();
      }

      this.isInitialized = true;
      console.log(`[StealthFont] Loaded ${Object.keys(this.fontDB).length} font database entries`);
      console.log(`[StealthFont] Loaded ${Object.keys(this.personaDB).length} font personas`);
      console.log('[StealthFont] Initialization complete');

    } catch (error) {
      console.error('[StealthFont] ❌ Initialization failed:', error.message);
      throw error;
    }
  }

  async close() {
    // Only close if we created the client specifically
    if (this.client) {
      // Logic handled by main connection manager usually, but good practice
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // LOGIC: PERSONA SELECTION
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  
  /**
   * Generates a Font Profile based on Hardware capabilities
   * @param {Object} hardware - The hardware profile object from DB
   * @param {Object} fp - The full fingerprint (optional context)
   * @returns {Object} { persona: string, packs: string[], os: string }
   */
  generateFontProfile(hardware, fp = {}) {
    if (!this.isInitialized) throw new Error('StealthFont not initialized');

    // 1. Determine OS context
    let osKey = 'windows';
    const osName = hardware.os || 'windows';
    if (osName.toLowerCase().includes('mac') || osName.toLowerCase().includes('darwin')) osKey = 'macos';
    if (osName.toLowerCase().includes('linux')) osKey = 'linux';

    // 2. Determine Tier Context
    // Map numerical tier to string key used in JSON (tier_0, tier_1_2, tier_3_plus)
    const tier = hardware.population?.tier || 0;
    let tierKey = 'tier_0';
    if (tier === 1 || tier === 2) tierKey = 'tier_1_2';
    if (tier >= 3) tierKey = 'tier_3_plus';

    // 3. Get Available Personas for this OS & Tier
    const osPersonas = this.personaDB[osKey];
    if (!osPersonas) {
      console.warn(`[StealthFont] No personas for OS: ${osKey}. Fallback to Windows.`);
      osKey = 'windows';
    }
    
    const tierPersonas = this.personaDB[osKey]?.[tierKey] || this.personaDB[osKey]?.['tier_0'];
    
    if (!tierPersonas) {
      // Ultimate fallback
      return { 
        persona: 'FALLBACK_CLEAN', 
        packs: ['base'], 
        os: osKey 
      };
    }

    // 4. Weighted Random Selection
    const selectedPersonaKey = this._weightedSelect(tierPersonas);
    const selectedPersona = tierPersonas[selectedPersonaKey];

    return {
      persona: selectedPersonaKey,
      packs: selectedPersona.packs || ['base'],
      os: osKey,
      description: selectedPersona.description
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // LOGIC: FONT LIST BUILDING
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * compiles the final list of fonts from the selected packs
   * @param {Object} fontProfile - Result from generateFontProfile
   * @returns {string[]} Array of font family names
   */
  buildFontList(fontProfile) {
    const { os, packs } = fontProfile;
    const fontSet = new Set();

    // Iterate packs and add fonts
    packs.forEach(packName => {
      const packData = this.fontDB[os]?.[packName];
      if (packData && Array.isArray(packData.fonts)) {
        packData.fonts.forEach(font => fontSet.add(font));
      } else {
        // Safe fallback for missing packs
        if (packName === 'base' && this.fontDB['windows']?.['base']) {
           this.fontDB['windows']['base'].fonts.forEach(f => fontSet.add(f));
        }
      }
    });

    return Array.from(fontSet).sort();
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ARCHITECTURE B: SCRIPT GENERATION (v7.1.0 - AIC COMPLIANT)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

  /**
   * Generates the JS string to be injected into the browser
   * @param {Object} fontData - Object with { persona, list, os, description }
   * @returns {string} JavaScript code string
   */
  generateFontInjectionScript(fontData) {
    // Accept either fontProfile (old) or fontData (new from opsi4.js)
    const fontList = fontData.list || this.buildFontList(fontData);
    const persona = fontData.persona || 'UNKNOWN';
    
    // Performance protection: Don't inject huge array if list is absurdly long
    // (Real personas usually have 50-300 fonts)
    const safeFontList = fontList.slice(0, 500); 

    return `
(function() {
  'use strict';
  
  try {
    // ═════════════════════════════════════════════════════════════════════════════════
    // ALLOWED FONTS (PERSONA: ${persona})
    // ═════════════════════════════════════════════════════════════════════════════════
    const allowedFonts = new Set(${JSON.stringify(safeFontList)});
    
    // System generic families (must ALWAYS be allowed or rendering breaks)
    const systemGenerics = new Set([
      'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
      'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'
    ]);
    
    // Helper: Extract font family from CSS font string
    const extractFontFamily = (fontString) => {
      // Input: "12px 'Arial'", "bold 10px Roboto", "italic 14pt 'Times New Roman'"
      // Extract quoted or unquoted family name
      const match = fontString.match(/['"]([^'"]+)['"]|\\b([A-Za-z][A-Za-z0-9\\s-]+)$/);
      return match ? (match[1] || match[2]).trim() : '';
    };
    
    // Helper: Check if font is allowed
    const isFontAllowed = (fontFamily) => {
      const family = fontFamily.toLowerCase().trim();
      
      // 1. Allow system generics
      if (systemGenerics.has(family)) return true;
      
      // 2. Check against allowed list (case-insensitive)
      for (const allowed of allowedFonts) {
        if (allowed.toLowerCase() === family) return true;
      }
      
      return false;
    };
    
    // ═════════════════════════════════════════════════════════════════════════════════
    // ✅ AIC v7.1.0: COMPREHENSIVE FONT API HOOKS
    // ═════════════════════════════════════════════════════════════════════════════════
    
    // ────────────────────────────────────────────────────────────────────────────────
    // 1. document.fonts.check() - Primary detection API
    // ────────────────────────────────────────────────────────────────────────────────
    if (document.fonts && document.fonts.check) {
      const originalCheck = document.fonts.check.bind(document.fonts);
      
      Object.defineProperty(document.fonts, 'check', {
        value: function(font, text) {
          try {
            const fontFamily = extractFontFamily(font);
            
            // If font NOT in allowed list, return false (hide it)
            if (fontFamily && !isFontAllowed(fontFamily)) {
              return false;
            }
            
            // If allowed, defer to browser (might still be missing, which is fine)
            return originalCheck(font, text);
            
          } catch (e) {
            return originalCheck(font, text);
          }
        },
        configurable: true,
        writable: false
      });
      
      // Protect toString
      Object.defineProperty(document.fonts.check, 'toString', {
        value: function() { return 'function check() { [native code] }'; },
        configurable: false
      });
    }
    
    // ────────────────────────────────────────────────────────────────────────────────
    // ✅ AIC v7.1.0: 2. document.fonts.size - Return only allowed font count
    // ────────────────────────────────────────────────────────────────────────────────
    if (document.fonts) {
      try {
        // Get original size once (might change after fonts load)
        const originalSize = document.fonts.size || 0;
        
        Object.defineProperty(document.fonts, 'size', {
          get: function() {
            // Return count of allowed fonts only
            // In reality, browser might have more loaded, but we hide them
            return allowedFonts.size;
          },
          configurable: true
        });
      } catch(e) {}
    }
    
    // ────────────────────────────────────────────────────────────────────────────────
    // ✅ AIC v7.1.0: 3. document.fonts.has() - Intercept font existence check
    // ────────────────────────────────────────────────────────────────────────────────
    if (document.fonts && document.fonts.has) {
      const originalHas = document.fonts.has.bind(document.fonts);
      
      document.fonts.has = function(fontFace) {
        try {
          // Check if this FontFace family is allowed
          if (fontFace && fontFace.family) {
            if (!isFontAllowed(fontFace.family)) {
              return false; // Hide disallowed fonts
            }
          }
          return originalHas(fontFace);
        } catch(e) {
          return originalHas(fontFace);
        }
      };
      
      Object.defineProperty(document.fonts.has, 'toString', {
        value: function() { return 'function has() { [native code] }'; }
      });
    }
    
    // ────────────────────────────────────────────────────────────────────────────────
    // ✅ AIC v7.1.0: 4. document.fonts.forEach() - Filter iteration
    // ────────────────────────────────────────────────────────────────────────────────
    if (document.fonts && document.fonts.forEach) {
      const originalForEach = document.fonts.forEach.bind(document.fonts);
      
      document.fonts.forEach = function(callback, thisArg) {
        // Wrap callback to filter out disallowed fonts
        const wrappedCallback = function(fontFace, fontFace2, set) {
          if (fontFace && fontFace.family && isFontAllowed(fontFace.family)) {
            callback.call(thisArg, fontFace, fontFace2, set);
          }
        };
        return originalForEach(wrappedCallback, thisArg);
      };
      
      Object.defineProperty(document.fonts.forEach, 'toString', {
        value: function() { return 'function forEach() { [native code] }'; }
      });
    }
    
    // ────────────────────────────────────────────────────────────────────────────────
    // ✅ AIC v7.1.0: 5. document.fonts.values() - Filter iterator
    // ────────────────────────────────────────────────────────────────────────────────
    if (document.fonts && document.fonts.values) {
      const originalValues = document.fonts.values.bind(document.fonts);
      
      document.fonts.values = function() {
        const iterator = originalValues();
        const originalNext = iterator.next.bind(iterator);
        
        // Wrap iterator to skip disallowed fonts
        iterator.next = function() {
          let result = originalNext();
          while (!result.done && result.value && result.value.family && !isFontAllowed(result.value.family)) {
            result = originalNext();
          }
          return result;
        };
        
        return iterator;
      };
      
      Object.defineProperty(document.fonts.values, 'toString', {
        value: function() { return 'function values() { [native code] }'; }
      });
    }
    
    // ────────────────────────────────────────────────────────────────────────────────
    // ✅ AIC v7.1.0: 6. FontFace Constructor Intercept
    // ────────────────────────────────────────────────────────────────────────────────
    if (window.FontFace) {
      const OriginalFontFace = window.FontFace;
      
      window.FontFace = function(family, source, descriptors) {
        // Check if font family is allowed before construction
        if (family && !isFontAllowed(family)) {
          // Option A: Throw error (strict)
          // throw new DOMException(\`Font family '\${family}' is not available\`, 'NotFoundError');
          
          // Option B: Silent fail (return dummy - safer for compatibility)
          console.warn(\`[StealthFont] Blocked dynamic font load: \${family}\`);
          // Return minimal valid FontFace that won't load
          return new OriginalFontFace('serif', 'local(serif)', descriptors);
        }
        
        return new OriginalFontFace(family, source, descriptors);
      };
      
      // Preserve prototype
      window.FontFace.prototype = OriginalFontFace.prototype;
      
      // Protect toString
      Object.defineProperty(window.FontFace, 'toString', {
        value: function() { return 'function FontFace() { [native code] }'; }
      });
    }
    
    // ═════════════════════════════════════════════════════════════════════════════════
    // ✅ v7.1.0: REMOVED DUPLICATE NOISE LOGIC
    // ═════════════════════════════════════════════════════════════════════════════════
    // BEFORE: offsetWidth/offsetHeight noise here
    // AFTER:  Noise handled by stealth_patches.js → generateFontMetricNoiseScript()
    // REASON: Avoid race condition and double override
    // Single source of truth: stealth_patches.js for ALL metric spoofing
    
    console.log('[StealthFont] ✅ Font Persona Injected (${persona}, ${safeFontList.length} fonts)');
    console.log('[StealthFont] ✅ FontFaceSet API hooks active (check, size, has, forEach, values)');
    console.log('[StealthFont] ✅ FontFace constructor intercept active');

  } catch (e) {
    console.warn('[StealthFont] ⚠️ Font injection failed:', e.message);
  }
})();
    `.trim();
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

  _weightedSelect(items) {
    // Calculate total weight
    let totalWeight = 0;
    const keys = Object.keys(items);
    
    keys.forEach(key => {
      totalWeight += items[key].weight || 0;
    });

    let random = Math.random() * totalWeight;
    
    for (const key of keys) {
      const weight = items[key].weight || 0;
      if (random < weight) {
        return key;
      }
      random -= weight;
    }
    
    return keys[0];
  }

  _getFallbackFontDB() {
    return {
      windows: { base: { fonts: ['Arial', 'Times New Roman', 'Segoe UI', 'Verdana', 'Tahoma', 'Calibri'] } },
      macos: { base: { fonts: ['Helvetica Neue', 'San Francisco', 'Arial', 'Times', 'Courier'] } },
      linux: { base: { fonts: ['Ubuntu', 'Liberation Sans', 'DejaVu Sans', 'Noto Sans'] } }
    };
  }

  _getFallbackPersonaDB() {
    return {
      windows: { tier_0: { CLEAN: { weight: 1, packs: ['base'], description: 'Minimal Windows fonts' } } },
      macos: { tier_0: { CLEAN: { weight: 1, packs: ['base'], description: 'Minimal macOS fonts' } } },
      linux: { tier_0: { CLEAN: { weight: 1, packs: ['base'], description: 'Minimal Linux fonts' } } }
    };
  }
}

module.exports = StealthFont;

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// END OF stealth_font.js v7.1.0 - AIC COMPLIANT
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
