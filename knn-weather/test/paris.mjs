// Headless Playwright test: Paris 48.8566, 2.3522, k=5.
// Run: node knn-weather/test/paris.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = 8734;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));

  const browser = await chromium.launch({
    executablePath: '/Users/tc/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    await page.goto(`http://localhost:${PORT}/knn-weather/`, { waitUntil: 'domcontentloaded' });

    // Waits for a full compute cycle to finish. compute-btn is disabled
    // synchronously at the start of runCompute and re-enabled at the very end,
    // so this can't be fooled by a stale "results already visible" state left
    // over from a previous run (table visibility alone isn't a safe sentinel
    // once more than one compute happens on the same page).
    async function waitForComputeDone() {
      await page.waitForFunction(() => document.getElementById('compute-btn').disabled === true, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => document.getElementById('compute-btn').disabled === false, { timeout: 20000 });
    }

    await page.fill('#lat', '48.8566');
    await page.fill('#lon', '2.3522');
    await page.fill('#k', '5');
    await page.click('#compute-btn');
    await waitForComputeDone();

    const errText = await page.textContent('#error');
    const rows = await page.$$eval('#results-body tr', (trs) => trs.length);

    if (rows === 0) {
      fail(`no neighbour rows rendered. error box: "${errText}"`);
    } else if (rows !== 5) {
      fail(`expected 5 neighbour rows, got ${rows}`);
    } else {
      console.log(`OK: ${rows} neighbour rows rendered`);
    }

    // ICAOs should be plausible European stations near Paris.
    const icaos = await page.$$eval('#results-body tr td:nth-child(2)', (tds) => tds.map((td) => td.textContent));
    console.log(`neighbours: ${icaos.join(', ')}`);

    // Count neighbours with a non-missing temperature (proxy for "has observations").
    const obsCount = await page.$$eval('#results-body tr', (trs) =>
      trs.filter((tr) => {
        const tempCell = tr.children[6]; // temp column
        return tempCell && !tempCell.querySelector('.missing');
      }).length
    );

    const networkLikelyDown = consoleErrors.length > 0 || obsCount === 0;
    if (obsCount < 3) {
      // Distinguish "no network in sandbox" from "logic bug with network present".
      const iemReachable = await page.evaluate(async () => {
        try {
          const r = await fetch('https://mesonet.agron.iastate.edu/api/1/currents.json?station=LFPG');
          return r.ok;
        } catch (e) {
          return false;
        }
      });
      if (!iemReachable) {
        console.log('SKIP-EXPLICIT: live fetch failed in this sandbox (no network to mesonet.agron.iastate.edu) — cannot verify the >=3-observations criterion. This is NOT a pass.');
        process.exitCode = 2;
      } else {
        fail(`only ${obsCount} of 5 neighbours had observations (need >=3), and network reachability check succeeded — this is a real failure`);
      }
    } else {
      console.log(`OK: ${obsCount} of 5 neighbours have observations (>=3 required)`);
    }

    // IDW values finite and within [min, max] of neighbour values, per variable.
    const calcCheck = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('.calc-var').forEach((wrap) => {
        const label = wrap.querySelector('h3')?.textContent;
        const valueEl = wrap.querySelector('.calc-summary .value');
        if (!valueEl) { results.push({ label, skipped: true }); return; }
        const value = parseFloat(valueEl.textContent);
        const rows = [...wrap.querySelectorAll('table tbody tr')].map((tr) => parseFloat(tr.children[1].textContent));
        results.push({ label, value, rows });
      });
      return results;
    });

    for (const r of calcCheck) {
      if (r.skipped) { console.log(`calc "${r.label}": skipped (no data)`); continue; }
      if (!Number.isFinite(r.value)) { fail(`calc "${r.label}": IDW value is not finite`); continue; }
      const min = Math.min(...r.rows);
      const max = Math.max(...r.rows);
      if (r.value < min - 1e-6 || r.value > max + 1e-6) {
        fail(`calc "${r.label}": IDW value ${r.value} outside neighbour range [${min}, ${max}]`);
      } else {
        console.log(`OK: calc "${r.label}" = ${r.value}, within [${min}, ${max}]`);
      }
    }

    // STATUS box height must stay constant regardless of event text length —
    // it's exactly two fixed lines, not a scrolling log.
    const statusHeight0 = await page.$eval('#status-fixed', (el) => el.getBoundingClientRect().height);
    await page.click('#log-toggle'); // expand
    const statusHeightExpanded = await page.$eval('#status-fixed', (el) => el.getBoundingClientRect().height);
    await page.click('#log-toggle'); // collapse
    const statusHeightCollapsed = await page.$eval('#status-fixed', (el) => el.getBoundingClientRect().height);
    if (statusHeight0 !== statusHeightExpanded || statusHeight0 !== statusHeightCollapsed) {
      fail(`STATUS height not constant: ${statusHeight0} (base) vs ${statusHeightExpanded} (log expanded) vs ${statusHeightCollapsed} (log collapsed)`);
    } else {
      console.log(`OK: STATUS height constant across events (${statusHeight0}px)`);
    }

    // STATUS log line-count stability across repeated computes.
    await page.click('#compute-btn');
    await waitForComputeDone();
    const statusHeightAfterCompute1 = await page.$eval('#status-fixed', (el) => el.getBoundingClientRect().height);
    const lineCount1 = await page.$eval('#status-full', (el) => el.textContent.split('\n').filter(Boolean).length);
    await page.click('#compute-btn');
    await waitForComputeDone();
    const statusHeightAfterCompute2 = await page.$eval('#status-fixed', (el) => el.getBoundingClientRect().height);
    const lineCount2 = await page.$eval('#status-full', (el) => el.textContent.split('\n').filter(Boolean).length);
    if (lineCount1 !== lineCount2) {
      fail(`STATUS log line count not stable across repeated computes: ${lineCount1} vs ${lineCount2}`);
    } else {
      console.log(`OK: STATUS log line count stable across repeated computes (${lineCount1} lines)`);
    }
    if (statusHeightAfterCompute1 !== statusHeightAfterCompute2 || statusHeightAfterCompute1 !== statusHeight0) {
      fail(`STATUS height changed across computes: ${statusHeight0} vs ${statusHeightAfterCompute1} vs ${statusHeightAfterCompute2}`);
    } else {
      console.log(`OK: STATUS height constant across computes (${statusHeightAfterCompute1}px)`);
    }

    // History rows for at least 3 of 5 stations.
    const historyOk = await page.$$eval('.history-row', (rows) =>
      rows.filter((r) => !r.textContent.includes('no history')).length
    );
    if (historyOk < 3) {
      fail(`only ${historyOk} of 5 stations have 24h history rendered (need >=3)`);
    } else {
      console.log(`OK: ${historyOk} of 5 stations have 24h history rendered (>=3 required)`);
    }

    await page.screenshot({ path: '/Users/tc/.claude/jobs/f13f376f/tmp/knn-page.png', fullPage: true });
    console.log('screenshot saved to /Users/tc/.claude/jobs/f13f376f/tmp/knn-page.png');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error('FAIL: uncaught error', e);
  process.exitCode = 1;
});
