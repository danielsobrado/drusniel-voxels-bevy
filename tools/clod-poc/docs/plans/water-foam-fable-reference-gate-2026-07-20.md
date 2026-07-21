# Water Foam Fable5 Reference Gate

Status: implementation complete on branch; retained image evidence pending.

## Purpose

The existing foam acceptance lanes prove Drusniel behavior, cross-renderer consistency, temporal motion, lighting response, and absence of broad stripe artifacts. They do not prove visual parity with `Braffolk/fable5-world-demo`.

This gate records normalized metrics from retained Fable5 and Drusniel evidence, verifies file hashes and source commits, and fails when Drusniel drifts outside the fixed reference envelope.

## Required evidence layout

```text
<evidence-root>/
  rapid/
    water-mask.png            # Fable5; binary white water / black non-water
    body-mask.png             # Drusniel alternative to water-mask.png
    depth.png                 # Drusniel alternative to water-mask.png
    foam-a.png
    foam-b.png
    final.png
  smooth-river/
    water-mask.png            # or Drusniel body-mask.png + depth.png
    foam-a.png
  lake-shore/
    water-mask.png            # or Drusniel body-mask.png + depth.png
    foam-a.png
```

Rules:

- All images inside one scene use identical dimensions.
- Fable5 and Drusniel evidence use identical dimensions for each corresponding scene.
- `water-mask.png` is binary: white for visible water, black elsewhere.
- A scene must contain at least 1,000 water pixels.
- Rapid frames use the same fixed camera and fixed time interval.
- Images are retained with their manifests; manifests alone are not accepted evidence.
- Source commits are full 40-character Git SHAs.

## Record the Fable5 reference

```powershell
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-reference-record.ts `
  --input=tools/clod-poc/qa-runs/fable5-water-foam/reference-images `
  --out=tools/clod-poc/qa-runs/fable5-water-foam/fable5-reference.json `
  --source-kind=fable5-world-demo `
  --repository=Braffolk/fable5-world-demo `
  --commit=<40-character-fable5-commit> `
  --renderer=webgpu `
  --captured-at=<ISO-8601-capture-time>
```

## Record the Drusniel candidate

The existing foam acceptance output can be copied into the required three scene folders without creating manual masks because the recorder derives the water mask from `body-mask.png`, `depth.png`, and `foam-a.png`.

```powershell
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-reference-record.ts `
  --input=tools/clod-poc/qa-runs/fable5-water-foam/drusniel-images `
  --out=tools/clod-poc/qa-runs/fable5-water-foam/drusniel-candidate.json `
  --source-kind=drusniel-clod-poc `
  --repository=danielsobrado/drusniel-voxels-bevy `
  --commit=<40-character-drusniel-commit> `
  --renderer=webgpu `
  --captured-at=<ISO-8601-capture-time>
```

## Compare

```powershell
npx --prefix tools/clod-poc tsx tools/clod-poc/tools/water-foam-reference-compare.ts `
  --reference=tools/clod-poc/qa-runs/fable5-water-foam/fable5-reference.json `
  --candidate=tools/clod-poc/qa-runs/fable5-water-foam/drusniel-candidate.json `
  --out=tools/clod-poc/qa-runs/fable5-water-foam/comparison.json
```

The command exits non-zero on failure.

## Fixed comparison envelope

- Active fraction and mean coverage: at most 30% reference-relative delta per scene.
- Isolated active fraction: at most 0.08 absolute delta.
- Component density: at most one octave (`2x`) difference.
- Largest component fraction: at most 0.15 absolute delta.
- Candidate stripe anisotropy: no more than reference + 0.08.
- Rapid temporal mean delta: at most 40% reference-relative delta.
- Rapid temporal IoU: at most 0.20 absolute delta.
- Lit foam mean and p95 luminance: at most 0.12 absolute delta.
- Lit foam luminance variation: at most 50% reference-relative delta.
- Rapid-to-smooth active-fraction ratio: at most 30% reference-relative delta.

These limits are not changed to obtain a passing first capture. A failure is resolved in rendering, hydrology pose selection, capture preparation, or tone mapping.

## Required repository verification

```powershell
npm --prefix tools/clod-poc test -- `
  tools/water-foam-reference-contract.test.ts
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Non-goals

- Pixel-by-pixel comparison between different procedural worlds.
- Replacing existing Drusniel foam visual and runtime acceptance.
- Automatically downloading or modifying the Fable5 repository.
- Accepting uncommitted or un-hashed reference images.
