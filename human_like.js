// human_like.js (v14.0 - Full Features + Smart Click & External Lock)

const { randomChoice, getRandomInt, paretoRandom, gaussianRandom } = require('./utils.js');

function getHumanDelay(min, max) {
  return Math.round(paretoRandom(min, max, 1.5));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function networkJitter(page) {
  await sleep(getRandomInt(50, 200));
}

// =================================================================
// MOUSE PHYSICS (Original Ghost Cursor with Overshoot preserved)
// =================================================================
async function humanMove(page, box) {
  try {
    if (!box) return;
    const mx = box.width * 0.15, my = box.height * 0.15;
    const tx = box.x + mx + (Math.random()*(box.width - 2*mx));
    const ty = box.y + my + (Math.random()*(box.height - 2*my));
    
    // Overshoot Logic
    const overshootX = tx + getRandomInt(5, 20) * (Math.random() > 0.5 ? 1 : -1);
    const overshootY = ty + getRandomInt(5, 20) * (Math.random() > 0.5 ? 1 : -1);
    
    const steps = getRandomInt(15, 40); 
    const seg = Math.ceil(steps/4); 
    
    const cx = tx + (Math.random()*200 - 100); 
    const cy = ty + (Math.random()*200 - 100);
    
    // 1. Kurva awal
    await page.mouse.move(cx, cy, { steps: seg });
    
    // 2. Mendekati Target
    await page.mouse.move(tx + (Math.random()*5-2), ty + (Math.random()*5-2), { steps: seg });
    
    // 3. Overshoot (30% Chance)
    if (Math.random() < 0.3) { 
        await page.mouse.move(overshootX, overshootY, { steps: seg });
        await sleep(getRandomInt(50, 150)); 
    }
    
    // 4. Final Correction
    await page.mouse.move(tx, ty, { steps: steps - (3 * seg) }); 

  } catch(e) {}
}

// =================================================================
// VIEWPORT HELPER
// =================================================================
async function isVisibleAndInViewport(page, element) {
    try {
        if (!await element.isVisible()) return false;
        const box = await element.boundingBox();
        if (!box) return false;
        const vp = page.viewportSize();
        // Fix untuk Real Browser (Maximized = viewport null)
        if (!vp) return true; 
        return (box.y >= 0 && (box.y + box.height) <= vp.height) && 
               (box.x >= 0 && (box.x + box.width) <= vp.width);
    } catch(e) { return false; }
}

// =================================================================
// SCROLLING LOGIC
// =================================================================
async function getScrollState(page) {
    return await page.evaluate(() => {
        return {
            y: window.scrollY,
            h: window.innerHeight,
            total: document.body.scrollHeight,
            atBottom: (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 50,
            atTop: window.scrollY < 50
        };
    });
}

async function smoothMouseScroll(page, distance, direction = 'down') {
    const vector = direction === 'down' ? 1 : -1;
    const steps = getRandomInt(6, 15); 
    const stepSize = distance / steps;

    for (let i = 0; i < steps; i++) {
        const variance = (Math.random() * 0.4) + 0.8; 
        const currentStep = stepSize * variance * vector;
        await page.mouse.wheel(0, currentStep);
        await sleep(getRandomInt(10, 40));
    }
}

async function keyboardScroll(page) {
    const presses = getRandomInt(2, 5);
    for(let i=0; i<presses; i++) {
        const key = Math.random() > 0.1 ? 'ArrowDown' : 'ArrowUp';
        await page.keyboard.press(key);
        await sleep(getRandomInt(150, 400));
    }
}

async function humanScroll(page, config, currentPhase, logDebug) {
  if (currentPhase === 'orientation' && Math.random() > 0.3) return;
  if (Math.random() > config.scrollChance) return;
  
  try {
      const state = await getScrollState(page);
      if (state.atBottom) {
          if (logDebug) logDebug(`Action: Page Bottom Reached. Scrolling Up.`);
          const action = Math.random();
          if (action < 0.6) await smoothMouseScroll(page, getRandomInt(500, 1000), 'up');
          else if (action < 0.9) await smoothMouseScroll(page, getRandomInt(150, 300), 'up');
          else await page.keyboard.press('Home');
          await sleep(getRandomInt(500, 1000)); 
          return; 
      }

      const methodRand = Math.random();
      let distance = currentPhase === 'scanning' ? getRandomInt(400, 800) : getRandomInt(250, 500);
      
      if (methodRand < 0.85) { 
          const direction = (Math.random() > 0.05) ? 'down' : 'up';
          await smoothMouseScroll(page, distance, direction);
      } else { 
          await keyboardScroll(page);
      }
      const readTime = currentPhase === 'reading' ? getHumanDelay(1500, 4000) : getHumanDelay(500, 1500);
      await sleep(readTime); 

  } catch (e) { if (logDebug) logDebug(`⚠️ Scroll Error: ${e.message}`); }
}

// =================================================================
// MICRO HABITS (Cookies, Text Select, Overlays, Popups) - RESTORED
// =================================================================
async function handleCookies(page, logDebug) {
  try {
    const sels = ['button:has-text("Accept")','button:has-text("OK")','a[class*=cookie]','div[aria-label="Cookie"] button'];
    for(const s of sels) {
      const b = await page.$(s);
      if(b && await b.isVisible()) { 
          if (logDebug) logDebug(`Action: Handling Cookie Banner (${s})`);
          await humanMove(page, await b.boundingBox()); 
          await sleep(500); 
          await b.click(); 
          break; 
      }
    }
  } catch(e){}
}

async function performTextSelection(page) {
    try {
        const paragraphs = await page.$$('p, span.content');
        if (paragraphs.length === 0) return;
        const p = randomChoice(paragraphs);
        const box = await p.boundingBox();
        if (!box) return;

        const startX = box.x + (Math.random() * box.width * 0.5);
        const startY = box.y + (box.height / 2);
        
        await page.mouse.move(startX, startY, { steps: 5 });
        await page.mouse.down();
        await page.mouse.move(startX + getRandomInt(20, 100), startY, { steps: 5 });
        await sleep(getRandomInt(200, 500));
        await page.mouse.up();
        await sleep(300);
        await page.mouse.click(startX - 10, startY); 
    } catch(e) {}
}

async function dismissOverlays(page, status, logDebug) {
    try {
        const closers = ['button[aria-label="Close"]', '.close-button', 'svg[data-icon="times"]', 'button:has-text("No thanks")'];
        for (const sel of closers) {
            const el = await page.$(sel);
            if (el && await el.isVisible()) {
                if (logDebug) logDebug(`Action: Dismiss Overlay (${sel})`);
                await el.click();
                await sleep(500);
                return true;
            }
        }
    } catch(e) {}
    return false;
}

async function handleRealPopups(page, context, updateStatus, timeElapsed, logDebug) {
  const pages = context.pages();
  if (pages.length <= 1) return page;

  await sleep(getRandomInt(1000, 2000));
  const r = Math.random();
  let followChance = 0.05; 
  if (timeElapsed > 30000) followChance = 0.2; 
  
  if (r < followChance) { 
      const newPage = pages[pages.length - 1];
      if (newPage !== page) {
          updateStatus('🔀 Follow Pop-up (Interest)');
          if (logDebug) logDebug('Action: Following Pop-up Tab');
          try {
            await newPage.bringToFront();
            await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(()=>{});
            await smoothMouseScroll(newPage, 300, 'down');
            return newPage;
          } catch(e) { return page; }
      }
  } else { 
      updateStatus('❌ Close Pop-up (Intrusive)');
      if (logDebug) logDebug('Action: Closing Pop-up Tab');
      for (let i = 1; i < pages.length; i++) {
          try { await pages[i].close(); } catch(e){}
      }
      const mainPage = pages[0];
      await mainPage.bringToFront();
      return mainPage;
  }
  return page;
}

async function simulateTabSwitch(page) {
  try {
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{value:true,writable:true}); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(getRandomInt(3000, 10000)); 
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{value:false,writable:true}); document.dispatchEvent(new Event('visibilitychange')); });
  } catch(e){}
}

async function hoverRandomElement(page) {
  try {
    const els = await page.$$('p, h1, h2, img, button');
    const visible = [];
    for(const e of els) { if(await isVisibleAndInViewport(page, e)) visible.push(e); }

    if(visible.length) {
      const e = randomChoice(visible);
      const b = await e.boundingBox();
      if(b) await humanMove(page, b);
      await sleep(getRandomInt(500, 2000));
    }
  } catch(e){}
}

// =================================================================
// CLICK ACTIONS (UPDATED: DB AWARE & EXTERNAL LOCK)
// =================================================================
async function clickInternalLink(page, bl, targetDbUrls = []) {
  try {
    const currentHost = new URL(page.url()).hostname;
    const links = await page.$$('a[href]');
    
    // Arrays untuk prioritas
    const priorityTargets = []; // Link yang ada di DB
    const genericTargets = [];  // Link internal lain

    // Pre-process DB paths untuk pencarian cepat
    const dbPaths = new Set(targetDbUrls.map(u => {
        try { return new URL(u).pathname; } catch(e) { return ''; }
    }).filter(p => p.length > 1));

    for (const l of links) {
      const hr = await l.getAttribute('href');
      if(hr) {
        try {
          const u = new URL(hr, page.url());
          // Pastikan domain sama & terlihat
          if(u.hostname === currentHost && await isVisibleAndInViewport(page, l)) {
              // Pastikan tidak di blacklist
              if (!bl.some(b => u.href.includes(b))) {
                  // Cek Prioritas (DB Match)
                  if (dbPaths.has(u.pathname)) {
                      priorityTargets.push(l);
                  } else {
                      genericTargets.push(l);
                  }
              }
          }
        } catch(e){}
      }
    }

    // DECISION: Pilih dari Priority dulu
    let finalTarget = null;
    if (priorityTargets.length > 0) finalTarget = randomChoice(priorityTargets);
    else if (genericTargets.length > 0) finalTarget = randomChoice(genericTargets);

    if(!finalTarget) return false;
    
    const b = await finalTarget.boundingBox();
    if(b) await humanMove(page, b);
    
    await sleep(getRandomInt(150, 300)); 
    try { await finalTarget.click({ timeout: 5000 }); } catch(e) {} 
    return true;
  } catch(e){ return false; }
}

async function clickExternalLink(page, bl) {
  try {
    const h = new URL(page.url()).hostname;
    const links = await page.$$('a[href]');
    const tgts = [];
    for (const l of links) {
      const hr = await l.getAttribute('href');
      try {
        const u = new URL(hr, page.url());
        if(u.hostname !== h && !bl.some(d=>u.hostname.includes(d))) {
             if(await isVisibleAndInViewport(page, l)) tgts.push(l);
        }
      } catch(e){}
    }
    if(!tgts.length) return false;

    const t = randomChoice(tgts);
    const b = await t.boundingBox();
    if(b) await humanMove(page, b);

    try { await t.click({ timeout: 5000 }); } catch(e) {}
    // Jangan sleep terlalu lama disini, biarkan main loop handle lock
    return true;
  } catch(e){ return false; }
}

// =================================================================
// MAIN SIMULATION LOOP (EXTERNAL LOCK INTEGRATED)
// =================================================================
async function simulateHumanBehavior(page, context, duration, baseCfg, bl, status, logDebug, targetDbUrls) {
  const start = Date.now();
  let currentPage = page;
  let externalClicked = false; // FLAG PENTING: Lock setelah konversi

  if (logDebug) logDebug(`🟢 Start Simulation (Duration: ${duration}ms)`);
  await sleep(1000); 

  const p = {
    scroll: baseCfg.scrollChance + (Math.random()*0.2 - 0.1),
    click: baseCfg.internalClickChance + (Math.random()*0.1 - 0.05),
    hover: baseCfg.hoverChance + (Math.random()*0.2 - 0.1)
  };

  while(Date.now() - start < duration) {
    const elapsed = Date.now() - start;
    let phase = 'orientation'; 
    if (elapsed > 3000 && elapsed <= 10000) phase = 'scanning'; 
    else if (elapsed > 10000) phase = 'reading'; 

    try {
      await dismissOverlays(currentPage, status, logDebug);
      currentPage = await handleRealPopups(currentPage, context, status, elapsed, logDebug);
      
      if (currentPage.isClosed()) {
          const pgs = context.pages();
          if(pgs.length>0) currentPage=pgs[0]; else break;
      }

      // 1. LOGIKA LOCKED (Jika sudah klik external)
	// ✅ FIX
	if (externalClicked) {
		if (currentPage.isClosed()) {  // ✅ Guard clause
			if (logDebug) logDebug('⚠️ External page closed, ending session');
			break;
		}
		status('Converted (Idle/Scroll)');
		try {
			if (Math.random() < 0.7) await humanScroll(currentPage, baseCfg, phase, logDebug);
			else await sleep(2000);
		} catch(e) {
			if (logDebug) logDebug('⚠️ External session error, ending');
			break;
		}
		await sleep(1000);
		continue;
	}


      // 2. LOGIKA NORMAL
      const r = Math.random();
      let actionDelay = getRandomInt(500, 1500);

      if (phase === 'orientation') {
          status('Orientation');
          await hoverRandomElement(currentPage);
      }
      else if (phase === 'scanning') {
           status('Scanning Content');
           await humanScroll(currentPage, baseCfg, phase, logDebug);
           if (r < 0.3) await hoverRandomElement(currentPage);
      }
      else {
          // Deep Reading
          if (r < 0.03) { status('Idle (Tab Switch)'); await simulateTabSwitch(currentPage); }
          else if (r < 0.08) { status('Fidgeting'); await performTextSelection(currentPage); }
          else if(r < p.scroll) { 
              status('Reading Scroll'); 
              await humanScroll(currentPage, baseCfg, phase, logDebug); 
              actionDelay = getRandomInt(1000, 5000); 
          }
          else if(r < p.scroll + p.hover) { 
              status('Focus Reading'); 
              await hoverRandomElement(currentPage); 
          }
          else if(r < p.scroll + p.hover + p.click) { 
              status('Click In (Smart)'); 
              // Panggil clickInternalLink dengan Database URL Awareness
              const ok = await clickInternalLink(currentPage, bl, targetDbUrls); 
              if(ok) { 
                  await networkJitter(currentPage); 
                  await handleCookies(currentPage, logDebug);
                  actionDelay = getRandomInt(2000, 4000); 
              }
          }
          else { 
              status('Click Out'); 
              const ok = await clickExternalLink(currentPage, bl); 
              if(ok) {
                  // AKTIFKAN LOCK
                  externalClicked = true;
                  if (logDebug) logDebug(`🎯 CONVERSION: External Link Clicked. Locking session.`);
                  await networkJitter(currentPage); 
                  actionDelay = 3000;
              }
          }
      }
      
      const finalDelay = Math.random() < 0.1 ? getRandomInt(50, 200) : actionDelay;
      await sleep(finalDelay); 

    } catch(e) { await sleep(1000); }
  }
  status('Done');
}

module.exports = {
  getRandomInt, getHumanDelay, sleep, networkJitter, handleCookies,
  randomScroll: humanScroll, 
  clickInternalLink, clickExternalLink, hoverRandomElement, 
  simulateHumanBehavior 
};