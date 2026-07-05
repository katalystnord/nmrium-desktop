# MNova feature comparison — future considerations

This doc exists to track where NMRium (and therefore `nmrium-desktop`, which
wraps it unmodified) currently falls short of Mestrelab's MNova, a
commercial NMR processing suite chemists may already be used to. It's a
reference for scoping future work, not a commitment to build any of it.

**Scope note:** `nmrium-desktop` deliberately makes no changes to NMRium's
own processing/rendering logic (see the root `CLAUDE.md`) — it's a pinned
git submodule, built from source, wrapped in a native shell. None of the
gaps below are fixable from this repo. Closing any of them would mean
either contributing to upstream NMRium (cheminfo/nmrium), or a deliberate
future decision to fork/patch it, which is out of scope for this project
as currently defined.

**Methodology:** the NMRium side of this table is source-verified against
the pinned submodule commit (v2.3.0) — checked panels, reducers, filters,
and bundled dependencies directly rather than assumed. The MNova side is
from general product knowledge, not a line-by-line feature audit of a
current MNova install, so treat those as directionally correct rather than
version-precise.

## Confirmed gaps — MNova has these, NMRium (v2.3.0) does not

| Capability | MNova | NMRium |
|---|---|---|
| Quantitative NMR (qNMR/purity, ERETIC/PULCON) | Yes | Not found anywhere in source — no quantification workflow at all |
| DOSY / diffusion processing | Yes (dedicated module) | Not found — no "dosy"/"diffusion" anywhere in source |
| T1/T2 relaxation curve fitting | Automatic exponential fits, rate extraction | Has the raw data-extraction/plotting scaffold (`multipleAnalysisPanel`) but no automatic curve fitting — would need manual fitting via a tiny custom-JS formula box |
| Reference deconvolution | Yes | Not found |
| J-resolved (JRES) processing | Proper tilt/symmetrization/projection | Displays J-res data as generic 2D — no dedicated processing |
| Solid-state NMR (MAS sidebands, CSA) | Some support | None found at all |
| Scripting/macros/batch processing | Full macro/plugin system | Only a per-panel custom-formula evaluator, not general automation |
| Multi-page report designer | Dedicated report/document builder | Has a stack-plot mode + an ACS-style citation-text generator, but no true report designer |

## Where NMRium is already comparable, for balance

- **Peak fitting/deconvolution** of overlapping multiplets — real
  Levenberg-Marquardt line-shape optimization plus automatic J-coupling
  extraction (`ml-gsd`-backed), not a toy implementation.
- **Prediction + simulation** — structure-based 1D/2D prediction (¹H, ¹³C,
  COSY, HSQC, HMBC) *and* a separate full spin-system quantum simulator,
  both present.
- **Signal-processing core** — auto-phase correction, five baseline
  algorithms (airPLS, Whittaker, polynomial, Bernstein, cubic), and linear
  prediction.
- **Raw vendor format import** — Bruker, JEOL, and Varian/Agilent parsers
  are real and exercised by test fixtures, not just JCAMP-DX. Format
  coverage is closer to MNova than expected going in.

## Bottom line

The gap isn't "MNova is a full suite and NMRium is a toy" — NMRium's
processing/assignment core is legitimately strong. The gaps are specific,
advanced workflows MNova built out for pharma/specialty use: qNMR, DOSY,
relaxation kinetics, and batch scripting are the real ones, not edge cases.
