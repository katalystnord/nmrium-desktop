// Test helpers.
//
// The wrapper scripts in scripts/ locate the NMRium submodule relative to their
// own __dirname, so they are easy to test without touching production code:
// copy the script into <tmp>/scripts/ and build a fake tree around it, and the
// script operates on the fixture exactly as it would on the real checkout.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..');

const roots = [];

/** Create a throwaway repo root containing scripts/<name>. */
export function makeFixture(scriptName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-test-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, 'scripts', scriptName),
    path.join(root, 'scripts', scriptName),
  );
  return root;
}

/** A throwaway directory with no script in it — for hooks called as modules. */
export function makeTempDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-test-'));
  roots.push(root);
  return root;
}

export function write(root, relPath, contents) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

export function read(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

export function exists(root, relPath) {
  return fs.existsSync(path.join(root, relPath));
}

/** Write a package.json carrying just a version — enough for the version probes. */
export function writeVersion(root, relDir, version) {
  return write(root, path.join(relDir, 'package.json'), JSON.stringify({ version }) + '\n');
}

/** Run a fixture's script. Never throws — returns status/stdout/stderr for assertions. */
export function run(root, scriptName) {
  try {
    const stdout = execFileSync('node', [path.join(root, 'scripts', scriptName)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

process.on('exit', () => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});
