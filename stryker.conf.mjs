// Mutation testing — the gate that checks the tests actually assert something.
//
// A passing suite proves the code ran; it does not prove a broken change would
// be caught. Stryker introduces one deliberate defect at a time and requires a
// test to fail. Every mutant that survives is a line the suite executes but
// does not pin.
export default {
  packageManager: 'npm',

  // The wrapper suite runs on Node's built-in test runner, which Stryker has no
  // dedicated plugin for. The command runner just asserts a non-zero exit,
  // which is all `node --test` needs to report a failure.
  testRunner: 'command',
  commandRunner: { command: 'npm test' },
  coverageAnalysis: 'off',

  // A glob rather than a hand-maintained list, so a newly added script is
  // mutated by default. That makes the gate fail loudly on untested logic
  // instead of quietly ignoring it — a gate that opts new code out is not a
  // gate. Adding a script here means writing tests for it, or excluding it
  // below with a reason.
  mutate: [
    'scripts/*.cjs',
    // Excluded: it has no unit tests and cannot easily get them — it runs
    // under Electron for nativeImage, and does its work at import time rather
    // than behind an exported function.
    '!scripts/generate-icons.cjs',
  ],

  // Anything less than every mutant killed fails the run. The mutated surface
  // is small and fully covered today, so this is a ratchet against regression,
  // not an aspiration. If it ever needs lowering, that is a deliberate decision
  // with a reason — not a quiet edit.
  thresholds: { high: 100, low: 100, break: 100 },

  reporters: ['clear-text', 'progress'],
  timeoutMS: 30000,
  concurrency: 4,
  tempDirName: '.stryker-tmp',
};
