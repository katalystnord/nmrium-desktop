#!/usr/bin/env node
// Guards the versioning policy: NMRium Desktop carries the exact version of the
// NMRium release it wraps (see CONTRIBUTING.md → Versioning). Desktop-only
// changes do not get their own version — they ride the next upstream sync.
//
// Runs before every packaging build so a drifted version can never ship.

const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const desktop = require(path.join(projectRoot, 'package.json'));
const nmrium = require(path.join(projectRoot, 'nmrium/package.json'));

if (desktop.version === nmrium.version) {
  console.log(`→ Version ${desktop.version} matches bundled NMRium — OK`);
  process.exit(0);
}

console.error(`
ERROR: version drift.

  package.json (desktop) : ${desktop.version}
  nmrium (bundled)       : ${nmrium.version}

NMRium Desktop follows the upstream NMRium version exactly. Fix with:

  npm run sync-version

If the desktop wrapper needs a release without an upstream version change,
that is a policy decision — see CONTRIBUTING.md → Versioning, do not hand-edit
the version to work around this check.
`);
process.exit(1);
