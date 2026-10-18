import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DEMOS_DIR = path.join(REPO_ROOT, 'demos/latest');
const GALLERY_DIR = path.join(DEMOS_DIR, 'gallery');

// Dynamically import Playwright
const playwrightPath = '/Users/jarad/git/netfix/sm3/node_modules/playwright/index.mjs';
const { chromium } = await import(playwrightPath);

// Locate FFmpeg
function getFFmpegPath() {
  const msPlaywrightFFmpeg = path.resolve(process.env.HOME, 'Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac');
  if (fs.existsSync(msPlaywrightFFmpeg)) return msPlaywrightFFmpeg;
  return null;
}

// 1. Interactive Cursor Helper
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.style.position = 'fixed';
    c.style.top = '0';
    c.style.left = '0';
    c.style.width = '18px';
    c.style.height = '18px';
    c.style.borderRadius = '50%';
    c.style.backgroundColor = 'rgba(56, 189, 248, 0.85)';
    c.style.border = '2px solid #ffffff';
    c.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.9)';
    c.style.pointerEvents = 'none';
    c.style.zIndex = '9999999';
    c.style.transform = 'translate(-50%, -50%)';
    c.style.transition = 'width 0.12s ease, height 0.12s ease, background-color 0.12s ease';
    document.body.appendChild(c);
    window.__setCursor = (x, y) => {
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    };
  });
}

async function smoothMove(page, targetX, targetY, steps = 18, delayMs = 15) {
  await page.mouse.move(targetX, targetY, { steps });
  await page.evaluate(({ x, y }) => window.__setCursor?.(x, y), { x: targetX, y: targetY });
  if (delayMs > 0) await page.waitForTimeout(delayMs);
}

async function smoothClick(page, selectorOrCoords, options = {}) {
  let x, y;
  if (typeof selectorOrCoords === 'string') {
    const el = await page.waitForSelector(selectorOrCoords, { state: 'visible', timeout: 8000 });
    const box = await el.boundingBox();
    if (!box) throw new Error(`Could not get bounding box for ${selectorOrCoords}`);
    x = box.x + box.width / 2;
    y = box.y + box.height / 2;
  } else {
    ({ x, y } = selectorOrCoords);
  }

  await smoothMove(page, x, y, options.steps || 18, options.moveDelay || 15);
  await page.waitForTimeout(100);

  // Pulse cursor
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) {
      c.style.width = '12px';
      c.style.height = '12px';
      c.style.backgroundColor = 'rgba(14, 165, 233, 1)';
    }
  });

  await page.mouse.click(x, y);
  await page.waitForTimeout(120);

  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) {
      c.style.width = '18px';
      c.style.height = '18px';
      c.style.backgroundColor = 'rgba(56, 189, 248, 0.85)';
    }
  });

  if (options.postDelay) await page.waitForTimeout(options.postDelay);
}

// 2. WebP Thumbnail Generator
async function generateWebPThumbnail(browser, sourcePngPath, outWebPPath) {
  console.log(`[Thumbnail] Generating WebP from ${sourcePngPath}...`);
  const page = await browser.newPage();
  const pngDataUrl = `data:image/png;base64,${fs.readFileSync(sourcePngPath).toString('base64')}`;

  const webpBase64 = await page.evaluate(async (dataUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const webpData = canvas.toDataURL('image/webp', 0.88);
        resolve(webpData.split(',')[1]);
      };
      img.src = dataUrl;
    });
  }, pngDataUrl);

  fs.writeFileSync(outWebPPath, Buffer.from(webpBase64, 'base64'));
  await page.close();
}

// 3. Main Showcase Record Routine
async function runShowcase() {
  console.log(`[Setup] Preparing directories...`);
  fs.mkdirSync(GALLERY_DIR, { recursive: true });

  const ffmpegBin = getFFmpegPath();
  console.log(`[Config] FFmpeg binary: ${ffmpegBin || 'NOT FOUND'}`);

  const tempVideoDir = path.join(REPO_ROOT, '.temp_video_' + Date.now());
  fs.mkdirSync(tempVideoDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-font-antialiasing', '--no-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  const APP_URL = 'https://jpeckenpaugh.github.io/c3pa-explorer/';

  console.log(`[Flow] 1. Loading app & dashboard at ${APP_URL}...`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500); // Wait for sql.js WASM snapshot to load into memory
  await injectCursor(page);
  await smoothMove(page, 450, 220, 15, 10);

  // Still 1: Main Dashboard
  console.log(`[Capture] Gallery 01: Dashboard Corpus Metrics`);
  await page.screenshot({ path: path.join(GALLERY_DIR, '01-dashboard-corpus-metrics.png'), fullPage: false });
  await page.waitForTimeout(1000);

  // Flow 2: DB Modal Audit & Provenance Hashes
  console.log(`[Flow] 2. Opening Database Engine & Snapshot Audit modal...`);
  await smoothClick(page, '#navDatabase', { postDelay: 800 });
  await page.waitForTimeout(600);

  // Still 2: Database Snapshot Modal
  console.log(`[Capture] Gallery 02: Verified SQLite Snapshot & Dual-Runtime Engine Modal`);
  await page.screenshot({ path: path.join(GALLERY_DIR, '02-cryptographic-snapshot-audit.png'), fullPage: false });
  await page.waitForTimeout(1200);

  // Close DB modal
  await smoothClick(page, '#dbModal .btn-close', { postDelay: 800 });
  await page.waitForTimeout(500);

  // Flow 3: Documents Library
  console.log(`[Flow] 3. Navigating to Documents Library...`);
  await smoothClick(page, 'a[href="#/library"]', { postDelay: 1500 });
  await smoothMove(page, 640, 280, 16, 12);
  await page.waitForTimeout(800);

  // Still 3: Documents Library
  console.log(`[Capture] Gallery 03: Policy Documents Library & Crawl Inventory`);
  await page.screenshot({ path: path.join(GALLERY_DIR, '03-document-library-browser.png'), fullPage: false });
  await page.waitForTimeout(1000);

  // Flow 4: Open Document Detail (DB_1 Lead411)
  console.log(`[Flow] 4. Opening Document Detail (DB_1)...`);
  await smoothClick(page, 'table tbody tr a[href="#/library/DB_1"]', { postDelay: 2000 });
  await smoothMove(page, 550, 320, 16, 12);
  await page.waitForTimeout(800);

  // Still 4: Document Detail Sentences
  console.log(`[Capture] Gallery 04: Document Detail — Sentence Extraction & Label Overlays`);
  await page.screenshot({ path: path.join(GALLERY_DIR, '04-document-detail-sentences-view.png'), fullPage: false });
  await page.waitForTimeout(1000);

  // Flow 5: Open Unit Detail Modal
  console.log(`[Flow] 5. Clicking sentence unit to trigger alignment provenance modal...`);
  const unitBox = await page.evaluate(() => {
    const u = document.querySelector('.unit[data-unit-id]');
    if (!u) return null;
    const r = u.getBoundingClientRect();
    return { x: r.left + 80, y: r.top + 25 };
  });

  if (unitBox) {
    await smoothMove(page, unitBox.x, unitBox.y, 16, 12);
    await page.waitForTimeout(150);
  }

  await page.evaluate(() => {
    const u = document.querySelector('.unit[data-unit-id]');
    u?.click();
  });
  await page.waitForTimeout(1500);

  // Still 5: Alignment Provenance Modal
  console.log(`[Capture] Gallery 05: Auditable 3-Tier Annotation-to-Sentence Alignment Modal`);
  await page.screenshot({ path: path.join(GALLERY_DIR, '05-annotation-alignment-provenance.png'), fullPage: false });
  await page.waitForTimeout(1200);

  // Close unit modal
  console.log(`[Flow] Closing unit detail modal...`);
  const closeBox = await page.evaluate(() => {
    const btn = document.querySelector('#unitModal .btn-close');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (closeBox) {
    await smoothMove(page, closeBox.x, closeBox.y, 14, 10);
    await page.waitForTimeout(100);
  }

  await page.evaluate(() => {
    const btn = document.querySelector('#unitModal .btn-close');
    btn?.click();
  });
  await page.waitForTimeout(800);

  // Flow 6: Downstream Data Samples Slicer
  console.log(`[Flow] 6. Navigating to Downstream Data Samples...`);
  await smoothClick(page, 'a[href="#/samples"]', { postDelay: 1600 });
  await smoothMove(page, 400, 240, 15, 12);

  // Still 6: Samples Explorer & Data Slicer
  console.log(`[Capture] Gallery 06: Downstream Dataset Slicer & Partition Export`);
  await page.screenshot({ path: path.join(GALLERY_DIR, '06-downstream-data-slicer-export.png'), fullPage: false });
  await page.waitForTimeout(1200);

  // Flow 7: Open Export Modal
  console.log(`[Flow] 7. Opening Download / Export Modal...`);
  await smoothClick(page, '#navDownload', { postDelay: 1000 });
  await smoothMove(page, 580, 360, 15, 12);
  await page.waitForTimeout(1200);
  await smoothClick(page, '#exportModal .btn-close', { postDelay: 500 });

  // Outro: Return to Dashboard
  console.log(`[Flow] 8. Outro back to Home Dashboard...`);
  await smoothClick(page, 'a[title="Home"]', { postDelay: 1500 });
  await smoothMove(page, 640, 360, 18, 15);
  await page.waitForTimeout(2000);

  console.log(`[Flow] Closing context & saving video...`);
  const videoObj = page.video();
  await page.close();
  await context.close();
  await browser.close();

  const rawVideoPath = await videoObj.path();
  console.log(`[Video] Raw recording saved at: ${rawVideoPath}`);

  const finalWebM = path.join(DEMOS_DIR, 'demo.webm');

  if (ffmpegBin) {
    console.log(`[FFmpeg] Transcoding video with VP9 to exact 30.5s duration...`);
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegBin, [
        '-y',
        '-i', rawVideoPath,
        '-t', '30.5',
        '-c:v', 'libvpx-vp9',
        '-b:v', '850k',
        '-crf', '30',
        '-an',
        finalWebM,
      ], { stdio: 'inherit' });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });
  } else {
    console.log(`[Video] Copying raw WebM to ${finalWebM}...`);
    fs.copyFileSync(rawVideoPath, finalWebM);
  }

  // Cleanup temp video dir
  try {
    fs.rmSync(tempVideoDir, { recursive: true, force: true });
  } catch (_) {}

  // Generate WebP thumbnail from Gallery Still 1
  const helperBrowser = await chromium.launch({ headless: true });
  try {
    const sourceStill = path.join(GALLERY_DIR, '01-dashboard-corpus-metrics.png');
    const cardThumbWebP = path.join(DEMOS_DIR, 'thumb.webp');
    await generateWebPThumbnail(helperBrowser, sourceStill, cardThumbWebP);

    // Copy thumbnail to root, beta-livive-net, livive-net, and repo root
    const rootThumb = path.resolve(REPO_ROOT, '../thumbnails/c3pa-explorer.webp');
    const betaThumb = path.resolve(REPO_ROOT, '../beta-livive-net/thumbnails/c3pa-explorer.webp');
    const liviveThumb = path.resolve(REPO_ROOT, '../livive-net/thumbnails/c3pa-explorer.webp');

    for (const tPath of [rootThumb, betaThumb, liviveThumb]) {
      if (fs.existsSync(path.dirname(tPath))) {
        fs.copyFileSync(cardThumbWebP, tPath);
        console.log(`[Thumbnail] Copied to ${tPath}`);
      }
    }
  } finally {
    await helperBrowser.close();
  }

  console.log(`[Complete] Showcase capture pipeline finished successfully!`);
}

runShowcase().catch((err) => {
  console.error('[Error] Showcase run failed:', err);
  process.exit(1);
});
