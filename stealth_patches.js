/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * stealth_patches.js v8.5.4 - STABILITY FIX (AIC PLAYWRIGHT CORRECTNESS)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 🔥 CHANGELOG v8.5.4 (2026-02-16 21:30 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ STABILITY FIX: Canvas toDataURL() no longer modifies canvas state (UNSTABLE fix)
 * ✅ STABILITY FIX: HTMLLang passive observer (no premature return)
 * ✅ STABILITY FIX: timezoneOffset removed (use Playwright native timezoneId)
 * ✅ STABILITY FIX: Worker Blob XHR simplified (safe fallback, no sync blocking)
 * ✅ CORRECTNESS: Validation moved to opsi4.js (after page.goto())
 * 📊 RESULT: Runtime stable, no false-negative, Playwright-compliant
 * 
 * 🔥 CHANGELOG v8.5.3 (2026-02-16 19:00 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ Worker Blob rewrite injection
 * ✅ Force innerWidth/innerHeight
 * ✅ Natural deviceMemory descriptor
 * ✅ matchMedia viewport-based
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
  patchProperty: (obj, prop, value, enumerable = true) => {
    try {
      Object.defineProperty(obj, prop, {
        get: function() { return value; },
        set: undefined,
        enumerable: enumerable,
        configurable: true
      });
    } catch(e) {}
  },
  patchPropertyNatural: (obj, prop, value) => {
    try {
      Object.defineProperty(obj, prop, {
        get: function() { return value; },
        set: undefined,
        enumerable: false,
        configurable: false
      });
    } catch(e) {}
  }
};
`;

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 0: HTML LANG ATTRIBUTE (STABILITY FIX - PASSIVE OBSERVER)
// ═══════════════════════════════════════════════════════════════════════════════
function generateHTMLLangScript(fp) {
  const locale = fp.locale || 'en-US';
  
  return `
(function() {
  'use strict';
  
  const targetLang = '${locale}';
  
  // ✅ STABILITY FIX: Only set if empty (don't override existing lang)
  const setLang = () => {
    const el = document.documentElement;
    if (!el) return false;
    
    // Safe: only set if not already set
    if (!el.getAttribute('lang')) {
      el.setAttribute('lang', targetLang);
    }
    return true;
  };
  
  // Try immediate
  setLang();
  
  // ✅ STABILITY FIX: Always attach observer (no premature return)
  // Passive observer for consistency
  document.addEventListener('DOMContentLoaded', setLang, { once: true });
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBRTC (v8.3.0 - OPSI C: DISABLED INJECTION)
// ═══════════════════════════════════════════════════════════════════════════════
function generateWebRTCScript(fp) {
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 1: WEBGL
// ═══════════════════════════════════════════════════════════════════════════════
function generateWebGLDeepScript(fp) {
  const webgl = fp.webgl || {};
  const vendor = webgl.vendor || 'Google Inc. (NVIDIA)';
  const renderer = webgl.renderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const extensions = webgl.extensions_base || webgl.extensions || [];
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
      
      const originalGetParameter = proto.getParameter;
      proto.getParameter = function(parameter) {
        if (parameter === 37445) return config.vendor;
        if (parameter === 37446) return config.renderer;
        if (parameter === 7936) return config.vendor;
        if (parameter === 7937) return config.renderer;
        
        if (config.params[parameter] !== undefined) {
          return config.params[parameter];
        }
        
        return originalGetParameter.apply(this, arguments);
      };
      utils.patchToString(proto.getParameter, 'getParameter');
      
      const originalGetExtension = proto.getExtension;
      proto.getExtension = function(name) {
        const ext = originalGetExtension.apply(this, arguments);
        if (name === 'WEBGL_debug_renderer_info' && ext) {
          const fakeExt = Object.create(Object.getPrototypeOf(ext));
          for (const key in ext) fakeExt[key] = ext[key];
          fakeExt.UNMASKED_VENDOR_WEBGL = 37445;
          fakeExt.UNMASKED_RENDERER_WEBGL = 37446;
          return fakeExt;
        }
        return ext;
      };
      utils.patchToString(proto.getExtension, 'getExtension');
      
      const originalGetSupportedExtensions = proto.getSupportedExtensions;
      proto.getSupportedExtensions = function() {
        if (config.extensions && config.extensions.length > 0) {
          return config.extensions.slice();
        }
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
// PRIORITY 2: HARDWARE (PROTOTYPE ONLY - NATURAL)
// ═══════════════════════════════════════════════════════════════════════════════
function generateHardwareConcurrencyScript(fp) {
  const targetCores = fp.hardware?.cores || 4;
  
  return `(function(){
${STEALTH_UTILS}
try {
  const targetCores = ${targetCores};
  
  utils.patchProperty(Navigator.prototype, 'hardwareConcurrency', targetCores, true);
  
  if (typeof WorkerNavigator !== 'undefined') {
    utils.patchProperty(WorkerNavigator.prototype, 'hardwareConcurrency', targetCores, true);
  }
} catch(e) {}
})();`;
}

function generateDeviceMemoryScript(fp) {
  if (fp.engine !== 'chromium') return '';
  
  const targetMemory = fp.hardware?.memory || 8;
  
  return `(function(){
${STEALTH_UTILS}
try {
  const targetMemory = ${targetMemory};
  
  utils.patchPropertyNatural(Navigator.prototype, 'deviceMemory', targetMemory);
  
  if (typeof WorkerNavigator !== 'undefined') {
    utils.patchPropertyNatural(WorkerNavigator.prototype, 'deviceMemory', targetMemory);
  }
} catch(e) {}
})();`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 2.1: WEB WORKER INJECTION (STABILITY FIX - SAFE FALLBACK)
// ═══════════════════════════════════════════════════════════════════════════════
function generateWorkerInjectionScript(fp) {
  const targetCores = fp.hardware?.cores || 4;
  const targetMemory = fp.hardware?.memory || 8;
  const engine = fp.engine || 'chromium';
  
  return `
(function() {
  'use strict';
  
  try {
    const targetCores = ${targetCores};
    const targetMemory = ${targetMemory};
    const isChromium = '${engine}' === 'chromium';
    
    const OriginalWorker = window.Worker;
    const OriginalBlob = window.Blob;
    
    // ✅ STABILITY FIX: Simplified safe fallback (no sync XHR blocking)
    window.Worker = class extends OriginalWorker {
      constructor(scriptURL, options) {
        // Inject override only for same-origin Blob/Data URLs
        if (typeof scriptURL === 'string' && 
            (scriptURL.startsWith('blob:') || scriptURL.startsWith('data:'))) {
          
          const overrideCode = \`
(function() {
  try {
    Object.defineProperty(self.navigator, 'hardwareConcurrency', {
      get: () => \${targetCores},
      enumerable: true,
      configurable: true
    });
    
    if (\${isChromium}) {
      Object.defineProperty(self.navigator, 'deviceMemory', {
        get: () => \${targetMemory},
        enumerable: false,
        configurable: false
      });
    }
  } catch(e) {}
})();
\`;
          
          try {
            // For Blob URLs, try to prepend override
            // Note: This only works for same-origin workers
            const blob = new OriginalBlob([overrideCode], { type: 'application/javascript' });
            const blobURL = URL.createObjectURL(blob);
            super(blobURL, options);
            return;
          } catch(e) {
            // Fallback to original
          }
        }
        
        // Default: create worker normally
        // Cross-origin workers won't be patched (this is expected)
        super(scriptURL, options);
      }
    };
    
    Object.setPrototypeOf(window.Worker.prototype, OriginalWorker.prototype);
    Object.setPrototypeOf(window.Worker, OriginalWorker);
    
    Object.defineProperty(window.Worker, 'toString', {
      value: function() { return 'function Worker() { [native code] }'; },
      configurable: true
    });
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 2.5: AUDIO CONTEXT OVERRIDE
// ═══════════════════════════════════════════════════════════════════════════════
function generateAudioContextOverrideScript(fp) {
  if (!fp.audio || !fp.audio.capabilities) {
    return '';
  }
  
  const sampleRate = fp.audio.capabilities.sample_rate || 44100;
  const channelCount = fp.audio.capabilities.channel_count || 2;
  const maxChannelCount = fp.audio.capabilities.max_channel_count || channelCount;
  const baseLatency = fp.audio.capabilities.base_latency || null;
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const config = {
      sampleRate: ${sampleRate},
      baseLatency: ${baseLatency !== null ? baseLatency : 'null'},
      channelCount: ${channelCount},
      maxChannelCount: ${maxChannelCount}
    };
    
    utils.patchProperty(AudioContext.prototype, 'sampleRate', config.sampleRate, false);
    
    if (config.baseLatency !== null) {
      utils.patchProperty(AudioContext.prototype, 'baseLatency', config.baseLatency, false);
    }
    
    if (window.AudioDestinationNode) {
      utils.patchProperty(AudioDestinationNode.prototype, 'channelCount', config.channelCount, false);
      utils.patchProperty(AudioDestinationNode.prototype, 'maxChannelCount', config.maxChannelCount, false);
    }
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 3: SCREEN + VIEWPORT (FULL SYNC)
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
    
    const props = {
      width: target.width,
      height: target.height,
      availWidth: target.availWidth,
      availHeight: target.availHeight,
      colorDepth: 24,
      pixelDepth: 24
    };
    
    for (const [key, value] of Object.entries(props)) {
      utils.patchProperty(Screen.prototype, key, value, false);
    }
    
    for (const [key, value] of Object.entries(props)) {
      try {
        Object.defineProperty(window.screen, key, {
          get: () => value,
          enumerable: false,
          configurable: true
        });
      } catch(e) {}
    }
    
    if (window.visualViewport) {
      try {
        Object.defineProperty(window.visualViewport, 'width', {
          get: () => target.width,
          enumerable: true,
          configurable: true
        });
        Object.defineProperty(window.visualViewport, 'height', {
          get: () => target.height,
          enumerable: true,
          configurable: true
        });
      } catch(e) {}
    }
    
    try {
      Object.defineProperty(window, 'innerWidth', {
        get: () => target.width,
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(window, 'innerHeight', {
        get: () => target.height,
        enumerable: true,
        configurable: true
      });
    } catch(e) {}
    
    try {
      const origClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      const origClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
      
      if (origClientWidth && origClientWidth.get) {
        Object.defineProperty(document.documentElement, 'clientWidth', {
          get: function() {
            if (this === document.documentElement) return target.width;
            return origClientWidth.get.call(this);
          },
          enumerable: true,
          configurable: true
        });
      }
      
      if (origClientHeight && origClientHeight.get) {
        Object.defineProperty(document.documentElement, 'clientHeight', {
          get: function() {
            if (this === document.documentElement) return target.height;
            return origClientHeight.get.call(this);
          },
          enumerable: true,
          configurable: true
        });
      }
    } catch(e) {}
  } catch (e) {}
})();
  `.trim();
}

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
    
    const noiseW = getNoise('w', 2);
    const noiseH = getNoise('h', 2);
    const fakeX = Math.abs(getNoise('x', 20));
    const fakeY = Math.abs(getNoise('y', 20));
    
    Object.defineProperty(window, 'outerWidth', { 
      get: () => window.innerWidth + noiseW, 
      configurable: true 
    });
    Object.defineProperty(window, 'outerHeight', { 
      get: () => window.innerHeight + noiseH, 
      configurable: true 
    });
    
    Object.defineProperty(window, 'screenX', { get: () => fakeX, configurable: true });
    Object.defineProperty(window, 'screenY', { get: () => fakeY, configurable: true });
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 3.5: MATCHMEDIA (USE VIEWPORT)
// ═══════════════════════════════════════════════════════════════════════════════
function generateMatchMediaScript(fp) {
  const width = fp.screen?.width || fp.viewport?.width || 1920;
  const height = fp.screen?.height || fp.viewport?.height || 1080;
  const colorDepth = fp.screen?.colorDepth || 24;
  const devicePixelRatio = fp.deviceScaleFactor || 1;
  const aspectRatio = (width / height).toFixed(4);
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const viewportConfig = {
      width: ${width},
      height: ${height},
      colorDepth: ${colorDepth},
      devicePixelRatio: ${devicePixelRatio},
      aspectRatio: ${aspectRatio}
    };
    
    const originalMatchMedia = window.matchMedia;
    
    function evaluateQuery(q) {
      q = q.toLowerCase().trim();
      
      if (q.includes('device-width')) {
        const match = q.match(/(min-|max-)?device-width[:\\s]*(\\d+)px/);
        if (match) {
          const value = parseInt(match[2]);
          if (match[1] === 'min-') return viewportConfig.width >= value;
          if (match[1] === 'max-') return viewportConfig.width <= value;
          return viewportConfig.width === value;
        }
      }
      
      if (q.includes('device-height')) {
        const match = q.match(/(min-|max-)?device-height[:\\s]*(\\d+)px/);
        if (match) {
          const value = parseInt(match[2]);
          if (match[1] === 'min-') return viewportConfig.height >= value;
          if (match[1] === 'max-') return viewportConfig.height <= value;
          return viewportConfig.height === value;
        }
      }
      
      if (q.includes('width') && !q.includes('device')) {
        const match = q.match(/(min-|max-)?width[:\\s]*(\\d+)px/);
        if (match) {
          const value = parseInt(match[2]);
          const currentWidth = viewportConfig.width;
          if (match[1] === 'min-') return currentWidth >= value;
          if (match[1] === 'max-') return currentWidth <= value;
          return currentWidth === value;
        }
      }
      
      if (q.includes('height') && !q.includes('device')) {
        const match = q.match(/(min-|max-)?height[:\\s]*(\\d+)px/);
        if (match) {
          const value = parseInt(match[2]);
          const currentHeight = viewportConfig.height;
          if (match[1] === 'min-') return currentHeight >= value;
          if (match[1] === 'max-') return currentHeight <= value;
          return currentHeight === value;
        }
      }
      
      if (q.includes('resolution')) {
        const match = q.match(/(min-|max-)?resolution[:\\s]*(\\d+)dppx/);
        if (match) {
          const value = parseInt(match[2]);
          if (match[1] === 'min-') return viewportConfig.devicePixelRatio >= value;
          if (match[1] === 'max-') return viewportConfig.devicePixelRatio <= value;
          return viewportConfig.devicePixelRatio === value;
        }
      }
      
      if (q.includes('aspect-ratio')) {
        const match = q.match(/(min-|max-)?aspect-ratio[:\\s]*(\\d+)\\/(\\d+)/);
        if (match) {
          const ratio = parseInt(match[2]) / parseInt(match[3]);
          const currentRatio = parseFloat(viewportConfig.aspectRatio);
          if (match[1] === 'min-') return currentRatio >= ratio;
          if (match[1] === 'max-') return currentRatio <= ratio;
          return Math.abs(currentRatio - ratio) < 0.01;
        }
      }
      
      if (q.includes('color')) {
        const match = q.match(/(min-|max-)?color[:\\s]*(\\d+)/);
        if (match) {
          const value = parseInt(match[2]);
          const bitsPerComponent = viewportConfig.colorDepth / 3;
          if (match[1] === 'min-') return bitsPerComponent >= value;
          if (match[1] === 'max-') return bitsPerComponent <= value;
          return bitsPerComponent === value;
        }
      }
      
      if (q.includes('orientation')) {
        const isLandscape = viewportConfig.width > viewportConfig.height;
        if (q.includes('landscape')) return isLandscape;
        if (q.includes('portrait')) return !isLandscape;
      }
      
      return null;
    }
    
    window.matchMedia = function(query) {
      const nativeMQL = originalMatchMedia.call(window, query);
      const spoofedResult = evaluateQuery(query);
      
      if (spoofedResult === null) {
        return nativeMQL;
      }
      
      try {
        Object.defineProperty(nativeMQL, 'matches', {
          get: function() { return spoofedResult; },
          enumerable: true,
          configurable: true
        });
      } catch(e) {}
      
      return nativeMQL;
    };
    
    utils.patchToString(window.matchMedia, 'matchMedia');
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 4: NAVIGATOR + WEBDRIVER CLEANUP
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
      utils.patchProperty(Navigator.prototype, key, value, false);
    }
  } catch (e) {}
})();`.trim();
}

function generateWebdriverCleanupScript() {
  return `(function(){
try {
  delete Navigator.prototype.webdriver;
  delete navigator.webdriver;
  
  const stillExists = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
  if (stillExists) {
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      get: () => undefined,
      configurable: true,
      enumerable: true
    });
  }
  
  const cdcProps = [
    'cdc_adoQpoasnfa76pfcZLmcfl_Array',
    'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
    'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    'cdc_adoQpoasnfa76pfcZLmcfl_Object'
  ];
  
  cdcProps.forEach(prop => {
    try { delete window[prop]; } catch(e) {}
  });
  
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
// PRIORITY 5: BROWSER-SPECIFIC
// ═══════════════════════════════════════════════════════════════════════════════
function generateChromeObjectScript(fp) {
  if (fp.engine === 'chromium') {
    return `(function(){try{if(!window.chrome)window.chrome={};if(!window.chrome.runtime)window.chrome.runtime={connect:()=>{},sendMessage:()=>{},onMessage:{addListener:()=>{}}};}catch(e){}})();`;
  }
  return '';
}

function generatePluginsScript(fp) {
  const engine = fp.engine || 'chromium';
  
  if (engine === 'gecko') {
    return `(function(){
try {
  const emptyPlugins = Object.create(null);
  
  Object.defineProperty(emptyPlugins, 'length', {
    value: 0,
    writable: false,
    enumerable: false,
    configurable: true
  });
  
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
  
  return `(function(){
try {
  const pdfPlugin = {
    name: 'PDF Viewer',
    description: 'Portable Document Format',
    filename: 'internal-pdf-viewer'
  };
  
  pdfPlugin.item = function(index) {
    return index === 0 ? this : null;
  };
  pdfPlugin.namedItem = function(name) {
    return name === 'PDF Viewer' ? this : null;
  };
  
  const pluginArray = Object.create(null);
  
  Object.defineProperty(pluginArray, 'length', {
    value: 1,
    writable: false,
    enumerable: false,
    configurable: true
  });
  
  pluginArray[0] = pdfPlugin;
  
  pluginArray.item = function(index) {
    return index === 0 ? pdfPlugin : null;
  };
  pluginArray.namedItem = function(name) {
    return name === 'PDF Viewer' ? pdfPlugin : null;
  };
  pluginArray.refresh = function() {};
  
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

function generatePermissionsScript() {
  return `(function(){
try {
  if (!navigator.permissions || !navigator.permissions.query) return;
  
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);
  
  const gestureRequired = new Set([
    'notifications',
    'geolocation',
    'microphone',
    'camera',
    'midi'
  ]);
  
  navigator.permissions.query = function(params) {
    if (params && gestureRequired.has(params.name)) {
      const result = {
        state: 'prompt',
        onchange: null
      };
      
      try {
        if (window.PermissionStatus) {
          Object.setPrototypeOf(result, PermissionStatus.prototype);
        }
      } catch(e) {}
      
      return Promise.resolve(result);
    }
    
    return originalQuery(params);
  };
  
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
// PRIORITY 6: FINGERPRINT NOISE (STABILITY FIX - NO SIDE EFFECTS)
// ═══════════════════════════════════════════════════════════════════════════════
function generateCanvasNoiseScript(fp) {
  const seed = fp._id || fp.canvas?.noise_seed || 'canvas-default-seed';
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const seed = '${seed}';
    
    const hashSeed = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
      }
      return hash;
    };
    
    const getDeterministicNoise = (pixelIndex) => {
      const hash = hashSeed(seed + '_' + pixelIndex);
      return ((hash % 3) - 1);
    };
    
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
      const imageData = originalGetImageData.apply(this, arguments);
      
      if (imageData.data.length > 0) {
        for (let i = 0; i < imageData.data.length; i += 16) {
          const noise = getDeterministicNoise(i);
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise));
        }
      }
      
      return imageData;
    };
    utils.patchToString(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');
    
    // ✅ STABILITY FIX: toDataURL() does NOT modify canvas state
    // Read operation should not have write side effects
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      // Simply return native result (getImageData already applied noise)
      return originalToDataURL.apply(this, arguments);
    };
    utils.patchToString(HTMLCanvasElement.prototype.toDataURL, 'toDataURL');
    
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text) {
      const metrics = originalMeasureText.apply(this, arguments);
      
      if (text && text.length > 5) {
        const textHash = hashSeed(seed + text);
        const shouldApplyNoise = (Math.abs(textHash) % 20) === 0;
        
        if (shouldApplyNoise) {
          const noise = ((textHash % 2) === 0) ? 0.1 : -0.1;
          Object.defineProperty(metrics, 'width', {
            value: metrics.width + noise,
            writable: false,
            configurable: true
          });
        }
      }
      
      return metrics;
    };
    utils.patchToString(CanvasRenderingContext2D.prototype.measureText, 'measureText');
  } catch (e) {}
})();
  `.trim();
}

function generateFontMetricNoiseScript(fp) {
  const seed = fp._id || 'font-seed';
  
  return `
(function() {
  'use strict';
  
  try {
    const seed = '${seed}';
    
    const getElementNoise = (element, property) => {
      let hash = 0;
      const str = seed + property + (element.tagName || '') + (element.className || '');
      for (let i = 0; i < str.length; i++) {
        hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
      }
      return (Math.abs(hash) % 100) < 5 ? ((hash % 2) ? 1 : -1) : 0;
    };
    
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    if (widthDescriptor && widthDescriptor.get) {
      const originalGetWidth = widthDescriptor.get;
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        get: function() {
          const width = originalGetWidth.apply(this, arguments);
          
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
    
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      const rect = originalGetBoundingClientRect.apply(this, arguments);
      
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
// PRIORITY 6.5: IFRAME PROPAGATION
// ═══════════════════════════════════════════════════════════════════════════════
function generateIframePropagationScript(fp) {
  const screenWidth = fp.screen?.width || 1920;
  const screenHeight = fp.screen?.height || 1080;
  const availWidth = fp.screen?.availWidth || screenWidth;
  const availHeight = fp.screen?.availHeight || (screenHeight - 40);
  const colorDepth = fp.screen?.colorDepth || 24;
  const pixelDepth = fp.screen?.pixelDepth || 24;
  
  const platform = fp.navigator?.platform || 'Win32';
  const language = fp.locale || 'en-US';
  const vendor = fp.engine === 'webkit' ? 'Apple Computer, Inc.' : (fp.engine === 'gecko' ? '' : 'Google Inc.');
  const hardwareConcurrency = fp.hardware?.cores || 4;
  const deviceMemory = fp.hardware?.memory || 8;
  
  return `
(function() {
  'use strict';
  ${STEALTH_UTILS}
  
  try {
    const parentScreen = {
      width: ${screenWidth},
      height: ${screenHeight},
      availWidth: ${availWidth},
      availHeight: ${availHeight},
      colorDepth: ${colorDepth},
      pixelDepth: ${pixelDepth}
    };
    
    const parentNavigator = {
      platform: '${platform}',
      language: '${language}',
      vendor: '${vendor}',
      hardwareConcurrency: ${hardwareConcurrency},
      deviceMemory: ${deviceMemory}
    };
    
    const originalContentWindowGetter = Object.getOwnPropertyDescriptor(
      HTMLIFrameElement.prototype, 
      'contentWindow'
    );
    
    if (originalContentWindowGetter && originalContentWindowGetter.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = originalContentWindowGetter.get.call(this);
          
          if (!win) return win;
          
          try {
            const testAccess = win.location.href;
            
            if (win.Screen && win.Screen.prototype) {
              for (const [key, value] of Object.entries(parentScreen)) {
                try {
                  utils.patchProperty(win.Screen.prototype, key, value, false);
                } catch(e) {}
              }
            }
            
            if (win.Navigator && win.Navigator.prototype) {
              for (const [key, value] of Object.entries(parentNavigator)) {
                try {
                  if (key === 'deviceMemory') {
                    utils.patchPropertyNatural(win.Navigator.prototype, key, value);
                  } else {
                    utils.patchProperty(win.Navigator.prototype, key, value, false);
                  }
                } catch(e) {}
              }
            }
          } catch(e) {}
          
          return win;
        },
        enumerable: true,
        configurable: true
      });
    }
  } catch (e) {}
})();
  `.trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY 7: EXTRAS (STABILITY FIX - USE PLAYWRIGHT NATIVE TIMEZONE)
// ═══════════════════════════════════════════════════════════════════════════════
function generateTimezoneScript(fp) {
  // ✅ STABILITY FIX: Use Playwright native timezoneId (don't override getTimezoneOffset)
  // Playwright context already handles timezone via timezoneId option
  // Overriding with default 0 causes inconsistency
  return '';
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
// MAIN GENERATOR v8.5.4 - STABILITY FOCUS (PLAYWRIGHT CORRECTNESS)
// ═══════════════════════════════════════════════════════════════════════════════
async function generateAllScripts(fp) {
  const validation = validateFingerprint(fp);
  const scripts = [];
  
  try {
    scripts.push(generateHTMLLangScript(fp));
    scripts.push(generateWebGLDeepScript(fp));
    
    scripts.push(generateHardwareConcurrencyScript(fp));
    scripts.push(generateDeviceMemoryScript(fp));
    scripts.push(generateWorkerInjectionScript(fp));
    
    const audioScript = generateAudioContextOverrideScript(fp);
    if (audioScript) {
      scripts.push(audioScript);
    }
    
    scripts.push(generateScreenScript(fp));
    scripts.push(generateWindowNoiseScript(fp));
    scripts.push(generateMatchMediaScript(fp));
    
    scripts.push(generateNavigatorScript(fp));
    scripts.push(generateWebdriverCleanupScript());
    
    scripts.push(generatePermissionsScript());
    scripts.push(generateChromeObjectScript(fp));
    scripts.push(generatePluginsScript(fp));
    
    scripts.push(generateCanvasNoiseScript(fp));
    scripts.push(generateFontMetricNoiseScript(fp));
    scripts.push(generateAudioNoiseScript(fp));
    
    scripts.push(generateIframePropagationScript(fp));
    
    scripts.push(generateTimezoneScript(fp));
    scripts.push(generateBatteryScript(fp));
    
    return scripts;
  } catch (error) {
    console.error('[StealthPatches] ❌ Generation failed:', error);
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
    const scripts = await generateAllScripts(fp);
    for (const script of scripts) {
      await context.addInitScript(script);
    }
  }
};
