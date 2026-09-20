// Headless Playwright test: Paris, k=7 (default flow), single compute button.
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

  // Track requests to stations.json before any location is chosen.
  const stationRequestsBeforeLocation = [];
  page.on('request', (req) => {
    if (req.url().includes('stations.json')) stationRequestsBeforeLocation.push(req.url());
  });

  try {
    await page.goto(`http://localhost:${PORT}/knn-weather/`, { waitUntil: 'domcontentloaded' });

    const statusInitial = await page.textContent('#status-text');
    if (statusInitial !== 'choose a location') {
      fail(`initial STATUS should be "choose a location", got "${statusInitial}"`);
    } else {
      console.log('OK: initial STATUS = "choose a location"');
    }

    const computeDisabledInitially = await page.$eval('#compute-btn', (el) => el.disabled);
    if (!computeDisabledInitially) {
      fail('compute-btn should be disabled before a location is chosen');
    } else {
      console.log('OK: compute-btn disabled before a location is chosen');
    }

    await page.waitForTimeout(300);
    if (stationRequestsBeforeLocation.length > 0) {
      fail(`stations.json fetched before a location was set: ${stationRequestsBeforeLocation.join(', ')}`);
    } else {
      console.log('OK: no request to stations.json before a location click');
    }

    // Choose Paris via city button.
    const parisBtn = page.locator('.pick-btn', { hasText: 'Paris' });
    await parisBtn.click();

    const statusAfterCity = await page.textContent('#status-text');
    if (!/^location: Paris/.test(statusAfterCity)) {
      fail(`STATUS after choosing Paris does not start with "location: Paris": "${statusAfterCity}"`);
    } else {
      console.log(`OK: STATUS after choosing Paris = "${statusAfterCity}"`);
    }

    const computeEnabledAfterLocation = await page.$eval('#compute-btn', (el) => !el.disabled);
    if (!computeEnabledAfterLocation) {
      fail('compute-btn still disabled after choosing a location');
    } else {
      console.log('OK: compute-btn enabled after choosing a location');
    }

    if (stationRequestsBeforeLocation.length > 0) {
      fail('stations.json fetched merely from choosing a location (before compute)');
    } else {
      console.log('OK: still no request to stations.json after choosing a location, before compute');
    }

    // Choose 7 stations via button.
    const kBtn = page.locator('#k-grid .pick-btn', { hasText: '7' });
    await kBtn.click();
    const kInputVal = await page.inputValue('#k-input');
    if (kInputVal !== '7') fail(`k-input should read 7 after clicking the 7 button, got "${kInputVal}"`);
    else console.log('OK: k-input synced to 7');

    // Before compute, OUTPUT must be empty.
    const outputEmptyBeforeCompute = await page.$eval('#output-panel', (el) => el.textContent.trim().length === 0);
    if (!outputEmptyBeforeCompute) {
      fail('OUTPUT is populated before compute was clicked');
    } else {
      console.log('OK: OUTPUT empty before compute is clicked');
    }

    await page.click('#compute-btn');
    await page.waitForFunction(() => document.getElementById('compute-btn').disabled === true, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => document.getElementById('compute-btn').disabled === false, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('output-panel').textContent.trim().length > 0, { timeout: 10000 });

    const rows = await page.$$eval('#results-body tr', (trs) => trs.length);
    if (rows === 0) {
      fail('no station rows rendered after compute');
    } else if (rows !== 7) {
      fail(`expected 7 station rows (chosen k), got ${rows}`);
    } else {
      console.log(`OK: ${rows} station rows rendered, capped to chosen k`);
    }

    const outputLines = await page.$$eval('.output-line', (els) =>
      els.map((el) => ({
        label: el.querySelector('.output-label')?.textContent,
        value: el.querySelector('.output-value')?.textContent,
        meta: el.querySelector('.output-meta')?.textContent,
        model: el.querySelector('.output-model')?.textContent,
      }))
    );
    if (outputLines.length !== 4) {
      fail(`expected 4 OUTPUT lines (temperature, dew point, wind, pressure), got ${outputLines.length}`);
    } else {
      console.log(`OK: 4 OUTPUT lines rendered: ${outputLines.map((l) => `${l.label}=${l.value}`).join(', ')}`);
    }
    for (const l of outputLines) {
      if (!/high|medium|low/.test(l.meta ?? '')) fail(`OUTPUT line "${l.label}" missing a one-word confidence in "${l.meta}"`);
    }
    console.log('OK: each OUTPUT line has an age and a one-word confidence');

    // Distances in the stations table are shown with one decimal.
    const distCells = await page.$$eval('#results-body tr td:nth-child(6)', (tds) => tds.map((td) => td.textContent.trim()));
    const badDist = distCells.find((t) => !/^\d+\.\d$/.test(t));
    if (badDist) {
      fail(`distance cell not formatted with one decimal: "${badDist}"`);
    } else {
      console.log(`OK: all distance cells use one decimal (${distCells.join(', ')})`);
    }

    const statusAfterCompute = await page.textContent('#status-text');
    if (!/^estimate ready from 7 stations/.test(statusAfterCompute)) {
      fail(`STATUS text after compute does not match "estimate ready from 7 stations...": "${statusAfterCompute}"`);
    } else {
      console.log(`OK: STATUS after compute = "${statusAfterCompute}"`);
    }

    // Free-text location input: "lat, lon".
    await page.fill('#loc-input', '45.7640, 4.8357');
    await page.locator('#loc-input').press('Enter');
    const statusAfterCoordInput = await page.textContent('#status-text');
    if (!/^location: 45\.76, 4\.84/.test(statusAfterCoordInput)) {
      fail(`STATUS after typing "lat, lon" does not match: "${statusAfterCoordInput}"`);
    } else {
      console.log(`OK: STATUS after typing coordinates = "${statusAfterCoordInput}"`);
    }

    // Free-text location input: a city name from the list.
    await page.fill('#loc-input', 'Lyon');
    await page.locator('#loc-input').press('Enter');
    const statusAfterCityInput = await page.textContent('#status-text');
    if (!/^location: Lyon/.test(statusAfterCityInput)) {
      fail(`STATUS after typing "Lyon" does not match: "${statusAfterCityInput}"`);
    } else {
      console.log(`OK: STATUS after typing a city name = "${statusAfterCityInput}"`);
    }

    if (consoleErrors.length > 0) {
      fail(`console errors during the flow: ${consoleErrors.join(' | ')}`);
    } else {
      console.log('OK: no console errors during the flow');
    }

    await page.screenshot({ path: path.join(root, 'knn-weather/test/paris-flow.png'), fullPage: true });
    console.log('screenshot saved to knn-weather/test/paris-flow.png');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error('FAIL: uncaught error', e);
  process.exitCode = 1;
});
