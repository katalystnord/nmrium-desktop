// Pure path/URL logic lifted out of main.js so it can be unit tested.
//
// Nothing here imports electron, on purpose: this is the code that decides
// which file on disk a renderer request is allowed to reach, and that decision
// is worth testing directly rather than only through a running app.
const path = require('node:path');

/**
 * Turn a request URL's pathname into a relative path, or null if it is
 * unusable.
 *
 * `new URL()` normalises literal `../` segments away, but leaves
 * percent-encoded ones (`%2e%2e%2f`) untouched — those only become `../` after
 * decoding, which is why decoding and containment have to be separate steps and
 * why the containment check below is not optional.
 */
function resolveRequestedPath(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding (e.g. a bare `%`) makes decodeURIComponent
    // throw. Treat it as a bad request rather than letting it reject out of the
    // protocol handler.
    return null;
  }
  if (relativePath === '' || relativePath === '/') {
    return '/index.html';
  }
  return relativePath;
}

/**
 * Resolve `relativePath` inside `root`, or null if it would escape.
 *
 * Returning null rather than clamping is deliberate: a request that tried to
 * leave the root is a bug or an attack, and quietly serving something else
 * would hide both.
 */
function resolveWithinRoot(root, relativePath) {
  if (typeof relativePath !== 'string') return null;
  // A NUL byte truncates the path in some syscalls; reject rather than reason
  // about which.
  if (relativePath.includes('\0')) return null;

  const resolvedRoot = path.resolve(root);
  // Strip leading separators so the path is always treated as relative to the
  // root — path.resolve('/a', '/etc/passwd') would otherwise yield /etc/passwd.
  const target = path.resolve(resolvedRoot, relativePath.replace(/^[/\\]+/, ''));

  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return target;
}

/**
 * The file path passed by a file-association double-click, or undefined.
 *
 * Skips anything that looks like a switch: Chromium and Electron add their own
 * argv entries, and a flag whose value happened to end in a supported extension
 * would otherwise be opened as a spectrum.
 */
function pathFromArgv(argv, extensions = ['.dx', '.jdx', '.nmrium']) {
  return argv
    .slice(1)
    .find(
      (arg) =>
        typeof arg === 'string' &&
        !arg.startsWith('-') &&
        extensions.some((ext) => arg.toLowerCase().endsWith(ext)),
    );
}

module.exports = { resolveRequestedPath, resolveWithinRoot, pathFromArgv };
