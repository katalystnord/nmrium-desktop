import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from './helpers.mjs';

const { resolveRequestedPath, resolveWithinRoot, pathFromArgv } = createRequire(import.meta.url)(
  path.join(REPO_ROOT, 'electron/url-paths.cjs'),
);

const ROOT = path.resolve('/opt/app/resources/renderer-dist');

/** The full pipeline the app:// protocol handler runs. */
function serve(url, root = ROOT) {
  const rel = resolveRequestedPath(new URL(url).pathname);
  return rel === null ? null : resolveWithinRoot(root, rel);
}

test('serves a normal asset request', () => {
  assert.equal(serve('app://bundle/index.html'), path.join(ROOT, 'index.html'));
});

test('an empty path serves index.html', () => {
  for (const url of ['app://bundle', 'app://bundle/']) {
    assert.equal(serve(url), path.join(ROOT, 'index.html'));
  }
});

test('decodes ordinary percent-encoding', () => {
  // Sample filenames really do contain characters that get encoded.
  assert.equal(serve('app://bundle/data/1H%20Cytisin.dx'), path.join(ROOT, 'data/1H Cytisin.dx'));
});

test('percent-encoded traversal cannot escape the root', () => {
  // The bug this guards: new URL() normalises literal ../ away, so it looks
  // safe, but leaves %2e%2e%2f alone. decodeURIComponent then turns it back
  // into ../ *after* normalisation, and path.join happily resolves out of the
  // root. Verified against the real app before the fix: this returned
  // /etc/passwd.
  assert.equal(serve('app://bundle/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd'), null);
  assert.equal(serve('app://bundle/%2e%2e%2f%2e%2e%2f.ssh/id_rsa'), null);
  assert.equal(serve('app://bundle/%2E%2E%2Fetc/shadow'), null);
});

test('double-encoded traversal cannot escape either', () => {
  // Decoded once it becomes %2e%2e%2f, which is not a separator — so this must
  // resolve to a (nonexistent) file inside the root, never outside it.
  const target = serve('app://bundle/%252e%252e%252fetc/passwd');
  assert.notEqual(target, null);
  assert.ok(target.startsWith(ROOT + path.sep));
});

test('backslash traversal cannot escape on any platform', () => {
  // path.sep is \ on Windows, where this is a real traversal and must be
  // rejected. On POSIX a backslash is a legal filename character, so the same
  // input is just an oddly named file *inside* the root — which is fine. The
  // portable invariant is containment, not rejection.
  const target = resolveWithinRoot(ROOT, '..\\..\\..\\etc\\passwd');
  assert.ok(
    target === null || target.startsWith(ROOT + path.sep),
    `escaped the root: ${target}`,
  );
});

test('an absolute path is treated as relative to the root, not honoured', () => {
  // path.resolve('/a', '/etc/passwd') is /etc/passwd — the leading separator
  // has to be stripped or the root is meaningless.
  assert.equal(resolveWithinRoot(ROOT, '/etc/passwd'), path.join(ROOT, 'etc/passwd'));
});

test('every leading separator is stripped, not just the first', () => {
  // Caught by the mutation gate: with `/^[/\\]/` instead of `/^[/\\]+/`, a
  // request for //index.html keeps one separator, path.resolve treats it as
  // absolute, and containment then rejects a request that was perfectly valid.
  assert.equal(resolveWithinRoot(ROOT, '//index.html'), path.join(ROOT, 'index.html'));
  assert.equal(resolveWithinRoot(ROOT, '///data/x.dx'), path.join(ROOT, 'data/x.dx'));
});

test('the root itself is allowed, a sibling sharing its prefix is not', () => {
  assert.equal(resolveWithinRoot(ROOT, ''), ROOT);
  // /opt/app/resources/renderer-dist-evil starts with the root string but is a
  // different directory — a naive startsWith check would let it through.
  assert.equal(resolveWithinRoot(ROOT, '../renderer-dist-evil/secret'), null);
});

test('malformed percent-encoding is rejected, not thrown', () => {
  // decodeURIComponent('%zz') throws URIError; unhandled it rejects out of the
  // protocol handler instead of returning a response.
  assert.equal(resolveRequestedPath('/%zz'), null);
  assert.equal(resolveRequestedPath('/%'), null);
});

test('a NUL byte is rejected', () => {
  assert.equal(resolveWithinRoot(ROOT, 'index.html\0.png'), null);
});

test('non-string input is rejected', () => {
  for (const value of [null, undefined, 42, {}]) {
    assert.equal(resolveWithinRoot(ROOT, value), null);
  }
});

test('finds an associated file passed by a double-click', () => {
  assert.equal(pathFromArgv(['/usr/bin/app', '/home/u/spectrum.dx']), '/home/u/spectrum.dx');
  assert.equal(pathFromArgv(['app', '/data/x.jdx']), '/data/x.jdx');
  assert.equal(pathFromArgv(['app', '/data/x.nmrium']), '/data/x.nmrium');
});

test('matches the extension case-insensitively', () => {
  assert.equal(pathFromArgv(['app', '/data/SPECTRUM.DX']), '/data/SPECTRUM.DX');
});

test('ignores switches whose value happens to end in an extension', () => {
  // Chromium and Electron add their own argv entries; treating one as a file to
  // open silently loads the wrong thing.
  assert.equal(pathFromArgv(['app', '--log-file=/tmp/trace.dx']), undefined);
  assert.equal(pathFromArgv(['app', '--no-sandbox']), undefined);
});

test('skips argv[0], which is the executable itself', () => {
  // An app installed at a path ending in .dx would otherwise open itself.
  assert.equal(pathFromArgv(['/opt/weird.dx/app']), undefined);
  assert.equal(pathFromArgv(['/opt/app.dx']), undefined);
});

test('ignores files whose extension is not a supported one', () => {
  // Caught by the mutation gate: emptying any entry in the extension list makes
  // endsWith('') true for everything, so every argv entry becomes "a spectrum".
  // Only a negative case detects that.
  assert.equal(pathFromArgv(['app', '/data/notes.txt']), undefined);
  assert.equal(pathFromArgv(['app', '/data/readme']), undefined);
  assert.equal(pathFromArgv(['app', '/data/x.dxx']), undefined);
});

test('tolerates non-string argv entries', () => {
  // Caught by the mutation gate: dropping the typeof check makes the next call
  // (arg.startsWith) throw on anything that is not a string, taking the whole
  // launch down instead of ignoring the entry.
  assert.equal(pathFromArgv(['app', null, undefined, 42, {}, '/d/x.dx']), '/d/x.dx');
  assert.equal(pathFromArgv(['app', null, 7]), undefined);
});

test('returns undefined when no file was passed', () => {
  assert.equal(pathFromArgv(['/usr/bin/app']), undefined);
  assert.equal(pathFromArgv([]), undefined);
});
