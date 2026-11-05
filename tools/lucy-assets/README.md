# Lucy source asset tools

This `uv` project provides deterministic, non-AI image extraction utilities.
Input artwork remains local; vector output is an exact RGB run-length
representation clipped by a human-authored GrabCut seed map. The mask still
requires visual review before calling it a pixel-perfect silhouette.

From the repository root:

```powershell
uv run --project tools/lucy-assets lucy-extract `
  --input data/lucy-research/user-page.png `
  --output var/lucy-assets/lucy-figure-extract-v2.png `
  --svg var/lucy-assets/lucy-figure-extract-v2.svg
```

The JSON report records the exact source hash, crop, alpha values, outputs and
known limits. Generated images and vectors live under ignored `var/`.
