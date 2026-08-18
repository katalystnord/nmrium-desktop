import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, writeVersion, run } from './helpers.mjs';

const SCRIPT = 'check-version.cjs';

function fixture(desktopVersion, nmriumVersion) {
  const root = makeFixture(SCRIPT);
  writeVersion(root, '.', desktopVersion);
  writeVersion(root, 'nmrium', nmriumVersion);
  return root;
}

test('passes when the desktop version matches the bundled NMRium', () => {
  const { status, stdout } = run(fixture('2.5.0', '2.5.0'), SCRIPT);
  assert.equal(status, 0);
  assert.match(stdout, /2\.5\.0 matches bundled NMRium/);
});

test('fails when the versions drift', () => {
  const { status, stderr } = run(fixture('2.5.0', '2.4.0'), SCRIPT);
  assert.equal(status, 1);
  assert.match(stderr, /version drift/i);
  assert.match(stderr, /2\.5\.0/);
  assert.match(stderr, /2\.4\.0/);
});

test('fails on a pre-release mismatch that differs only by suffix', () => {
  // The failure mode this guards against is Ketcher Desktop's, where the
  // wrapper sat at 3.18.0-rc.4 while the bundled library was 3.18.0-rc.1.
  const { status } = run(fixture('2.6.0', '2.6.0-rc.1'), SCRIPT);
  assert.equal(status, 1);
});

test('points at sync-version rather than suggesting a hand edit', () => {
  const { stderr } = run(fixture('1.0.0', '2.0.0'), SCRIPT);
  assert.match(stderr, /npm run sync-version/);
  assert.match(stderr, /do not hand-edit/i);
});
