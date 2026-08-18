import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './helpers.mjs';

// Our own sample additions live outside the submodule and are merged with
// NMRium's samples.json at menu-build time. Three things have to line up for an
// entry to actually appear and open, and none of them fail loudly at runtime —
// a broken entry is just a menu item that does nothing, or a group that
// silently never renders. That is the failure this suite exists to catch.
const CATALOG = path.join(REPO_ROOT, 'sample-data/catalog-extra.json');
const MAIN_JS = path.join(REPO_ROOT, 'electron/main.js');

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const mainSource = fs.readFileSync(MAIN_JS, 'utf8');

/** The groupName allowlist main.js filters the merged catalog through. */
function menuGroups() {
  const block = mainSource.match(/const SAMPLE_MENU_GROUPS = \[([\s\S]*?)\];/);
  assert.ok(block, 'SAMPLE_MENU_GROUPS not found in electron/main.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('the catalog is a non-empty array of groups', () => {
  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length > 0);
  for (const group of catalog) {
    assert.equal(typeof group.groupName, 'string');
    assert.ok(Array.isArray(group.children) && group.children.length > 0);
  }
});

test('every group is listed in main.js SAMPLE_MENU_GROUPS', () => {
  // buildOpenSampleSubmenu filters on this allowlist, so a group missing from
  // it is dropped without a word — the samples ship but the menu never shows
  // them.
  const allowed = menuGroups();
  for (const group of catalog) {
    assert.ok(
      allowed.includes(group.groupName),
      `"${group.groupName}" is in catalog-extra.json but not in SAMPLE_MENU_GROUPS`,
    );
  }
});

test('every entry has a title and a "./"-relative file path', () => {
  // main.js strips exactly one leading "./" to build the path handed to
  // sendFileToRenderer; a bare or absolute path resolves somewhere else.
  for (const group of catalog) {
    for (const child of group.children) {
      assert.equal(typeof child.title, 'string', `missing title in ${group.groupName}`);
      assert.ok(child.title.length > 0);
      assert.match(child.file, /^\.\//, `${child.title}: file must start with "./"`);
    }
  }
});

test('every referenced file exists in sample-data/', () => {
  // build-samples-archive.sh and build-samples-deb.sh copy sample-data/<dir> to
  // the install root, so a catalog path resolves against sample-data/ here and
  // against the samples root at runtime.
  for (const group of catalog) {
    for (const child of group.children) {
      const rel = child.file.replace(/^\.\//, '');
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, 'sample-data', rel)),
        `${group.groupName} / ${child.title}: sample-data/${rel} does not exist`,
      );
    }
  }
});

test('the sample directories the build scripts copy are the ones the catalog uses', () => {
  // Each script names its extra directories explicitly (`cp -r sample-data/lnfp3`).
  // Adding a sample directory to the catalog without adding it to both scripts
  // ships a menu entry pointing at a file that was never packaged.
  const scripts = ['build-samples-archive.sh', 'build-samples-deb.sh'].map((name) => ({
    name,
    source: fs.readFileSync(path.join(REPO_ROOT, 'scripts', name), 'utf8'),
  }));
  const dirs = new Set(
    catalog.flatMap((g) => g.children.map((c) => c.file.replace(/^\.\//, '').split('/')[0])),
  );
  for (const dir of dirs) {
    for (const { name, source } of scripts) {
      assert.ok(source.includes(dir), `scripts/${name} never packages sample-data/${dir}`);
    }
  }
});

test('every workspace id in main.js is one NMRium actually defines', () => {
  // The View > Workspace menu sends these ids straight to NMRium. An id it does
  // not know is not rejected — it silently falls back to the default workspace,
  // so a rename upstream turns a menu entry into a no-op.
  const types = path.join(REPO_ROOT, 'nmrium/src/component/main/types.ts');
  if (!fs.existsSync(types)) {
    // Submodule not checked out (the wrapper CI job runs without it).
    return;
  }
  const source = fs.readFileSync(types, 'utf8');
  const block = mainSource.match(/const WORKSPACES = \[([\s\S]*?)\];/);
  assert.ok(block, 'WORKSPACES not found in electron/main.js');
  const ids = [...block[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.ok(
      new RegExp(`'${id}'`).test(source),
      `workspace "${id}" is not defined in NMRium's types.ts`,
    );
  }
});
