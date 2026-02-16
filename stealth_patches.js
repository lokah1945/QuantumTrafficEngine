/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * stealth_patches.js v8.4.1 - AIC COMPLIANT (Screen Override Protection)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 🔥 CHANGELOG v8.4.1 (2026-02-16 15:20 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ AIC FIX: Screen patch now DETECTION-ONLY (no override when native correct)
 *    - Added verification: if native screen matches FP, skip JS override
 *    - REASON: Playwright native emulation already set correct screen values
 *    - IMPACT: Eliminates double-override race condition for screen
 *    - RESULT: screen.width/height from Playwright native (not JS patch)
 * 
 * ✅ AIC FIX: Enhanced logging for screen strategy decision
 *    - Console logs whether using native or override strategy
 *    - Helps debugging screen value mismatches
 * 
 * 🔥 CHANGELOG v8.4.0 (2026-02-16 14:31 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ AIC PRIORITY A: HTML lang attribute sync (Priority 0 - DOM coherence)
 * ✅ AIC PRIORITY A: navigator.webdriver DELETE (not false) + fallback verify
 * ✅ AIC PRIORITY A: Permissions 'prompt' + PermissionStatus prototype preservation
 * ✅ AIC PRIORITY A: REMOVED window chrome hardcode (70px, 16px constants)
 * ✅ AIC PRIORITY A: Screen patch comprehensive (outerWidth/outerHeight native-aware)
 * ✅ AIC PRIORITY B: Font metric layer (offsetHeight, getBoundingClientRect, measureText)
 * ✅ AIC PRIORITY B: WebGL getSupportedExtensions + comprehensive parameters
 * ✅ AIC PRIORITY B: Plugin array structural (item/namedItem/refresh methods)
 * ✅ PRODUCTION: Single source of truth (NO double hardware override)
 * ✅ RESULT: 93-96% BrowserScan target, persona coherence enforced
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════
function validateFingerprint(fp) {
  const result = { valid: true, warnings: [], errors: [] };
  
  if (!fp.hardware) result.warnings.push('fp.hardware is missing');
  if (!fp.webgl || !fp.webgl.parameters) result.warnings.push('fp.webgl.parameters is missing');
  if (!['chromium', 'gecko', 'webkit'].includes(fp.engine)) {
    result.warnings.push(`Unknown engine: ${fp.engine} (Defaulting to chromium logic)`);
  }
  if (!fp.browserName) {
    result.errors.push('fp.browserName is REQUIRED');
    result.valid = false;
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILS (Injected into Browser)
// ═══════════════════════════════════════════════════════════════════════════════
const STEALTH_UTILS = `
const utils = {
  patchToString: (fn, name) => {
    try {
      Object.defineProperty(fn, 'name', { value: name || fn.name, configurable: true });
      Object.defineProperty(fn, 'toString', {
        value: function() { return 'function ' + (name || fn.name) + '() { [native code] }'; },
        configurable: true,
        enumerable: false
      });
    } catch(e) {}
  },
  patchProperty: (obj, prop, value) => {
    try {
      Object.defineProperty(obj, prop, {
        get: function() { return value; },
        set: undefined,
        enumerable: true,
        configurable: true
      });
    } catch(e) {}
  }
};
`;

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 0: HTML LANG ATTRIBUTE (AIC: DOM COHERENCE - MUST BE FIRST!)
// ═══════════════════════════════════════════════════════════════════════════════
function generateHTMLLangScript(fp) {
  const locale = fp.locale || 'en-US';
  
  return `
(function() {
  'use strict';
  
  const targetLang = '${locale}';
  
  // Strategy 1: Immediate set (if document exists)
  const setLang = () => {
    if (document.documentElement) {
      document.documentElement.setAttribute('lang', targetLang);
      return true;
    }
    return false;
  };
  
  // Try immediate
  if (setLang()) return;
  
  // Strategy 2: MutationObserver (for early document creation)
  const observer = new MutationObserver(() => {
    if (setLang()) {
      observer.disconnect();
    }
  });
  
  try {
    observer.observe(document, {
      childList: true,
      subtree: false
    });
  } catch(e) {}
  
  // Strategy 3: Event backup
  const onReady = () => setLang();
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBRTC (v8.3.0 - OPSI C: DISABLED INJECTION)
// ═══════════════════════════════════════════════════════════════════════════════
function generateWebRTCScript(fp) {
  // v8.3.0 OPSI C: Let browser handle natural fallback (UDP → TCP)
  // No synthetic injection needed
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 1: WEBGL (MUST BE FIRST - BEFORE CONTEXT CREATION) + AIC ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════
function generateWebGLDeepScript(fp) {
  const webgl = fp.webgl || {};
  const vendor = webgl.vendor || 'Google Inc. (NVIDIA)';
  const renderer = webgl.renderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const extensions = webgl.extensions || [];
  const params = webgl.parameters || {};
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const config = {
      vendor: '${vendor}',
      renderer: '${renderer}',
      params: ${JSON.stringify(params)},
      extensions: ${JSON.stringify(extensions)}
    };
    
    const overrideWebGL = (contextType) => {
      const proto = window[contextType].prototype;
      
      // ✅ AIC: Comprehensive getParameter override
      const originalGetParameter = proto.getParameter;
      proto.getParameter = function(parameter) {
        // Vendor/Renderer (primary)
        if (parameter === 37445) return config.vendor;  // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return config.renderer; // UNMASKED_RENDERER_WEBGL
        if (parameter === 7936) return config.vendor;    // VENDOR
        if (parameter === 7937) return config.renderer;  // RENDERER
        
        // ✅ AIC: Additional parameters from config
        if (config.params[parameter] !== undefined) {
          return config.params[parameter];
        }
        
        return originalGetParameter.apply(this, arguments);
      };
      utils.patchToString(proto.getParameter, 'getParameter');
      
      // ✅ AIC: Deep Extension Override (v7.6.0 implementation - safer)
      const originalGetExtension = proto.getExtension;
      proto.getExtension = function(name) {
        const ext = originalGetExtension.apply(this, arguments);
        if (name === 'WEBGL_debug_renderer_info' && ext) {
          // Create COPY instead of modifying original (safer)
          const fakeExt = Object.create(Object.getPrototypeOf(ext));
          for (const key in ext) fakeExt[key] = ext[key];
          fakeExt.UNMASKED_VENDOR_WEBGL = 37445;
          fakeExt.UNMASKED_RENDERER_WEBGL = 37446;
          return fakeExt;
        }
        return ext;
      };
      utils.patchToString(proto.getExtension, 'getExtension');
      
      // ✅ AIC PRIORITY B: getSupportedExtensions override
      const originalGetSupportedExtensions = proto.getSupportedExtensions;
      proto.getSupportedExtensions = function() {
        // If config has explicit extension list, use it
        if (config.extensions && config.extensions.length > 0) {
          return config.extensions.slice(); // Return copy
        }
        // Otherwise, fallback to native
        return originalGetSupportedExtensions.apply(this, arguments);
      };
      utils.patchToString(proto.getSupportedExtensions, 'getSupportedExtensions');
    };
    
    if (window.WebGLRenderingContext) overrideWebGL('WebGLRenderingContext');
    if (window.WebGL2RenderingContext) overrideWebGL('WebGL2RenderingContext');
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 2: HARDWARE (BEFORE NAVIGATOR QUERIES) - SINGLE SOURCE ONLY
// ═══════════════════════════════════════════════════════════════════════════════
function generateHardwareConcurrencyScript(fp) {
  const targetCores = fp.hardware?.cores || 4;
  
  return `(function(){
${STEALTH_UTILS}
try {
  utils.patchProperty(Navigator.prototype, 'hardwareConcurrency', ${targetCores});
} catch(e) {}
})();`;
}

function generateDeviceMemoryScript(fp) {
  if (fp.engine !== 'chromium') return '';
  
  const targetMemory = fp.hardware?.memory || 8;
  
  return `(function(){
${STEALTH_UTILS}
try {
  utils.patchProperty(Navigator.prototype, 'deviceMemory', ${targetMemory});
} catch(e) {}
})();`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 3: SCREEN (AIC v8.4.1: DETECTION-ONLY IF NATIVE CORRECT)
// ═══════════════════════════════════════════════════════════════════════════════
function generateScreenScript(fp) {
  const width = fp.screen?.width || fp.viewport?.width || 1920;
  const height = fp.screen?.height || fp.viewport?.height || 1080;
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const target = {
      width: ${width},
      height: ${height},
      availWidth: ${width},
      availHeight: ${height - 40}
    };
    
    // ✅ AIC v8.4.1: Check if Playwright native emulation already set correct values
    const nativeCorrect = (
      screen.width === target.width &&
      screen.height === target.height
    );
    
    if (nativeCorrect) {
      // Playwright native emulation already correct - no override needed
      console.log('[Stealth] Screen: Using Playwright native emulation (correct)');
      return;
    }
    
    // If native values incorrect, apply JS override
    console.log('[Stealth] Screen: Applying JS override (native mismatch)');
    
    const props = {
      width: target.width,
      height: target.height,
      availWidth: target.availWidth,
      availHeight: target.availHeight,
      colorDepth: 24,
      pixelDepth: 24
    };
    
    for (const [key, value] of Object.entries(props)) {
      utils.patchProperty(Screen.prototype, key, value);
    }
  } catch (e) {}
})();
  `.trim();
}

// ✅ AIC: REMOVED WINDOW CHROME HARDCODE - Use deterministic noise only
function generateWindowNoiseScript(fp) {
  const seed = fp._id || 'win-seed';
  
  return `
(function() {
  'use strict';
  
  try {
    const getNoise = (salt, range) => {
      let hash = 0;
      const str = '${seed}' + salt;
      for (let i = 0; i < str.length; i++) hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
      return (Math.abs(hash) % (range * 2 + 1)) - range;
    };
    
    // ✅ AIC: REMOVED hardcoded +16 and +70 (over-deterministic)
    // Let browser decide chrome size (natural variation per OS/theme)
    // Only add small persona-specific noise
    const noiseW = getNoise('w', 2);
    const noiseH = getNoise('h', 2);
    const fakeX = Math.abs(getNoise('x', 20));
    const fakeY = Math.abs(getNoise('y', 20));
    
    // outerWidth/outerHeight: Let native browser chrome + small noise
    // This creates natural variation (Windows theme, Linux DE, macOS style)
    Object.defineProperty(window, 'outerWidth', { 
      get: () => window.innerWidth + noiseW, 
      configurable: true 
    });
    Object.defineProperty(window, 'outerHeight', { 
      get: () => window.innerHeight + noiseH, 
      configurable: true 
    });
    
    // screenX/Y: Deterministic but varied per persona
    Object.defineProperty(window, 'screenX', { get: () => fakeX, configurable: true });
    Object.defineProperty(window, 'screenY', { get: () => fakeY, configurable: true });
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 4: NAVIGATOR (BEFORE AUTOMATION CHECKS) + AIC WEBDRIVER FIX
// ═══════════════════════════════════════════════════════════════════════════════
function generateNavigatorScript(fp) {
  const engine = fp.engine || 'chromium';
  const nav = fp.navigator || {};
  const props = {
    platform: nav.platform || 'Win32',
    language: fp.locale || 'en-US',
    languages: [fp.locale || 'en-US', 'en'],
    maxTouchPoints: 0,
    vendor: engine === 'webkit' ? "Apple Computer, Inc." : (engine === 'gecko' ? "" : "Google Inc."),
    productSub: engine === 'gecko' ? "20100101" : "20030107"
  };
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const props = ${JSON.stringify(props)};
    for (const [key, value] of Object.entries(props)) {
      utils.patchProperty(Navigator.prototype, key, value);
    }
  } catch (e) {}
})();`.trim();
}

// ✅ AIC PRIORITY A: navigator.webdriver DELETE (not false) + fallback verify
function generateWebdriverCleanupScript() {
  return `(function(){
try {
  // PRIMARY: Delete from prototype (most reliable)
  delete Navigator.prototype.webdriver;
  
  // SECONDARY: Delete from instance (backup)
  delete navigator.webdriver;
  
  // ✅ AIC: Fallback verify - if delete failed, redefine as undefined getter
  const stillExists = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
  if (stillExists) {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
      enumerable: true
    });
  }
  
  // TERTIARY: Remove ChromeDriver artifacts
  const cdcProps = [
    'cdc_adoQpoasnfa76pfcZLmcfl_Array',
    'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
    'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    'cdc_adoQpoasnfa76pfcZLmcfl_Object'
  ];
  
  cdcProps.forEach(prop => {
    try { delete window[prop]; } catch(e) {}
  });
  
  // QUATERNARY: Remove Playwright artifacts
  const pwProps = [
    '__playwright',
    '__pw_manual',
    '__PW_inspect',
    '__playwright_evaluation_script__'
  ];
  
  pwProps.forEach(prop => {
    try { delete window[prop]; } catch(e) {}
  });
  
} catch(e) {}
})();`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 5: BROWSER-SPECIFIC + AIC ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════
function generateChromeObjectScript(fp) {
  if (fp.engine === 'chromium') {
    return `(function(){try{if(!window.chrome)window.chrome={};if(!window.chrome.runtime)window.chrome.runtime={connect:()=>{},sendMessage:()=>{},onMessage:{addListener:()=>{}}};}catch(e){}})();`;
  }
  return '';
}

// ✅ AIC PRIORITY B: Plugin array structural (item/namedItem/refresh methods)
function generatePluginsScript(fp) {
  const engine = fp.engine || 'chromium';
  
  // Firefox modern: No plugins
  if (engine === 'gecko') {
    return `(function(){
try {
  const emptyPlugins = Object.create(null);
  emptyPlugins.length = 0;
  emptyPlugins.item = function(index) { return null; };
  emptyPlugins.namedItem = function(name) { return null; };
  emptyPlugins.refresh = function() {};
  
  try {
    Object.setPrototypeOf(emptyPlugins, PluginArray.prototype || Object.prototype);
  } catch(e) {}
  
  Object.defineProperty(navigator, 'plugins', {
    get: () => emptyPlugins,
    enumerable: true,
    configurable: true
  });
} catch(e) {}
})();`;
  }
  
  // Chromium: Minimal PDF Viewer (internal)
  return `(function(){
try {
  // Minimal but structurally valid plugin
  const pdfPlugin = {
    name: 'PDF Viewer',
    description: 'Portable Document Format',
    filename: 'internal-pdf-viewer'
  };
  
  // ✅ AIC: Remove length from plugin object (not natural)
  // length only belongs to PluginArray, not individual Plugin
  
  // Add required methods to plugin
  pdfPlugin.item = function(index) {
    return index === 0 ? this : null;
  };
  pdfPlugin.namedItem = function(name) {
    return name === 'PDF Viewer' ? this : null;
  };
  
  // Create plugin array with required methods
  const pluginArray = Object.create(null);
  pluginArray.length = 1;
  pluginArray[0] = pdfPlugin;
  
  pluginArray.item = function(index) {
    return index === 0 ? pdfPlugin : null;
  };
  pluginArray.namedItem = function(name) {
    return name === 'PDF Viewer' ? pdfPlugin : null;
  };
  pluginArray.refresh = function() {};
  
  // Set prototype if available
  try {
    Object.setPrototypeOf(pluginArray, PluginArray.prototype);
  } catch(e) {}
  
  Object.defineProperty(navigator, 'plugins', {
    get: () => pluginArray,
    enumerable: true,
    configurable: true
  });
} catch(e) {}
})();`;
}

// ✅ AIC PRIORITY A: Permissions 'prompt' + PermissionStatus prototype preservation
function generatePermissionsScript() {
  return `(function(){
try {
  if (!navigator.permissions || !navigator.permissions.query) return;
  
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);
  
  // Permissions that require user gesture
  const gestureRequired = new Set([
    'notifications',
    'geolocation',
    'microphone',
    'camera',
    'midi'
  ]);
  
  navigator.permissions.query = function(params) {
    // Natural behavior: prompt until user interaction
    if (params && gestureRequired.has(params.name)) {
      // ✅ AIC: Preserve PermissionStatus prototype if available
      const result = {
        state: 'prompt',
        onchange: null
      };
      
      // Try to match native prototype
      try {
        if (window.PermissionStatus) {
          Object.setPrototypeOf(result, PermissionStatus.prototype);
        }
      } catch(e) {}
      
      return Promise.resolve(result);
    }
    
    // Other permissions: use native behavior
    return originalQuery(params);
  };
  
  // Native string protection
  const descriptor = Object.getOwnPropertyDescriptor(
    navigator.permissions.query, 
    'toString'
  );
  
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(navigator.permissions.query, 'toString', {
      value: function() { 
        return 'function query() { [native code] }'; 
      },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
  
} catch(e) {}
})();`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 6: FINGERPRINT NOISE + AIC FONT METRIC LAYER
// ═══════════════════════════════════════════════════════════════════════════════
function generateCanvasNoiseScript(fp) {
  const seed = fp._id || 'canvas-seed';
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const seed = '${seed}';
    const shift = 0.0001;
    
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
      const imageData = originalGetImageData.apply(this, arguments);
      if (imageData.data.length > 0) imageData.data[0] = imageData.data[0] + 1;
      return imageData;
    };
    utils.patchToString(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');
    
    // ✅ AIC PRIORITY B: Canvas measureText (font metric fingerprinting)
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      const metrics = originalMeasureText.apply(this, arguments);
      
      // Apply deterministic noise to width (5% chance, ±0.1px)
      if (text && text.length > 5 && Math.random() < 0.05) {
        const noise = (Math.random() > 0.5 ? 0.1 : -0.1);
        Object.defineProperty(metrics, 'width', {
          value: metrics.width + noise,
          writable: false,
          configurable: true
        });
      }
      
      return metrics;
    };
    utils.patchToString(CanvasRenderingContext2D.prototype.measureText, 'measureText');
  } catch (e) {}
})();
  `.trim();
}

// ✅ AIC PRIORITY B: Font Metric Layer (offsetHeight, getBoundingClientRect)
function generateFontMetricNoiseScript(fp) {
  const seed = fp._id || 'font-seed';
  
  return `
(function() {
  'use strict';
  
  try {
    const seed = '${seed}';
    
    // Deterministic noise generator per element
    const getElementNoise = (element, property) => {
      let hash = 0;
      const str = seed + property + (element.tagName || '') + (element.className || '');
      for (let i = 0; i < str.length; i++) {
        hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
      }
      // 5% chance to add ±1 pixel
      return (Math.abs(hash) % 100) < 5 ? ((hash % 2) ? 1 : -1) : 0;
    };
    
    // ✅ AIC: offsetWidth/offsetHeight (font metric fingerprinting)
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    if (widthDescriptor && widthDescriptor.get) {
      const originalGetWidth = widthDescriptor.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        get: function() {
          const width = originalGetWidth.apply(this, arguments);
          
          // Only apply noise if element looks like font probe
          // Heuristic: large fontSize or specific probe text
          if (this.style && this.style.fontSize && this.innerText && this.innerText.length > 5) {
            return width + getElementNoise(this, 'width');
          }
          
          return width;
        },
        configurable: true
      });
    }
    
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    if (heightDescriptor && heightDescriptor.get) {
      const originalGetHeight = heightDescriptor.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        get: function() {
          const height = originalGetHeight.apply(this, arguments);
          
          if (this.style && this.style.fontSize && this.innerText && this.innerText.length > 5) {
            return height + getElementNoise(this, 'height');
          }
          
          return height;
        },
        configurable: true
      });
    }
    
    // ✅ AIC: getBoundingClientRect (font metric fingerprinting)
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      const rect = originalGetBoundingClientRect.apply(this, arguments);
      
      // Only apply noise to text elements with font probing characteristics
      if (this.innerText && this.innerText.length > 5 && this.style && this.style.fontSize) {
        const noiseW = getElementNoise(this, 'rectW');
        const noiseH = getElementNoise(this, 'rectH');
        
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width + noiseW,
          height: rect.height + noiseH,
          top: rect.top,
          right: rect.right + noiseW,
          bottom: rect.bottom + noiseH,
          left: rect.left,
          toJSON: rect.toJSON
        };
      }
      
      return rect;
    };
    
    // Protect toString
    Object.defineProperty(Element.prototype.getBoundingClientRect, 'toString', {
      value: function() { return 'function getBoundingClientRect() { [native code] }'; },
      configurable: true
    });
  } catch (e) {}
})();
  `.trim();
}

function generateAudioNoiseScript(fp) {
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const originalGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(channel) {
      const data = originalGetChannelData.apply(this, arguments);
      data[0] += 0.0000001;
      return data;
    };
    utils.patchToString(AudioBuffer.prototype.getChannelData, 'getChannelData');
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 7: EXTRAS
// ═══════════════════════════════════════════════════════════════════════════════
function generateTimezoneScript(fp) {
  const offset = fp.timezoneOffset !== undefined ? fp.timezoneOffset : 0;
  
  return `
(function() {
  'use strict';
  
  try {
    const targetOffset = ${offset};
    const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() { return targetOffset; };
    
    // Protection
    Object.defineProperty(Date.prototype.getTimezoneOffset, 'name', { value: 'getTimezoneOffset' });
    Object.defineProperty(Date.prototype.getTimezoneOffset, 'toString', {
      value: function() { return 'function getTimezoneOffset() { [native code] }'; }
    });
  } catch (e) {}
})();
  `.trim();
}

function generateBatteryScript(fp) {
  const isLaptop = fp._meta?.tier >= 2 || fp.browserName === 'Safari' || fp.browserName === 'Edge';
  let batteryData;
  
  if (!isLaptop) {
    batteryData = { charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0 };
  } else {
    const level = parseFloat((Math.random() * (0.92 - 0.35) + 0.35).toFixed(2));
    const isCharging = Math.random() < 0.65;
    batteryData = {
      charging: isCharging,
      chargingTime: isCharging ? Math.floor(Math.random() * 2400) + 600 : Infinity,
      dischargingTime: isCharging ? Infinity : Math.floor(Math.random() * 8000) + 1200,
      level: level
    };
  }
  
  return `
(function() {
  'use strict';
  
  try {
    if (navigator.getBattery) {
      const data = ${JSON.stringify(batteryData)};
      const battery = {
        ...data,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null
      };
      const getBattery = () => Promise.resolve(battery);
      navigator.getBattery = getBattery;
      
      // String Protection
      Object.defineProperty(navigator.getBattery, 'name', { value: 'getBattery' });
      Object.defineProperty(navigator.getBattery, 'toString', {
        value: function() { return 'function getBattery() { [native code] }'; }
      });
    }
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR v8.4.1 - AIC COMPLIANT (SCREEN DETECTION-ONLY)
// ═══════════════════════════════════════════════════════════════════════════════
async function generateAllScripts(fp) {
  const validation = validateFingerprint(fp);
  const scripts = [];
  
  try {
    console.log('[StealthPatches] 📜 Generating v8.4.1 (AIC Compliant - Screen Detection)...');
    
    // ⭐ PRIORITY 0: HTML lang (MUST BE FIRST - DOM coherence)
    scripts.push(generateHTMLLangScript(fp));
    console.log('[StealthPatches] ✅ HTML lang script (Priority 0 - DOM coherence)');
    
    // PRIORITY 1: WEBGL (must override BEFORE context creation)
    scripts.push(generateWebGLDeepScript(fp));
    console.log('[StealthPatches] ✅ WebGL script (Priority 1 - comprehensive)');
    
    // PRIORITY 2: HARDWARE (before navigator queries)
    // ✅ SINGLE SOURCE ONLY (no double override from BrowserLauncher)
    scripts.push(generateHardwareConcurrencyScript(fp));
    scripts.push(generateDeviceMemoryScript(fp));
    console.log('[StealthPatches] ✅ Hardware scripts (Priority 2 - single source)');
    
    // PRIORITY 3: SCREEN (before layout calculations)
    // ✅ v8.4.1: Detection-only if native correct
    scripts.push(generateScreenScript(fp));
    scripts.push(generateWindowNoiseScript(fp));
    console.log('[StealthPatches] ✅ Screen scripts (Priority 3 - detection-only mode)');
    
    // PRIORITY 4: NAVIGATOR (before automation checks)
    scripts.push(generateNavigatorScript(fp));
    scripts.push(generateWebdriverCleanupScript());
    console.log('[StealthPatches] ✅ Navigator scripts (Priority 4 - webdriver ABSENT)');
    
    // PRIORITY 5: BROWSER-SPECIFIC
    scripts.push(generatePermissionsScript());
    scripts.push(generateChromeObjectScript(fp));
    scripts.push(generatePluginsScript(fp));
    console.log('[StealthPatches] ✅ Browser-specific scripts (Priority 5 - structural)');
    
    // PRIORITY 6: FINGERPRINT NOISE + FONT METRICS
    scripts.push(generateCanvasNoiseScript(fp));
    scripts.push(generateFontMetricNoiseScript(fp)); // ✅ AIC: Font metric layer
    scripts.push(generateAudioNoiseScript(fp));
    console.log('[StealthPatches] ✅ Noise + Font Metric scripts (Priority 6 - AIC layer)');
    
    // PRIORITY 7: EXTRAS
    scripts.push(generateTimezoneScript(fp));
    scripts.push(generateBatteryScript(fp));
    console.log('[StealthPatches] ✅ Extra scripts (Priority 7)');
    
    console.log(`[StealthPatches] 📊 Total scripts generated: ${scripts.length}`);
    console.log('[StealthPatches] ✅ v8.4.1 generation complete (AIC compliant)');
    
    return scripts;
  } catch (error) {
    console.error('[StealthPatches] ❌ Script generation failed:', error);
    throw new Error(`Script generation failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
  generateAllScripts,
  validateFingerprint,
  injectFullStealth: async (context, fp) => {
    console.log('[StealthPatches] 🔥 Injecting full stealth suite into context...');
    const scripts = await generateAllScripts(fp);
    for (const script of scripts) {
      await context.addInitScript(script);
    }
    console.log('[StealthPatches] ✅ Full stealth suite injected successfully');
  }
};
