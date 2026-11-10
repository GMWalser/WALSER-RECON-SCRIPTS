// ==UserScript==
// @name         Vehicle Parts Database Logger
// @namespace    http://tampermonkey.net/
// @version      2.10
// @author       Gabe
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VEHICLE_PARTS_DATABASE.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/VEHICLE_PARTS_DATABASE.js
// @description  Two-step parts data collector. Step 1 (RV): collect vehicle RO numbers from bucket pages. Step 2 (Tekion): auto-scan each RO, scrape parts sold, export CSV. Builds a running history for part-fit probability analysis.
// @match        https://app.reconvision.com/departments/3127*
// @match        https://app.reconvision.com/departments/3139*
// @match        https://app.tekioncloud.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

const LOG = '[VPD]';
const IS_RV = location.hostname.includes('reconvision');
const IS_TK = location.hostname.includes('tekion');

// GM storage keys — ONLY small metadata, never bulk parts data
const LOGGED_KEY = 'vpd_logged_ros';      // { "RO#": timestamp, ... } — already scraped, ALL-TIME
const QUEUE_KEY  = 'vpd_scan_queue';      // [ { vin, year, make, model, stock, dmsRO }, ... ]
const TODAY_SCANNED_KEY = 'vpd_today_scanned'; // [ "RO#", ... ] — just THIS scan session, cleared on a fresh Start Scan

function getLogged() {
  try { return JSON.parse(GM_getValue(LOGGED_KEY, '{}')); } catch(e) { return {}; }
}
function saveLogged(obj) { GM_setValue(LOGGED_KEY, JSON.stringify(obj)); }

function getTodayScanned() {
  try { return JSON.parse(GM_getValue(TODAY_SCANNED_KEY, '[]')); } catch(e) { return []; }
}
function addTodayScanned(ro) {
  const list = getTodayScanned();
  if (!list.includes(ro)) {
    list.push(ro);
    GM_setValue(TODAY_SCANNED_KEY, JSON.stringify(list));
  }
}
function clearTodayScanned() { GM_setValue(TODAY_SCANNED_KEY, '[]'); }

function getQueue() {
  try { return JSON.parse(GM_getValue(QUEUE_KEY, '[]')); } catch(e) { return []; }
}
function saveQueue(arr) { GM_setValue(QUEUE_KEY, JSON.stringify(arr)); }

// =============================================
// RECONVISION SIDE — Collect vehicles from bucket
// =============================================
if (IS_RV) {

  function rvScrapeRows() {
    const vehicles = [];
    const seen = {};
    document.querySelectorAll('a.work-order-link').forEach(link => {
      const href = link.getAttribute('href') || '';
      const woMatch = href.match(/\/work_orders\/(\d+)/);
      if (!woMatch) return;
      const woId = woMatch[1];
      if (seen[woId]) return;
      seen[woId] = true;

      const firstNine = link.querySelector('.first-nine-vin');
      const restVin = link.querySelector('.rest-of-vin');
      const vin = (firstNine ? firstNine.innerText.trim() : '') +
                  (restVin ? restVin.innerText.trim() : '');

      const makeEl = link.querySelector('.info-bar__item--make');
      const ymm = makeEl ? makeEl.innerText.trim() : '';

      const stockEl = link.querySelector('.info-bar__item--stock div');
      const stock = stockEl ? stockEl.innerText.trim() : '';

      const roContainer = link.querySelector('.info-bar__item--repair-order-number');
      let dmsRO = '';
      if (roContainer) {
        const divs = roContainer.querySelectorAll(':scope > div');
        if (divs.length) dmsRO = divs[divs.length - 1].textContent.trim();
      }

      if (!dmsRO) { console.log(LOG, 'Skipping row — no DMS RO#, woId:', woId); return; }

      // Parse year/make/model from the combined string.
      // Format varies: "2022 Ford F-150" or "'22 Ford F-150" or multiline.
      // Clean up whitespace/newlines first, then try to split.
      const ymmClean = ymm.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
      const ymmParts = ymmClean.match(/^'?(\d{2,4})\s+(\S+)\s+(.+)$/);
      const year  = ymmParts ? (ymmParts[1].length === 2 ? '20' + ymmParts[1] : ymmParts[1]) : '';
      const make  = ymmParts ? ymmParts[2] : '';
      const model = ymmParts ? ymmParts[3] : '';
      const ymmRaw = ymmClean; // keep raw string as fallback

      vehicles.push({ vin, year, make, model, ymmRaw, stock, dmsRO, woId });
    });
    return vehicles;
  }

  let statusEl;

  function rvUpdateStatus(text) {
    if (statusEl) statusEl.textContent = text;
    console.log(LOG, text);
  }

  function rvBuildUI() {
    const bar = document.createElement('div');
    bar.id = 'vpd-bar';
    bar.style.cssText = `
      position:sticky;top:0;left:0;z-index:9999;background:#0d0d0d;
      border:2px solid #f59e0b;border-top:none;padding:10px 16px;
      display:flex;align-items:center;gap:10px;font-family:'Segoe UI',sans-serif;
      border-radius:0 0 8px 8px;width:fit-content;color:#fff;flex-wrap:wrap;
    `;

    statusEl = document.createElement('span');
    statusEl.style.cssText = 'font-size:13px;color:#9ca3af;';

    const collectBtn = document.createElement('button');
    collectBtn.textContent = '📋 Collect This Page';
    collectBtn.style.cssText = `
      background:#f59e0b;color:#000;font-weight:700;font-size:12px;
      border:none;border-radius:6px;padding:6px 14px;cursor:pointer;
    `;
    collectBtn.addEventListener('click', () => {
      const rows = rvScrapeRows();
      if (!rows.length) { rvUpdateStatus('No vehicles found on this page.'); return; }

      const logged = getLogged();
      const queue = getQueue();
      const queuedROs = new Set(queue.map(v => v.dmsRO));
      let added = 0;

      rows.forEach(v => {
        if (logged[v.dmsRO]) return;     // already scraped in a previous session
        if (queuedROs.has(v.dmsRO)) return; // already in queue from a previous collect
        queue.push(v);
        queuedROs.add(v.dmsRO);
        added++;
      });

      saveQueue(queue);
      rvUpdateStatus(`Added ${added} new vehicles. Queue total: ${queue.length}. Already logged: ${rows.length - added - (rows.length - added - added >= 0 ? 0 : 0)} on this page.`);
      const alreadyOnPage = rows.filter(r => logged[r.dmsRO]).length;
      const alreadyQueued = rows.length - added - alreadyOnPage;
      rvUpdateStatus(`Added ${added} new. Queue: ${queue.length} total. This page: ${alreadyOnPage} already logged, ${alreadyQueued} already queued.`);
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 Clear Queue';
    clearBtn.style.cssText = `
      background:#555;color:#fff;font-weight:700;font-size:12px;
      border:none;border-radius:6px;padding:6px 14px;cursor:pointer;
    `;
    clearBtn.addEventListener('click', () => {
      saveQueue([]);
      rvUpdateStatus('Queue cleared.');
    });

    const resetLoggedBtn = document.createElement('button');
    resetLoggedBtn.textContent = '🔄 Reset Logged';
    resetLoggedBtn.style.cssText = `
      background:#7f1d1d;color:#fca5a5;font-weight:700;font-size:12px;
      border:none;border-radius:6px;padding:6px 14px;cursor:pointer;
    `;
    resetLoggedBtn.addEventListener('click', () => {
      if (!confirm('This clears the list of already-scraped ROs. Next collect will re-queue everything. Continue?')) return;
      saveLogged({});
      rvUpdateStatus('Logged history cleared.');
    });

    bar.appendChild(statusEl);
    bar.appendChild(collectBtn);
    bar.appendChild(clearBtn);
    bar.appendChild(resetLoggedBtn);

    const main = document.querySelector('main.content') || document.body;
    main.insertBefore(bar, main.firstChild);

    // Initial status
    const queue = getQueue();
    const logged = getLogged();
    rvUpdateStatus(`Queue: ${queue.length} pending. ${Object.keys(logged).length} ROs logged all-time.`);
  }

  setTimeout(rvBuildUI, 1000);
}

// =============================================
// TEKION SIDE — Auto-scan queued ROs, scrape parts
// =============================================
if (IS_TK) {

  // Parts data saved to GM storage incrementally after each vehicle.
  // This survives page reloads mid-scan (the back-button fallback does
  // location.href which wipes in-memory data). Session data is cleared
  // after CSV export. Size is trivial for one scan batch (~50KB max).
  const SESSION_PARTS_KEY = 'vpd_session_parts';

  function getSessionParts() {
    try { return JSON.parse(GM_getValue(SESSION_PARTS_KEY, '[]')); } catch(e) { return []; }
  }
  function appendSessionParts(newParts) {
    const all = getSessionParts();
    all.push(...newParts);
    GM_setValue(SESSION_PARTS_KEY, JSON.stringify(all));
  }
  function clearSessionParts() {
    GM_setValue(SESSION_PARTS_KEY, '[]');
  }

  let scanning = false;
  let cleaning = false;
  let sessionOpen = false; // true once the bar is shown; only an explicit close (button, or cleanup finishing) resets it
  let statusEl, progressEl, startBtn, exportBtn, cleanupBtn;

  function tkLog(...args) { console.log(LOG, ...args); }

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fireClick(el) {
    // Coordinates added to match the proven-reliable pattern already used
    // in Clipboard.js's drawer button -- the RO dropdown list is
    // virtualized (rc-virtual-list, confirmed via real DOM inspection),
    // where position-based hit-testing is more likely to matter than on a
    // plain button.
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  }

  function waitForEl(selector, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) { clearInterval(check); resolve(el); }
        else if (Date.now() - start > timeoutMs) {
          clearInterval(check);
          reject(new Error('Timed out waiting for: ' + selector));
        }
      }, 100);
    });
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Single shared place for "exit the current RO by clicking Save as Draft."
  // Previously this logic was duplicated at 3 call sites and only 2 of them
  // actually had it -- the error path was missing it entirely, which is why
  // a failed vehicle would leave the browser signed into that RO instead of
  // exiting. Now every exit point calls this same function.
  const SAVE_SEL = '[data-test-id="@tekion-parts-partsRoSalesDetailedView-formFooter-tertiaryButton"]';
  const CREATE_SEL = '[data-test-id="@tekion-parts-partsRoSales-common-createGroupedPartRequestsModalButton"]';
  // Returns true when the RO screen actually closed (Save as Draft went through).
  async function tkExitCurrentRO() {
    const saveBtn = document.querySelector(SAVE_SEL);
    if (!saveBtn) { tkLog('Save as Draft button not found -- either already exited, or not inside an RO.'); return true; }
    fireClick(saveBtn);
    tkLog('Clicked Save as Draft to exit RO.');
    for (let i = 0; i < 40; i++) {                 // up to 6 s, usually much less
      await delay(150);
      const b = document.querySelector(SAVE_SEL);
      if (!b || !b.isConnected) { tkLog('RO screen closed.'); return true; }
    }
    tkLog('RO screen did not close after Save as Draft -- will be revisited by cleanup.');
    return false;
  }
  // ROs whose exit could not be confirmed (only these need the cleanup pass)
  function getNeedsCleanup() { try { return JSON.parse(GM_getValue('vpd_needs_cleanup', '[]')); } catch (e) { return []; } }
  function markNeedsCleanup(ro, need) {
    const l = getNeedsCleanup().filter(x => x !== ro); if (need) l.push(ro);
    GM_setValue('vpd_needs_cleanup', JSON.stringify(l));
  }
  // Back on the fulfillment list without reloading Tekion? (true = keep going on this page)
  async function tkBackOnList() {
    if (document.querySelector(SAVE_SEL)) return false;
    try { await waitForEl(CREATE_SEL, 3000); return true; } catch (e) { return false; }
  }
  const roTimes = [];
  function avgText() { if (!roTimes.length) return ''; const a = roTimes.reduce((x, y) => x + y, 0) / roTimes.length; return ` · avg ${a.toFixed(1)} s/RO`; }

  // ---- Scrape the current RO's parts from the fulfillment view ----
  // NOTE: These selectors are from v0.6 and have NEVER been verified
  // against real Tekion data. Logging is included at every step so when
  // something doesn't match, the console output shows exactly what to fix.
  function tkScrapeCurrentRO(vehicle) {
    const parts = [];
    const today = new Date().toISOString().split('T')[0];

    const getCell = (rowEl, field) => {
      let cellEl = rowEl.querySelector(`[data-test-id*="-field-bin-${field}-cell"]`);
      if (!cellEl) cellEl = rowEl.querySelector(`[data-test-id*="${field}-cell"]`);
      if (!cellEl) cellEl = rowEl.querySelector(`[data-test-id*="${field}"]`);
      return cellEl ? cellEl.textContent.trim() : '';
    };

    function scrapeRow(rowEl, jobTitle) {
      const rawItemName = getCell(rowEl, 'itemName');
      if (!rawItemName || rawItemName === 'Select') return null;

      // Tekion combines part# and description as "WL10514 - OIL FILTER".
      // Split on the first " - " to separate them.
      let partNumber = rawItemName;
      let itemName = rawItemName;
      const dashIdx = rawItemName.indexOf(' - ');
      if (dashIdx > 0) {
        partNumber = rawItemName.substring(0, dashIdx).trim();
        itemName = rawItemName.substring(dashIdx + 3).trim();
      }

      // Skip PULSE modules — every car gets these, they're noise for prediction
      if (partNumber.toUpperCase() === 'PULSE') return null;

      return {
        vin: vehicle.vin,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        ymmRaw: vehicle.ymmRaw || '',
        stock: vehicle.stock,
        dmsRO: vehicle.dmsRO,
        job: jobTitle,
        partNumber: partNumber,
        itemName: itemName,
        qty: getCell(rowEl, 'requiredQuantity') || getCell(rowEl, 'qty') || getCell(rowEl, 'quantity') || '1',
        costPrice: getCell(rowEl, 'costPrice') || getCell(rowEl, 'cost'),
        listPrice: getCell(rowEl, 'listPrice') || getCell(rowEl, 'list'),
        sellingPrice: getCell(rowEl, 'sellingPrice') || getCell(rowEl, 'selling'),
        totalPrice: getCell(rowEl, 'totalPrice') || getCell(rowEl, 'total'),
        dateScraped: today,
      };
    }

    // Try job sections first
    const jobSections = document.querySelectorAll('[id^="Job"][class*="root_section_container"]');
    tkLog('Job sections found:', jobSections.length);

    if (jobSections.length) {
      jobSections.forEach((jobEl, jobIdx) => {
        const jobId = jobEl.id || ('Section' + jobIdx);
        const jobTitleEl = jobEl.querySelector('h1, h2, h3, [class*="heading"], [class*="Header"], [class*="title"]');
        const jobTitle = jobTitleEl ? jobTitleEl.textContent.trim() : jobId;
        tkLog('Scraping job section:', jobId, '—', jobTitle);

        jobEl.querySelectorAll('[id^="automation_selector_tr_row_"]').forEach((rowEl, rowIdx) => {
          const part = scrapeRow(rowEl, jobTitle);
          if (part) {
            tkLog('  Row', rowIdx, '— part:', part.itemName, '| qty:', part.qty);
            parts.push(part);
          }
        });
      });
    } else {
      // No job sections — scrape all rows directly
      const allRows = document.querySelectorAll('[id^="automation_selector_tr_row_"]');
      tkLog('No job sections. Scraping', allRows.length, 'rows directly.');

      allRows.forEach((rowEl, rowIdx) => {
        const part = scrapeRow(rowEl, '(no job section)');
        if (part) {
          tkLog('  Row', rowIdx, '— part:', part.itemName, '| qty:', part.qty);
          parts.push(part);
        } else {
          // Log what we DO see in this row to diagnose selector issues
          if (rowIdx < 3) {
            tkLog('  Row', rowIdx, '— no itemName found. Row data-test-ids:');
            rowEl.querySelectorAll('[data-test-id]').forEach(el => {
              tkLog('    ', el.getAttribute('data-test-id'), '→', el.textContent.trim().substring(0, 50));
            });
          }
        }
      });
    }

    tkLog('Total parts scraped for RO', vehicle.dmsRO, ':', parts.length);
    return parts;
  }

  // ---- Process one vehicle through the fulfillment flow ----
  async function tkProcessOneVehicle(vehicle) {
    tkLog('=== Processing RO#', vehicle.dmsRO, '(Stock:', vehicle.stock, ') ===');

    // Step 1: Click "Create Fulfillment" / "Create Grouped Part Requests" button
    tkLog('Step 1: Looking for Create Fulfillment button...');
    let createBtn;
    try {
      createBtn = await waitForEl(
        '[data-test-id="@tekion-parts-partsRoSales-common-createGroupedPartRequestsModalButton"]',
        5000
      );
    } catch(e) {
      tkLog('ERROR: Create Fulfillment button not found. Are you on the Parts Fulfillment page?');
      tkLog('Current URL:', location.href);
      return false;
    }
    fireClick(createBtn);
    tkLog('Step 1: Clicked Create Fulfillment button.');
    await delay(150);

    // Step 2: Type RO# into the search input
    tkLog('Step 2: Looking for RO search input...');
    let roInput;
    try {
      // BUG FIX (confirmed via real DOM inspection on 8/26): Tekion
      // upgraded to Ant Design v5, which renamed
      // input.ant-select-search__field to
      // input.ant-v5-select-selection-search-input. Same root cause found
      // and fixed in Bucket Mover and Clipboard the same day. Tekion's own
      // data-test-id attributes are unaffected -- only AntD's own classes.
      // FURTHER FIX (8/26, applying Bucket Mover v3.15's already-confirmed
      // fix here too): the bare class selector above matches ANY
      // searchable select on the page, including Tekion's ALWAYS-PRESENT
      // header search-type dropdown -- not just this modal's RO field.
      // Scoping to the modal's own data-test-id prefix (same modal button
      // as Bucket Mover: createGroupedPartRequestsModalButton) so this
      // only finds nothing and keeps waiting if the modal isn't open yet,
      // instead of grabbing the wrong field.
      roInput = await waitForEl(
        '[data-test-id^="@tekion-parts-partsRoSales-common-createGroupedPartRequestsSelect"] input.ant-v5-select-selection-search-input, [data-test-id^="@tekion-parts-partsRoSales-common-createGroupedPartRequestsSelect"] input.ant-select-search__field',
        5000
      );
    } catch(e) {
      tkLog('ERROR: RO search input not found. Selectors may need updating.');
      tkLog('Modal HTML sample:', document.querySelector('[class*="modal"]')?.innerHTML?.substring(0, 500) || 'no modal found');
      return false;
    }
    roInput.focus();
    setNativeValue(roInput, vehicle.dmsRO);
    tkLog('Step 2: Typed RO#', vehicle.dmsRO, 'into search.');
    await delay(300);

    // Step 3: Select the matching dropdown option
    tkLog('Step 3: Looking for dropdown option matching RO#', vehicle.dmsRO);
    let matchFound = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      // FIX (8/26, applying Bucket Mover v3.16's confirmed fix): match the
      // option directly by its title attribute, confirmed via real DOM
      // screenshot to equal the exact RO number (title="7322992"). There
      // is no role="option" attribute on these rows at all. Do NOT exclude
      // #SearchList -- confirmed the correct option row also lives inside
      // that container, so excluding it was the actual bug in Bucket
      // Mover before this fix.
      const opts = document.querySelectorAll(`.ant-v5-select-item-option[title="${vehicle.dmsRO}"], .ant-select-item-option[title="${vehicle.dmsRO}"]`);
      tkLog('Step 3: Attempt', attempt, '— options visible:', opts.length);
      if (opts.length) {
        const opt = opts[0];
        fireClick(opt);
        tkLog('Step 3: Selected option:', opt.textContent.trim());
        matchFound = true;
      }
      if (matchFound) break;
      await delay(200);
    }
    if (!matchFound) {
      tkLog('ERROR: No dropdown option matched RO#', vehicle.dmsRO);
      return false;
    }
    await delay(150);

    // Step 4: Click Submit
    tkLog('Step 4: Looking for Submit button...');
    let submitBtn;
    try {
      submitBtn = await waitForEl(
        '[data-test-id="@tekion-parts-roSalesDetailedView-createGroupedPartRequestsModal-container-submitButton"]',
        5000
      );
    } catch(e) {
      tkLog('ERROR: Submit button not found.');
      return false;
    }
    // Wait for it to be enabled
    for (let i = 0; i < 20; i++) {
      if (!submitBtn.disabled) break;
      await delay(150);
    }
    if (submitBtn.disabled) {
      tkLog('ERROR: Submit button stayed disabled.');
      return false;
    }
    fireClick(submitBtn);
    tkLog('Step 4: Clicked Submit.');
    await delay(500);

    // Step 5: Wait for job tables / part rows to render
    tkLog('Step 5: Waiting for part data to load...');
    let dataLoaded = false;
    for (let i = 0; i < 40; i++) {
      const rows = document.querySelectorAll('[id^="automation_selector_tr_row_"]');
      if (rows.length) {
        tkLog('Step 5: Data loaded — rows:', rows.length);
        dataLoaded = true;
        break;
      }
      await delay(250);
    }
    if (!dataLoaded) {
      tkLog('WARNING: No job sections/rows appeared after waiting. May be an RO with no parts.');
    }
    await delay(200); // let everything finish rendering

    // Step 6: Scrape
    tkLog('Step 6: Scraping parts...');
    const parts = tkScrapeCurrentRO(vehicle);
    return parts;
  }

  // ---- Run through the entire queue ----
  // Uses a GM storage flag so the scan automatically resumes after any
  // page reload (back-button fallback). Click once, walk away.
  const SCAN_ACTIVE_KEY = 'vpd_scan_active';
  const SCAN_INDEX_KEY  = 'vpd_scan_index';

  function setScanActive(active) { GM_setValue(SCAN_ACTIVE_KEY, active ? '1' : '0'); }
  function isScanActive() { return GM_getValue(SCAN_ACTIVE_KEY, '0') === '1'; }
  function setScanIndex(idx) { GM_setValue(SCAN_INDEX_KEY, String(idx)); }
  function getScanIndex() { return parseInt(GM_getValue(SCAN_INDEX_KEY, '0'), 10) || 0; }

  async function tkRunFullScan() {
    const queue = getQueue();
    if (!queue.length) {
      tkUpdateStatus('Nothing in queue. Go to RV and click "Collect This Page" first.');
      return;
    }

    scanning = true;
    setScanActive(true);
    startBtn.disabled = true;
    startBtn.textContent = '⏹ Stop';
    startBtn.disabled = false;
    const logged = getLogged();
    let startIdx = getScanIndex();
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = startIdx; i < queue.length; i++) {
      if (!scanning) {
        tkLog('Scan stopped by user.');
        setScanActive(false);
        break;
      }

      setScanIndex(i); // save position so we resume here after reload
      const vehicle = queue[i];
      const roStart = Date.now();

      if (logged[vehicle.dmsRO]) {
        skipped++;
        continue;
      }

      tkUpdateProgress(`${i + 1}/${queue.length} — RO# ${vehicle.dmsRO} (${vehicle.year} ${vehicle.make} ${vehicle.model})`);
      addTodayScanned(vehicle.dmsRO);

      const parts = await tkProcessOneVehicle(vehicle);

      if (parts === false) {
        errors++;
        tkLog('ERROR processing RO#', vehicle.dmsRO, '— skipping.');
        // Mark errored ROs as logged too so we don't retry them forever
        logged[vehicle.dmsRO] = Date.now();
        saveLogged(logged);

        // BUG FIX: this path used to just `continue` without ever clicking
        // Save as Draft or navigating away -- if processing failed partway
        // through (e.g. after Create Fulfillment was already clicked), the
        // browser was left sitting inside that RO indefinitely. Now it exits
        // the same way the success path does, regardless of whether this
        // failed vehicle was in the middle of the queue or the last one.
        tkUpdateProgress(`${i + 1}/${queue.length} — error, exiting RO...`);
        markNeedsCleanup(vehicle.dmsRO, !(await tkExitCurrentRO()));
        if (i < queue.length - 1) {
          setScanIndex(i + 1);
          if (await tkBackOnList()) continue;            // no reload needed
          location.href = 'https://app.tekioncloud.com/parts/ro-sales/parts-fulfillment';
          return; // script will reload and auto-resume from the new index
        }
        continue;
      }

      if (parts.length > 0) {
        appendSessionParts(parts);
        logged[vehicle.dmsRO] = Date.now();
        saveLogged(logged);
      }
      processed++;

      tkLog('Completed RO#', vehicle.dmsRO, '—', parts.length, 'parts.');

      // Exit the RO properly by clicking "Save as Draft", then navigate back
      tkUpdateProgress(`${i + 1}/${queue.length} — saving & exiting RO...`);
      markNeedsCleanup(vehicle.dmsRO, !(await tkExitCurrentRO()));
      roTimes.push((Date.now() - roStart) / 1000);
      tkUpdateProgress(`${i + 1}/${queue.length} done${avgText()}`);
      if (i < queue.length - 1) {
        setScanIndex(i + 1);
        if (await tkBackOnList()) continue;              // Tekion is back on the list: no full reload
        location.href = 'https://app.tekioncloud.com/parts/ro-sales/parts-fulfillment';
        return; // script will reload and auto-resume from the new index
      }
    }

    // Scan fully complete
    scanning = false;
    setScanActive(false);
    setScanIndex(0);

    const sessionParts = getSessionParts();
    tkLog(`Done! Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}, Total parts: ${sessionParts.length}`);

    if (sessionParts.length) {
      // Auto-export and clean up
      tkExportCSV();
    } else {
      // Nothing to export -- clear queue, but keep the bar up so the
      // cleanup button stays reachable
      saveQueue([]);
      tkUpdateStatus('Scan complete. Run cleanup below, or close when done.');
    }
  }

  // ---- Cleanup pass: force-exit every already-logged RO ----
  // NEW (9/16/26): coworkers reported staying "logged into" ROs after a
  // scan, even though tkExitCurrentRO() is already called on every path
  // (success, error, and the final RO) in the main scan loop above. Root
  // cause not yet confirmed with real console evidence. This is a
  // pragmatic safety net: revisits every RO# already in the `logged`
  // dict and force-clicks Save as Draft, without re-scraping parts. Its
  // own GM keys (separate from the main scan's) so it can't collide with
  // a real scan in progress, and it doubles as an isolated diagnostic --
  // if "Save as Draft button not found" shows up in the console during
  // this pass, that confirms the selector itself is the real problem.
  const CLEANUP_ACTIVE_KEY = 'vpd_cleanup_active';
  const CLEANUP_INDEX_KEY  = 'vpd_cleanup_index';

  function setCleanupActive(active) { GM_setValue(CLEANUP_ACTIVE_KEY, active ? '1' : '0'); }
  function isCleanupActive() { return GM_getValue(CLEANUP_ACTIVE_KEY, '0') === '1'; }
  function setCleanupIndex(idx) { GM_setValue(CLEANUP_INDEX_KEY, String(idx)); }
  function getCleanupIndex() { return parseInt(GM_getValue(CLEANUP_INDEX_KEY, '0'), 10) || 0; }

  // Same Steps 1-4 as tkProcessOneVehicle, kept as a separate copy rather
  // than refactored out of the already-confirmed-working scrape function,
  // to avoid any risk of regressing it.
  async function tkOpenROForCleanup(dmsRO) {
    tkLog('=== Cleanup: opening RO#', dmsRO, '===');
    let createBtn;
    try {
      createBtn = await waitForEl(
        '[data-test-id="@tekion-parts-partsRoSales-common-createGroupedPartRequestsModalButton"]',
        5000
      );
      fireClick(createBtn);
      await delay(150);
    } catch(e) {
      tkLog('Cleanup: Create Fulfillment button not found -- RO may already be open, or not reachable this way.');
      return false;
    }

    let roInput;
    try {
      roInput = await waitForEl(
        '[data-test-id^="@tekion-parts-partsRoSales-common-createGroupedPartRequestsSelect"] input.ant-v5-select-selection-search-input, [data-test-id^="@tekion-parts-partsRoSales-common-createGroupedPartRequestsSelect"] input.ant-select-search__field',
        5000
      );
    } catch(e) {
      tkLog('Cleanup: RO search input not found.');
      return false;
    }
    roInput.focus();
    setNativeValue(roInput, dmsRO);
    await delay(300);

    let matchFound = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const opts = document.querySelectorAll(`.ant-v5-select-item-option[title="${dmsRO}"], .ant-select-item-option[title="${dmsRO}"]`);
      if (opts.length) {
        fireClick(opts[0]);
        matchFound = true;
      }
      if (matchFound) break;
      await delay(200);
    }
    if (!matchFound) {
      tkLog('Cleanup: No dropdown option matched RO#', dmsRO);
      return false;
    }
    await delay(150);

    let submitBtn;
    try {
      submitBtn = await waitForEl(
        '[data-test-id="@tekion-parts-roSalesDetailedView-createGroupedPartRequestsModal-container-submitButton"]',
        5000
      );
    } catch(e) {
      tkLog('Cleanup: Submit button not found.');
      return false;
    }
    for (let i = 0; i < 20; i++) {
      if (!submitBtn.disabled) break;
      await delay(150);
    }
    if (submitBtn.disabled) {
      tkLog('Cleanup: Submit button stayed disabled.');
      return false;
    }
    fireClick(submitBtn);
    await delay(800);
    tkLog('Cleanup: Opened RO#', dmsRO, '-- now exiting.');
    return true;
  }

  async function tkRunCleanupPass() {
    const roList = getNeedsCleanup();
    if (!roList.length) {
      tkUpdateStatus('All scanned ROs were exited during the scan -- nothing to clean up.');
      clearTodayScanned();
      return;
    }

    cleaning = true;
    setCleanupActive(true);
    cleanupBtn.textContent = '⏹ Stop Cleanup';

    let startIdx = getCleanupIndex();
    let exited = 0;
    let failed = 0;

    for (let i = startIdx; i < roList.length; i++) {
      if (!cleaning) {
        tkLog('Cleanup stopped by user.');
        setCleanupActive(false);
        break;
      }

      setCleanupIndex(i);
      const dmsRO = roList[i];
      tkUpdateProgress(`Cleanup ${i + 1}/${roList.length} — RO# ${dmsRO}`);

      const opened = await tkOpenROForCleanup(dmsRO);
      const closed = await tkExitCurrentRO();   // also covers an RO already open from an earlier attempt
      if (opened && closed) { exited++; markNeedsCleanup(dmsRO, false); } else failed++;

      if (i < roList.length - 1) {
        setCleanupIndex(i + 1);
        if (await tkBackOnList()) continue;
        location.href = 'https://app.tekioncloud.com/parts/ro-sales/parts-fulfillment';
        return; // script reloads and auto-resumes from the new index
      }
    }

    cleaning = false;
    setCleanupActive(false);
    setCleanupIndex(0);
    cleanupBtn.textContent = "🧹 Exit Today's ROs";
    tkLog(`Cleanup done. Exited: ${exited}, Failed to confirm: ${failed}.`);
    clearTodayScanned();
    sessionOpen = false;
    const bar = document.getElementById('vpd-tk-bar');
    if (bar) bar.remove();
  }

  // ---- Export CSV ----
  function tkExportCSV() {
    const parts = getSessionParts();
    if (!parts.length) {
      alert('No parts data to export yet. Run a scan first.');
      return;
    }

    const headers = [
      'VIN', 'Year', 'Make', 'Model', 'YearMakeModel', 'Stock', 'RO',
      'Job', 'PartNumber', 'ItemName', 'Qty',
      'CostPrice', 'ListPrice', 'SellingPrice', 'TotalPrice',
      'DateScraped'
    ];

    const csvRows = [headers.join(',')];
    parts.forEach(p => {
      csvRows.push([
        p.vin, p.year, p.make, p.model, p.ymmRaw || '', p.stock, p.dmsRO,
        p.job, p.partNumber, p.itemName, p.qty,
        p.costPrice, p.listPrice, p.sellingPrice, p.totalPrice,
        p.dateScraped
      ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vehicle_parts_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    tkLog('Exported CSV with', parts.length, 'part rows.');
    clearSessionParts();
    saveQueue([]);
    tkUpdateStatus('CSV exported. Run cleanup below, or close when done.');
  }

  function tkClearSession() {
    if (!confirm('Clear all scraped parts from this session? (Only do this after you have exported the CSV)')) return;
    clearSessionParts();
    tkUpdateStatus('Session data cleared.');
  }

  function tkUpdateStatus(text) {
    if (statusEl) statusEl.textContent = text;
    tkLog(text);
  }

  function tkUpdateProgress(text) {
    if (progressEl) progressEl.textContent = text;
  }

  // ---- Build UI ----
  function tkBuildUI() {
    if (!location.pathname.includes('/parts/ro-sales/parts-fulfillment')) return;

    // Only show when there's actual work: unscanned vehicles in queue, or parts to export
    const queue = getQueue();
    const sessionParts = getSessionParts();
    const logged = getLogged();
    const unscanned = queue.filter(v => !logged[v.dmsRO]).length;

    // Clear stale scan flag if there's nothing left to scan
    if (!unscanned && isScanActive()) {
      setScanActive(false);
      setScanIndex(0);
    }

    if (!unscanned && !sessionParts.length && !cleaning && !isCleanupActive()) {
      if (!sessionOpen) {
        const old = document.getElementById('vpd-tk-bar');
        if (old) old.remove();
      }
      return; // nothing to do right now -- if a bar is legitimately open (sessionOpen), leave it up until explicitly closed
    }

    if (document.getElementById('vpd-tk-bar')) return;
    sessionOpen = true;

    const bar = document.createElement('div');
    bar.id = 'vpd-tk-bar';
    bar.style.cssText = `
      position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;
      background:#0d0d0d;border:2px solid #f59e0b;border-radius:10px;
      padding:10px 18px;display:flex;align-items:center;gap:10px;
      font-family:'Segoe UI',sans-serif;font-size:13px;color:#fff;
      box-shadow:0 4px 20px rgba(0,0,0,.6);flex-wrap:wrap;max-width:90vw;
    `;

    statusEl = document.createElement('span');
    statusEl.style.color = '#9ca3af';

    progressEl = document.createElement('span');
    progressEl.style.cssText = 'color:#fbbf24;font-weight:700;';

    startBtn = document.createElement('button');
    startBtn.textContent = '▶ Start Scan';
    startBtn.style.cssText = `
      background:#f59e0b;color:#000;font-weight:700;font-size:12px;
      border:none;border-radius:6px;padding:6px 14px;cursor:pointer;
    `;
    startBtn.addEventListener('click', () => {
      if (scanning || isScanActive()) {
        scanning = false;
        setScanActive(false);
        startBtn.textContent = '▶ Start Scan';
        tkUpdateStatus('Scan stopped.');
      } else {
        setScanIndex(0);
        clearTodayScanned();
        tkRunFullScan();
      }
    });

    exportBtn = document.createElement('button');
    exportBtn.textContent = '📥 Export CSV';
    exportBtn.style.cssText = `
      background:#555;color:#fff;font-weight:700;font-size:12px;
      border:none;border-radius:6px;padding:6px 14px;cursor:pointer;
    `;
    exportBtn.addEventListener('click', tkExportCSV);

    cleanupBtn = document.createElement('button');
    cleanupBtn.textContent = "🧹 Exit Today's ROs";
    cleanupBtn.title = 'Revisits only ROs that did not close during the scan, and clicks Save as Draft on each.';
    cleanupBtn.style.cssText = `
      background:#7c3aed;color:#fff;font-weight:700;font-size:12px;
      border:none;border-radius:6px;padding:6px 14px;cursor:pointer;
    `;
    cleanupBtn.addEventListener('click', () => {
      if (cleaning || isCleanupActive()) {
        cleaning = false;
        setCleanupActive(false);
        cleanupBtn.textContent = "🧹 Exit Today's ROs";
        tkUpdateStatus('Cleanup stopped.');
      } else {
        setCleanupIndex(0);
        tkRunCleanupPass();
      }
    });

    bar.appendChild(statusEl);
    bar.appendChild(progressEl);
    bar.appendChild(startBtn);
    bar.appendChild(exportBtn);
    bar.appendChild(cleanupBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✖';
    closeBtn.title = 'Close (only if scan and cleanup are both done)';
    closeBtn.style.cssText = `
      background:transparent;color:#9ca3af;font-weight:700;font-size:14px;
      border:none;padding:4px 8px;cursor:pointer;
    `;
    closeBtn.addEventListener('click', () => {
      if (scanning || cleaning) {
        alert('Scan or cleanup is still running -- stop it first.');
        return;
      }
      sessionOpen = false;
      bar.remove();
    });
    bar.appendChild(closeBtn);

    document.body.appendChild(bar);

    const queueNow = getQueue();
    const loggedNow = getLogged();
    const partsNow = getSessionParts();
    const unscannedNow = queueNow.filter(v => !loggedNow[v.dmsRO]).length;
    let status = unscannedNow > 0
      ? `${unscannedNow} vehicles ready to scan.`
      : `${Object.keys(loggedNow).length} ROs logged all-time.`;
    if (partsNow.length) status += ` ${partsNow.length} parts ready to export.`;
    tkUpdateStatus(status);

    // Auto-resume: if a scan was in progress when the page reloaded, continue it
    if (isScanActive()) {
      tkLog('Auto-resuming scan from index', getScanIndex());
      setTimeout(() => tkRunFullScan(), 600);
    }
    // Auto-resume: same for an in-progress cleanup pass
    if (isCleanupActive()) {
      tkLog('Auto-resuming cleanup pass from index', getCleanupIndex());
      cleanupBtn.textContent = '⏹ Stop Cleanup';
      setTimeout(() => tkRunCleanupPass(), 600);
    }
  }

  // Check for fulfillment page on load and on SPA navigation
  tkBuildUI();
  let uiT = 0;                                    // at most twice a second (Tekion changes the page constantly)
  const obs = new MutationObserver(() => { if (!uiT) uiT = setTimeout(() => { uiT = 0; tkBuildUI(); }, 500); });
  obs.observe(document.body, { childList: true, subtree: true });
}

})();