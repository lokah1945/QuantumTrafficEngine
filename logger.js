// logger.js - Enhanced Logger with Immediate Flush + SandboxieBox Support
// v2.1 - FIXED: Race condition (write after close)

const fs = require('fs');
const path = require('path');

class TestLogger {
  constructor(name) {
    try {
      this.name = name;
      this.hasError = false;
      this.closed = false;  // ✅ v2.1 FIX: Track if logger is closed

      // Create logs directory structure
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const logsDir = path.join(process.cwd(), 'logs', 'tests');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      this.logFile = path.join(logsDir, `${name}_${timestamp}.log`);

      // Open file with sync mode for immediate writes
      this.fd = fs.openSync(this.logFile, 'a');

      // Write header immediately
      const header = [
        `=== ${name.toUpperCase()} ===`,
        `Started: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
        `Timezone: WIB (UTC+7)`,
        `Debug Mode: ${process.env.DEBUG_MODE === 'true' ? 'ON' : 'OFF'}`,
        '============================================================',
        '',
        ''
      ].join('\n');

      fs.writeSync(this.fd, header);
      console.log(`\n📝 Log file created: ${this.logFile}\n`);
    } catch (error) {
      console.error('❌ CRITICAL: Logger initialization failed!');
      console.error(error);
      this.hasError = true;
      this.fd = null;
    }
  }

  writeSync(msg) {
    const line = msg.toString();

    // Always write to console
    console.log(line);

    // ✅ v2.1 FIX: Check if logger is closed (prevent EBADF error)
    if (this.closed) {
      // Logger already closed, silently skip file write
      return;
    }

    // Try write to file
    if (this.fd !== null && !this.hasError) {
      try {
        fs.writeSync(this.fd, line + '\n');
      } catch (e) {
        // Only show error if not caused by closed fd
        if (e.code !== 'EBADF') {
          console.error('❌ Log write error:', e.message);
        }
        // If EBADF, it means race condition (close called mid-write)
        // Just mark as closed and continue silently
        this.closed = true;
      }
    }
  }

  write(msg) {
    this.writeSync(msg);
  }

  error(msg) {
    this.writeSync(`❌ ${msg}`);
  }

  success(msg) {
    this.writeSync(`✅ ${msg}`);
  }

  info(msg) {
    this.writeSync(`ℹ️  ${msg}`);
  }

  warn(msg) {
    this.writeSync(`⚠️  ${msg}`);
  }

  debug(msg) {
    if (process.env.DEBUG_MODE === 'true') {
      this.writeSync(`[DEBUG] ${msg}`);
    }
  }

  section(title) {
    this.writeSync('');
    this.writeSync('------------------------------------------------------------');
    this.writeSync(`--- ${title} ---`);
    this.writeSync('------------------------------------------------------------');
    this.writeSync('');
  }

  json(title, obj) {
    this.writeSync(`${title}:`);
    this.writeSync(JSON.stringify(obj, null, 2));
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: SANDBOXIE BOX LIFECYCLE METHODS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Log box pool initialization
   */
  boxPoolInit(poolSize, workerCount, bufferSize) {
    this.section('Sandboxie Pool Initialization');
    this.info(`Pool Size: ${poolSize} boxes`);
    this.info(`Workers: ${workerCount}`);
    this.info(`Buffer: ${bufferSize} boxes`);
  }

  /**
   * Log box acquisition
   */
  boxAcquire(workerId, boxName, spoofedIP, acquisitionTimeMs) {
    this.info(`${workerId} → ${boxName} acquired (IP: ${spoofedIP}) [${acquisitionTimeMs}ms]`);
  }

  /**
   * Log box release
   */
  boxRelease(boxName, workerId, success, durationMs) {
    if (success) {
      this.info(`${boxName} ← ${workerId} released [${durationMs}ms]`);
    } else {
      this.warn(`${boxName} ← ${workerId} released (failed) [${durationMs}ms]`);
    }
  }

  /**
   * Log config injection start
   */
  boxConfigInjectStart(boxName, spoofedIP) {
    this.debug(`${boxName}: Injecting config (IP: ${spoofedIP})...`);
  }

  /**
   * Log individual config command
   */
  boxConfigInjectCmd(boxName, command, success, timeMs) {
    if (success) {
      this.debug(`${boxName}: ✓ ${command} [${timeMs}ms]`);
    } else {
      this.error(`${boxName}: ✗ ${command} FAILED`);
    }
  }

  /**
   * Log config injection complete
   */
  boxConfigInjectDone(boxName, totalTimeMs) {
    this.debug(`${boxName}: Config injected [${totalTimeMs}ms total]`);
  }

  /**
   * Log config deletion (cleanup)
   */
  boxConfigDelete(boxName, success, timeMs) {
    if (success) {
      this.debug(`${boxName}: Config deleted [${timeMs}ms]`);
    } else {
      this.warn(`${boxName}: Config delete failed (non-critical)`);
    }
  }

  /**
   * Log box contents deletion start
   */
  boxContentsDeleteStart(boxName) {
    this.debug(`${boxName}: Deleting contents...`);
  }

  /**
   * Log box contents deletion complete
   */
  boxContentsDeleteDone(boxName, success, timeMs, errorMsg = null) {
    if (success) {
      this.debug(`${boxName}: Contents deleted [${timeMs}ms]`);
    } else {
      this.warn(`${boxName}: Contents delete failed: ${errorMsg || 'unknown'}`);
    }
  }

  /**
   * Log process start in box
   */
  boxProcessStart(workerId, boxName, pid, command) {
    this.info(`${workerId}: Process ${pid} started in ${boxName} (${command})`);
  }

  /**
   * Log process end in box
   */
  boxProcessEnd(workerId, boxName, pid, exitCode, durationMs) {
    if (exitCode === 0) {
      this.success(`${workerId}: Process ${pid} exited (Code: ${exitCode}) [${durationMs}ms]`);
    } else {
      this.error(`${workerId}: Process ${pid} failed (Code: ${exitCode}) [${durationMs}ms]`);
    }
  }

  /**
   * Log process timeout
   */
  boxProcessTimeout(workerId, boxName, pid) {
    this.warn(`${workerId}: Process ${pid} TIMEOUT (killed)`);
  }

  /**
   * Log process error
   */
  boxProcessError(workerId, boxName, error) {
    this.error(`${workerId}: Process error - ${error}`);
  }

  /**
   * Log IP collision
   */
  boxIPCollision(attempt, maxAttempts) {
    this.warn(`IP collision (attempt ${attempt}/${maxAttempts})`);
  }

  /**
   * Log IP pool exhausted
   */
  boxIPExhausted(activeIPs, totalIPs) {
    const pct = ((activeIPs / totalIPs) * 100).toFixed(1);
    this.error(`IP pool exhausted! (${activeIPs}/${totalIPs} = ${pct}%)`);
  }

  /**
   * Log box pool destruction
   */
  boxPoolDestroy(totalBoxes, activeBoxes) {
    this.section('Sandboxie Pool Destruction');
    this.info(`Total boxes: ${totalBoxes}`);
    this.info(`Active at destroy: ${activeBoxes}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // END OF NEW METHODS
  // ═══════════════════════════════════════════════════════════════

  close() {
    try {
      // Write footer
      this.writeSync('');
      this.writeSync('============================================================');
      this.writeSync(`Finished: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
      this.writeSync(`Log saved: ${this.logFile}`);

      // Close file descriptor
      if (this.fd !== null && !this.closed) {
        fs.closeSync(this.fd);
      }

      // ✅ v2.1 FIX: Mark logger as closed (prevent further writes)
      this.closed = true;

      console.log(`\n✅ Log saved to: ${this.logFile}\n`);
    } catch (error) {
      console.error('❌ Error closing log:', error.message);
      this.closed = true;  // Mark closed even on error
    }
  }
}

module.exports = TestLogger;
