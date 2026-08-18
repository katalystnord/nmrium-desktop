// Non-interactive smoke test for the packaged-app code paths, used to compare
// behaviour across Electron versions. Prints a JSON report and exits non-zero
// if any check fails.
//
// Run:  node scripts/smoke.mjs            (needs a display; uses --no-sandbox)
//
// It covers the two things an Electron upgrade is most likely to break here:
// the browser APIs NMRium's copy/export path depends on, and an actual
// end-to-end spectrum load + SVG export through our own IPC.
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECTRUM = path.join(APP_DIR, 'sample-data/lnfp3/exp1.zip');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
  timeout: 60_000,
});

const versions = await app.evaluate(() => process.versions);
console.log(`electron ${versions.electron}  chromium ${versions.chrome}  node ${versions.node}\n`);

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

// 1 — the window actually renders our app, not an error page.
check('window loads app:// renderer', page.url().startsWith('app://'), page.url());

// 2 — NMRium mounts. Its drop-zone <input type=file> is what main.js feeds.
let mounted = false;
try {
  await page.waitForFunction(
    () => [...document.querySelectorAll('input[type="file"]')].some((i) => i.name !== 'file'),
    null,
    { timeout: 45_000 },
  );
  mounted = true;
} catch { /* reported below */ }
check('NMRium component mounts', mounted);

// 3 — the browser APIs NMRium's copy/export path needs. This is the specific
// question an Electron bump raises: did any of them get removed?
const apis = await page.evaluate(() => ({
  ClipboardItem: typeof ClipboardItem,
  clipboardWrite: typeof navigator.clipboard?.write,
  clipboardRead: typeof navigator.clipboard?.read,
  execCommand: typeof document.execCommand,
  OffscreenCanvas: typeof OffscreenCanvas,
  convertToBlob: typeof new OffscreenCanvas(1, 1).convertToBlob,
  XMLSerializer: typeof XMLSerializer,
  createObjectURL: typeof URL.createObjectURL,
}));
for (const [name, type] of Object.entries(apis)) {
  check(`API present: ${name}`, type !== 'undefined', type);
}

// 4 — execCommand('copy') is the one clipboard-polyfill falls back to, and the
// deprecated API most likely to be removed. Check it still *functions*, not
// just that the method exists.
const execCopyWorks = await page.evaluate(() => {
  const el = document.createElement('textarea');
  el.value = 'nmrium-smoke';
  document.body.append(el);
  el.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  el.remove();
  return ok;
});
check("document.execCommand('copy') still functions", execCopyWorks);

// 5 — real clipboard write through the modern path NMRium prefers.
const clipboardWriteWorks = await page.evaluate(async () => {
  try {
    const canvas = new OffscreenCanvas(8, 8);
    // convertToBlob requires a rendering context to have been acquired.
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'ok';
  } catch (e) { return `threw: ${e.message}`; }
});
check('clipboard image write (ClipboardItem path)', clipboardWriteWorks === 'ok', clipboardWriteWorks);

// 6 — end-to-end: load a real spectrum the same way File > Open does, then
// export it as SVG through our own IPC, with the save dialog stubbed so the
// run stays headless-ish. Proves the NMRiumRefAPI wiring still works.
if (mounted) {
  const bytes = [...fs.readFileSync(SPECTRUM)];
  await page.evaluate(async (data) => {
    const input = [...document.querySelectorAll('input[type="file"]')].find((i) => i.name !== 'file');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(data)], 'exp1.zip'));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, bytes);

  let rendered = false;
  try {
    // NMRium draws the spectrum as SVG paths once data is processed.
    await page.waitForFunction(() => document.querySelectorAll('svg path').length > 5, null, {
      timeout: 60_000,
    });
    rendered = true;
  } catch { /* reported below */ }
  check('spectrum loads and renders', rendered);

  if (rendered) {
    // The export path looks up #nmrSVG specifically (NMRiumRefAPI -> getBlob).
    // Waiting on generic <svg path> alone races it, and NMRium's getBlob has no
    // null guard — a miss throws "reading 'getAttribute'" out of the async
    // handler, so nothing is sent back and the failure is completely silent.
    await page.waitForSelector('#nmrSVG', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // app.evaluate runs in the main process but has no `require` in scope, so
    // the path is computed here and the file is observed from this side.
    const out = path.join(process.env.TMPDIR || '/tmp', 'nmrium-smoke.svg');
    fs.rmSync(out, { force: true });
    await app.evaluate(({ dialog, BrowserWindow }, outPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: outPath });
      // The renderer reports "nothing to export" through showMessageBox; stub it
      // too or it opens a modal and the run just hangs.
      globalThis.__smokeMessages = [];
      dialog.showMessageBox = async (_w, opts) => {
        globalThis.__smokeMessages.push(opts?.message ?? String(opts));
        return { response: 0 };
      };
      BrowserWindow.getAllWindows()[0].webContents.send('trigger-export-svg');
    }, out);

    let size = 0;
    for (let i = 0; i < 60 && size === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (fs.existsSync(out)) size = fs.statSync(out).size;
    }
    const messages = await app.evaluate(() => globalThis.__smokeMessages ?? []);
    check(
      'SVG export writes a real file',
      size > 1000,
      size ? `${out} (${size} bytes)` : `no file written${messages.length ? ` — app said: ${messages.join('; ')}` : ''}`,
    );
    fs.rmSync(out, { force: true });
  }
}

await app.close().catch(() => {});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(
  process.env.SMOKE_OUT || '/tmp/nmrium-smoke.json',
  JSON.stringify({ versions, results }, null, 2),
);
process.exit(failed.length ? 1 : 0);
