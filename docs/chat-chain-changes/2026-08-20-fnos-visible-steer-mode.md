---
date: 2026-08-20
commit: 65c9a6a8
feature: Visible Queue and Steer delivery modes
impact: Active bridge runs expose a text-only Steer mode that sends guidance immediately while Queue remains the default.
---

The fnOS Web UI keeps this control across upstream release merges unless
upstream provides an equivalent visible Steer experience. The harness blocks
release builds when the local control or its `/steer` routing disappears.
