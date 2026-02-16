/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ProxyPoolManager.js v1.4.0 - SOP SINGLETON + FULL LOGIC
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 🔥 CHANGELOG v1.4.0 (2026-02-15 06:00 WIB):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ REFACTOR: Converted to Singleton Architecture (SOP Standard)
 * - Removed constructor dependencies (proxyQualityManager, clashManager)
 * - Added `initialize()` method for explicit startup
 * - Added `injectClashManager()` for circular dependency handling
 * - Internalized ProxyQualityManager dependency
 * ✅ RETAINED: 100% Logic from v1.3.1
 * - Pre-population of slotAssignments with null markers (Dummy Architecture)
 * - calculateScore fix (using proxy._score)
 * - Full stats tracking & logging
 * * 🔥 CHANGELOG v1.3.1 (ORIGINAL):
 * ──────────────────────────────────────────────────────────────────────────────
 * ✅ CRITICAL FIX: assignProxy() line ~415 - Use proxy._score instead of calculateScore()
 * ✅ CRITICAL FEATURE: Pre-populate slotAssignments with null markers
 * * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const { db } = require('./database.js');
const { ObjectId } = require('mongodb');
const { formatSlotId } = require('./utils');

// Internal Dependency Handling
let ProxyQualityManagerInstance;
try {
    const PQM = require('./ProxyQualityManager');
    // Auto-detect if PQM is exported as Class or Singleton
    ProxyQualityManagerInstance = (typeof PQM === 'function') ? new PQM() : PQM;
} catch (e) {
    console.warn('[ProxyPoolManager] ⚠️ ProxyQualityManager not found/loaded:', e.message);
}

class ProxyPoolManager {
  constructor() {
    this.initialized = false;
    
    // Dependencies
    this.proxyQualityManager = ProxyQualityManagerInstance;
    this.clashManager = null; // Injected later via injectClashManager

    // Configuration Placeholder (Loaded in initialize)
    this.maxSlots = 1200; 
    
    // Config Defaults (Updated in initialize)
    this.cooldownDurations = {
      success: 60000,
      fail: 300000,
      quarantine: 3600000,
    };

    // Slot Tracking
    this.slotAssignments = {};

    // Statistics
    this.stats = {
      totalAssignments: 0,
      totalReleases: 0,
      totalRotations: 0,
      failedAssignments: 0,
      failedReleases: 0,
      providerReloads: 0,
      failedReloads: 0,
    };

    this.rotationEnabled = true;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * ✅ SOP: STANDARD INITIALIZE METHOD
   * ═══════════════════════════════════════════════════════════════
   * Handles setup that was previously in the constructor
   */
  async initialize() {
    if (this.initialized) {
        console.log('[ProxyPoolManager] Already initialized');
        return;
    }

    // 1. Load Config
    const othersReserved = parseInt(process.env.OTHERS_RESERVED || '1000', 10);
    const msedgeReserved = parseInt(process.env.MSEDGE_RESERVED || '200', 10);
    this.maxSlots = othersReserved + msedgeReserved;

    this.cooldownDurations = {
      success: parseInt(process.env.PROXY_COOLDOWN_SUCCESS || 60000), 
      fail: parseInt(process.env.PROXY_COOLDOWN_FAIL || 300000), 
      quarantine: parseInt(process.env.PROXY_COOLDOWN_QUARANTINE || 3600000), 
    };

    this.rotationEnabled = (process.env.PROXY_ROTATION_ENABLED || 'true') === 'true';

    // 2. Pre-populate Slots (Dummy Architecture from v1.3.0)
    console.log(`[ProxyPoolManager] 🔄 Pre-populating ${this.maxSlots} slot markers...`);
    
    // Reset assignments
    this.slotAssignments = {};
    for (let i = 1; i <= this.maxSlots; i++) {
      this.slotAssignments[i] = null;  // ✅ null = dummy state
    }
    
    const memoryUsage = (this.maxSlots * 8 / 1024).toFixed(2);  // 8 bytes per null
    console.log(`[ProxyPoolManager] ✅ ${this.maxSlots} slots initialized (null markers)`);
    console.log(`[ProxyPoolManager] 📊 Memory usage: ~${memoryUsage} KB`);

    // 3. Validation
    if (!this.proxyQualityManager) {
        console.warn('[ProxyPoolManager] ⚠️ ProxyQualityManager missing! Proxies cannot be assigned.');
    }

    console.log('');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('[ProxyPoolManager] v1.4.0 INITIALIZED - SINGLETON + v1.3.1 LOGIC');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`   Max Slots: ${this.maxSlots}`);
    console.log(`   Pre-populated: YES (null markers)`);
    console.log(`   Rotation: ${this.rotationEnabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`   Cooldowns:`);
    console.log(`     • Success: ${this.cooldownDurations.success}ms`);
    console.log(`     • Fail: ${this.cooldownDurations.fail}ms`);
    console.log(`     • Quarantine: ${this.cooldownDurations.quarantine}ms`);
    console.log('');
    console.log('✅ Architecture: Dummy Init + On-Demand Injection');
    console.log('   • null slot → ProxyAPIServer returns dummy proxy');
    console.log('   • assignProxy() → null replaced with real proxy');
    console.log('   • reloadProvider() → Clash fetches real proxy');
    console.log('   • Zero database queries until worker needs proxy');
    console.log('');
    console.log('✅ Provider naming: ProxyPool### (consistent!)');
    console.log('✅ Provider reload: PUT /providers/proxies/:name');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('');

    this.initialized = true;
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * ✅ SOP: DEPENDENCY INJECTION
   * ═══════════════════════════════════════════════════════════════
   */
  injectClashManager(clashManagerInstance) {
      this.clashManager = clashManagerInstance;
      console.log('[ProxyPoolManager] ✅ ClashManager injected successfully');
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v1.2.1 FIX: RELOAD CLASH PROVIDER (CORRECTED!)
   * ═══════════════════════════════════════════════════════════════
   * (No changes from v1.2.1)
   */
  async reloadProvider(slotIndex) {
    // Safety check for dependency
    if (!this.clashManager) {
        console.warn(`[ProxyPoolManager] ⚠️ ClashManager not injected, skipping provider reload for slot ${slotIndex}`);
        return false;
    }

    const slotId = formatSlotId(slotIndex);
    const providerName = `ProxyPool${slotId}`;
    
    try {
      // ─────────────────────────────────────────────────────────────
      // STEP 1: VALIDATE SLOT HAS ASSIGNMENT
      // ─────────────────────────────────────────────────────────────
      const assignment = this.slotAssignments[slotIndex];
      
      // ✅ v1.3.0: Check for null (dummy state)
      if (assignment === null) {
        console.warn(`[ProxyPoolManager] ⚠️  SLOT_${slotId} is in dummy state, skipping reload`);
        return false;
      }
      
      if (!assignment || !assignment.proxy) {
        console.warn(`[ProxyPoolManager] ⚠️  No proxy assigned to SLOT_${slotId}, skipping reload`);
        return false;
      }
      
      const proxy = assignment.proxy;
      console.log(`[ProxyPoolManager] Reloading provider: ${providerName}...`);
      console.log(`[ProxyPoolManager]    → Proxy: ${proxy.host}:${proxy.port}`);
      
      // ─────────────────────────────────────────────────────────────
      // STEP 2: TRIGGER CLASH PROVIDER RELOAD
      // ─────────────────────────────────────────────────────────────
      const endpoint = `/providers/proxies/${providerName}`;
      
      const response = await this.clashManager.apiClient.put(endpoint, null, {
        timeout: 5000,
        validateStatus: (status) => status >= 200 && status < 500
      });
      
      // ─────────────────────────────────────────────────────────────
      // STEP 3: CHECK RESPONSE
      // ─────────────────────────────────────────────────────────────
      if (response.status === 204 || response.status === 200) {
        console.log(`[ProxyPoolManager] ✅ Provider ${providerName} reloaded successfully`);
        console.log(`[ProxyPoolManager]    Status: Dummy → Real (on-demand injection)`);
        this.stats.providerReloads++;
        return true;
      }
      
      if (response.status === 404) {
        console.warn(`[ProxyPoolManager] ⚠️  Provider ${providerName} not found (404)`);
        console.warn(`[ProxyPoolManager] ℹ️  Check if Clash config has provider: ${providerName}`);
        this.stats.failedReloads++;
        return false;
      }
      
      console.warn(`[ProxyPoolManager] ⚠️  Provider reload returned ${response.status}`);
      this.stats.failedReloads++;
      return false;
      
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.error(`[ProxyPoolManager] ❌ Clash API not reachable (port 9090)`);
        console.error(`[ProxyPoolManager] ℹ️  Check if Clash is running with external-controller enabled`);
      } else if (error.code === 'ETIMEDOUT') {
        console.error(`[ProxyPoolManager] ❌ Clash API timeout (5s)`);
      } else {
        console.error(`[ProxyPoolManager] ❌ Provider reload error: ${error.message}`);
      }
      
      this.stats.failedReloads++;
      return false;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v1.3.0: ASSIGN PROXY TO SLOT (NULL MARKER REPLACEMENT!)
   * ═══════════════════════════════════════════════════════════════
   *
   * @param {Number} slotIndex - Slot index (1-maxSlots)
   * @param {String} workerId - Worker identifier
   * @returns {Promise<Object|null>} Assigned proxy object or null
   *
   * NEW BEHAVIOR v1.3.0:
   * - Check if slot is null (dummy state) → OK to assign
   * - Replace null with real proxy object
   * - Reload provider → Clash fetches real proxy from ProxyAPIServer
   * - Other slots remain null (no impact)
   */
  async assignProxy(slotIndex, workerId) {
    const slotId = formatSlotId(slotIndex);

    try {
      // ─────────────────────────────────────────────────────────────
      // STEP 1: VALIDATE SLOT STATE
      // ─────────────────────────────────────────────────────────────
      const currentAssignment = this.slotAssignments[slotIndex];
      
      // ✅ v1.3.0: Check for invalid slot (undefined)
      if (currentAssignment === undefined) {
        console.error(
          `[ProxyPoolManager] ❌ SLOT_${slotId} is out of range (max: ${this.maxSlots})`
        );
        this.stats.failedAssignments++;
        return null;
      }
      
      // ✅ v1.3.0: Allow assignment if null (dummy state)
      if (currentAssignment !== null) {
        console.error(
          `[ProxyPoolManager] ❌ SLOT_${slotId} already assigned to ${currentAssignment.workerId}`
        );
        this.stats.failedAssignments++;
        return null;
      }

      // ─────────────────────────────────────────────────────────────
      // STEP 2: GET BEST PROXY FROM MONGODB
      // ─────────────────────────────────────────────────────────────
      console.log(`[ProxyPoolManager] 🔄 Assigning real proxy to SLOT_${slotId}...`);
      console.log(`[ProxyPoolManager]    Worker: ${workerId}`);
      console.log(`[ProxyPoolManager]    Previous state: DUMMY (null)`);
      
      if (!this.proxyQualityManager) {
          throw new Error('ProxyQualityManager not initialized');
      }

      const proxy = await this.proxyQualityManager.getBestProxy();
      
      if (!proxy) {
        console.error(`[ProxyPoolManager] ❌ No available proxy for SLOT_${slotId}`);
        console.warn(`[ProxyPoolManager] ℹ️  Slot will remain in dummy state`);
        this.stats.failedAssignments++;
        return null;
      }

      // ─────────────────────────────────────────────────────────────
      // STEP 3: MARK PROXY AS IN_USE IN MONGODB
      // ─────────────────────────────────────────────────────────────
      const database = db();
      const proxiesCollection = database.collection('proxies');
      const now = new Date();

      const updateResult = await proxiesCollection.updateOne(
        { _id: new ObjectId(proxy._id) },
        {
          $set: {
            in_use: true,
            assigned_to_slot: slotIndex,
            assigned_to_worker: workerId,
            assigned_at: now,
            last_used: now,
          },
        }
      );

      if (updateResult.matchedCount === 0) {
        console.error(`[ProxyPoolManager] ❌ Proxy ${proxy._id} not found in DB`);
        this.stats.failedAssignments++;
        return null;
      }

      // ─────────────────────────────────────────────────────────────
      // STEP 4: REPLACE NULL WITH REAL PROXY IN MEMORY
      // ─────────────────────────────────────────────────────────────
      // ✅ v1.3.0: Replace null marker with real proxy object
      this.slotAssignments[slotIndex] = {
        slotIndex,
        workerId,
        proxy,
        assignedAt: now,  // Date object (not string)
      };

      // ─────────────────────────────────────────────────────────────
      // STEP 5: RELOAD PROVIDER (DUMMY → REAL TRANSITION)
      // ─────────────────────────────────────────────────────────────
      console.log(`[ProxyPoolManager] 🔄 Reloading provider (dummy → real)...`);
      await this.reloadProvider(slotIndex);

      // ─────────────────────────────────────────────────────────────
      // STEP 6: RETURN PROXY OBJECT
      // ─────────────────────────────────────────────────────────────
      // ═══════════════════════════════════════════════════════════════
      // 🔥 v1.3.1 BUG FIX: Use proxy._score instead of calculateScore()
      // ═══════════════════════════════════════════════════════════════
      // REASON: ProxyQualityManager.getBestProxy() returns proxy with
      //        _score field from aggregation pipeline (line 108-148
      //        in ProxyQualityManager.js). Method calculateScore()
      //        doesn't exist - only calculateHealthScore(latency) exists.
      // ═══════════════════════════════════════════════════════════════
      const score = proxy._score || 0;  // ⬅️ CHANGED: Remove calculateScore() call
      
      console.log('');
      console.log(`[ProxyPoolManager] ✅ SLOT_${slotId} REAL PROXY ASSIGNED`);
      console.log(`   Proxy: ${proxy.host}:${proxy.port}`);
      console.log(`   Score: ${score.toFixed(2)}`);
      console.log(`   Worker: ${workerId}`);
      console.log(`   Transition: DUMMY (null) → REAL (on-demand)`);
      console.log('');

      this.stats.totalAssignments++;

      return proxy;
      
    } catch (error) {
      console.error(`[ProxyPoolManager] ❌ assignProxy error for SLOT_${slotId}: ${error.message}`);
      this.stats.failedAssignments++;
      return null;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v1.3.0: RELEASE PROXY FROM SLOT (RESET TO NULL!)
   * ═══════════════════════════════════════════════════════════════
   * * NEW BEHAVIOR v1.3.0:
   * - After release, slot is set back to null (dummy state)
   * - ProxyAPIServer will serve dummy proxy for this slot again
   * - Ready for next assignment
   */
  async releaseProxy(slotIndex, workerId, success = true) {
    const slotId = formatSlotId(slotIndex);

    try {
      // ─────────────────────────────────────────────────────────────
      // STEP 1: VALIDATE SLOT ASSIGNMENT
      // ─────────────────────────────────────────────────────────────
      const assignment = this.slotAssignments[slotIndex];

      // ✅ v1.3.0: Check for null (already in dummy state)
      if (assignment === null) {
        console.warn(`[ProxyPoolManager] ⚠️  SLOT_${slotId} already in dummy state, skipping release`);
        return true;
      }

      if (!assignment) {
        console.error(`[ProxyPoolManager] ⚠️  SLOT_${slotId} not assigned, cannot release`);
        return false;
      }

      if (assignment.workerId !== workerId) {
        console.error(
          `[ProxyPoolManager] ❌ SLOT_${slotId} assigned to ${assignment.workerId}, ` +
          `cannot release by ${workerId}`
        );
        return false;
      }

      const proxy = assignment.proxy;

      // ─────────────────────────────────────────────────────────────
      // STEP 2: CALCULATE COOLDOWN DURATION
      // ─────────────────────────────────────────────────────────────
      const cooldownDuration = success
        ? this.cooldownDurations.success
        : this.cooldownDurations.fail;

      const cooldownUntil = new Date(Date.now() + cooldownDuration);

      // ─────────────────────────────────────────────────────────────
      // STEP 3: UPDATE MONGODB
      // ─────────────────────────────────────────────────────────────
      const database = db();
      const proxiesCollection = database.collection('proxies');
      const now = new Date();

      const updateResult = await proxiesCollection.updateOne(
        { _id: new ObjectId(proxy._id) },
        {
          $set: {
            in_use: false,
            cooldown_until: cooldownUntil,
            assigned_to_slot: null,
            assigned_to_worker: null,
            last_rotation: now,
          },
          $inc: {
            rotation_count: 1,
          },
        }
      );

      if (updateResult.modifiedCount === 0) {
        console.error(
          `[ProxyPoolManager] ⚠️  Failed to release proxy ${proxy._id} in DB ` +
          `(already released?)`
        );
      }

      // ─────────────────────────────────────────────────────────────
      // STEP 4: RESET TO NULL (DUMMY STATE)
      // ─────────────────────────────────────────────────────────────
      // ✅ v1.3.0: Set back to null (not delete!)
      this.slotAssignments[slotIndex] = null;

      // ─────────────────────────────────────────────────────────────
      // STEP 5: SUCCESS
      // ─────────────────────────────────────────────────────────────
      this.stats.totalReleases++;
      const cooldownSec = (cooldownDuration / 1000).toFixed(0);
      console.log(
        `[ProxyPoolManager] ✅ SLOT_${slotId} released: ${proxy.host}:${proxy.port}\n` +
        `   Cooldown: ${cooldownSec}s\n` +
        `   Success: ${success}\n` +
        `   State: REAL → DUMMY (null restored)`
      );

      return true;
      
    } catch (error) {
      console.error(`[ProxyPoolManager] ❌ releaseProxy error for SLOT_${slotId}:`, error.message);
      this.stats.failedReleases++;
      return false;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * ROTATE PROXY (RELEASE OLD + ASSIGN NEW)
   * ═══════════════════════════════════════════════════════════════
   * (No changes from v1.2.1)
   */
  async rotateProxy(slotIndex, workerId) {
    const slotId = formatSlotId(slotIndex);

    try {
      if (!this.rotationEnabled) {
        console.log(`[ProxyPoolManager] ⚠️  Rotation disabled (PROXY_ROTATION_ENABLED=false)`);
        return null;
      }

      console.log(`[ProxyPoolManager] Rotating proxy for SLOT_${slotId} (worker: ${workerId})...`);

      // STEP 1: RELEASE CURRENT PROXY (success=true)
      const releaseSuccess = await this.releaseProxy(slotIndex, workerId, true);

      if (!releaseSuccess) {
        console.error(
          `[ProxyPoolManager] ❌ Failed to release current proxy for SLOT_${slotId}, ` +
          `cannot rotate`
        );
        return null;
      }

      // STEP 2: ASSIGN NEW PROXY
      const newProxy = await this.assignProxy(slotIndex, workerId);

      if (!newProxy) {
        console.error(
          `[ProxyPoolManager] ❌ Failed to assign new proxy for SLOT_${slotId} ` +
          `after release`
        );
        return null;
      }

      // STEP 3: SUCCESS
      this.stats.totalRotations++;
      console.log(`[ProxyPoolManager] ✅ SLOT_${slotId} rotated: ${newProxy.host}:${newProxy.port}`);

      return newProxy;
      
    } catch (error) {
      console.error(`[ProxyPoolManager] ❌ rotateProxy error for SLOT_${slotId}:`, error.message);
      return null;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v1.3.0: GET CURRENT PROXY FOR SLOT (NULL-AWARE!)
   * ═══════════════════════════════════════════════════════════════
   * @param {Number} slotIndex - Slot index (1-maxSlots)
   * @returns {Object|null} Proxy data object or null if dummy state
   * * NEW BEHAVIOR v1.3.0:
   * - Returns null if slot is in dummy state (null marker)
   * - ProxyAPIServer can differentiate: null → dummy, object → real
   * * RETURN FORMAT (if real proxy assigned):
   * {
   * host: String,
   * port: Number,
   * protocol: String,
   * user: String,
   * pass: String,
   * workerId: String,
   * assignedAt: Number (timestamp)
   * }
   */
  getSlotProxy(slotIndex) {
    const assignment = this.slotAssignments[slotIndex];
    
    // ✅ v1.3.0: Return null for dummy state
    if (assignment === null || assignment === undefined) {
      return null;
    }
    
    const proxy = assignment.proxy;
    
    return {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol || 'socks5',
      user: proxy.user,
      pass: proxy.pass,
      workerId: assignment.workerId,
      assignedAt: assignment.assignedAt.getTime()
    };
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v1.3.0: GET ACTIVE SLOTS (FILTER NULL MARKERS!)
   * ═══════════════════════════════════════════════════════════════
   * @returns {Array} Array of active slot objects (only real proxies)
   * * NEW BEHAVIOR v1.3.0:
   * - Filters out null markers (dummy state)
   * - Returns only slots with real proxy assigned
   */
  getActiveSlots() {
    return Object.entries(this.slotAssignments)
      .filter(([_, assignment]) => assignment !== null)  // ✅ Filter null markers
      .map(([slotIndex, assignment]) => ({
        slotIndex: parseInt(slotIndex),
        proxy: {
          host: assignment.proxy.host,
          port: assignment.proxy.port,
          protocol: assignment.proxy.protocol || 'socks5',
          user: assignment.proxy.user,
          pass: assignment.proxy.pass,
        },
        workerId: assignment.workerId,
        assignedAt: assignment.assignedAt.getTime()
      }));
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * GET ALL SLOT ASSIGNMENTS (MONITORING)
   * ═══════════════════════════════════════════════════════════════
   * Returns all slots including null markers (for debugging)
   */
  getAllSlots() {
    return { ...this.slotAssignments };
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * 🔥 v1.3.0: GET STATISTICS (WITH DUMMY SLOT COUNT!)
   * ═══════════════════════════════════════════════════════════════
   */
  getStats() {
    const activeCount = Object.values(this.slotAssignments)
      .filter(assignment => assignment !== null).length;
    
    const dummyCount = this.maxSlots - activeCount;
    
    return {
      ...this.stats,
      totalSlots: this.maxSlots,
      activeSlots: activeCount,
      dummySlots: dummyCount,
      rotationEnabled: this.rotationEnabled,
      cooldownDurations: this.cooldownDurations,
      architecture: 'dummy-init-with-on-demand-injection'
    };
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * CLEANUP STALE ASSIGNMENTS (RECOVERY MECHANISM)
   * ═══════════════════════════════════════════════════════════════
   * (Updated to handle null markers)
   */
  async cleanupStaleAssignments(maxAgeMs = 3600000) {
    try {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [slotIndex, assignment] of Object.entries(this.slotAssignments)) {
        // ✅ v1.3.0: Skip null markers
        if (assignment === null) continue;
        
        const age = now - assignment.assignedAt.getTime();

        if (age > maxAgeMs) {
          const slotId = formatSlotId(parseInt(slotIndex));
          console.log(
            `[ProxyPoolManager] ⚠️  Stale assignment detected: SLOT_${slotId} ` +
            `(age: ${(age / 1000 / 60).toFixed(1)}min)`
          );
          await this.releaseProxy(parseInt(slotIndex), assignment.workerId, false);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`[ProxyPoolManager] ✅ Cleaned ${cleanedCount} stale assignments (reset to dummy)`);
      }

      return cleanedCount;
      
    } catch (error) {
      console.error('[ProxyPoolManager] ❌ cleanupStaleAssignments error:', error.message);
      return 0;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════
   * RELEASE ALL SLOTS (SHUTDOWN)
   * ═══════════════════════════════════════════════════════════════
   * (Updated to handle null markers)
   */
  async releaseAllSlots() {
    try {
      const activeSlots = Object.entries(this.slotAssignments)
        .filter(([_, assignment]) => assignment !== null)
        .map(([slotIndex, _]) => slotIndex);
      
      console.log(`[ProxyPoolManager] Releasing ${activeSlots.length} active slots...`);
      console.log(`[ProxyPoolManager] (${this.maxSlots - activeSlots.length} dummy slots unchanged)`);

      let releasedCount = 0;

      for (const slotIndex of activeSlots) {
        const assignment = this.slotAssignments[slotIndex];
        const success = await this.releaseProxy(parseInt(slotIndex), assignment.workerId, true);
        if (success) releasedCount++;
      }

      console.log(`[ProxyPoolManager] ✅ Released ${releasedCount}/${activeSlots.length} slots (reset to dummy)`);
      return releasedCount;
      
    } catch (error) {
      console.error('[ProxyPoolManager] ❌ releaseAllSlots error:', error.message);
      return 0;
    }
  }
}

// 🔥 EXPORT SINGLETON INSTANCE
module.exports = new ProxyPoolManager();