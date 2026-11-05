# OpenPets 3D factory (Rust)

This is the reproducible asset pipeline boundary for the Fairy Tail archive.
The first generated artifact is a **source blockout**, not a qualified Lucy
model. It keeps observed details apart from invented back/profile anatomy,
uses no source image texture, and writes generated files under ignored `var/`.

## Why this stack

- `wgpu` is the portable Rust GPU API. It provides rendering and compute, not
  mesh authoring, sculpting, UV editing, rigging tools, or a Blender-style DCC.
- Bevy is the practical Rust/wgpu viewport and runtime candidate. Its official
  examples cover glTF loading, skinned meshes, and animation. It is an engine,
  not a complete character authoring application or a GLB exporter.
- Truck is a Rust/WebGPU CAD kernel for B-rep/NURBS and solid modeling. It is
  useful for hard-surface assets; it is not the best owner for organic,
  deforming character models.
- `gltf-json` / `gltf` are the interchange layer: construct glTF 2.0 data,
  package GLB, then parse and validate the produced file. Khronos' validator
  remains a separate qualification gate.

The production split is deliberately explicit: deterministic CPU geometry,
skinning, animation sampling, and GLB packaging; GPU rendering only for review
images and visual regression. GPU output must not feed canonical geometry or
the GLB byte stream.

## Build contract

`manifest.json` is the versioned input contract. The current CLI emits a
deterministic, colored, static ellipsoid blockout and a report that explicitly
marks missing skinning, clips, Khronos validation, visual review, and OpenPets
validation. This is a smoke test for the export pipeline; it is not the final
pet. A qualified run must
emit a GLB, a machine-readable build report, normalized reference views, a
Khronos validator report, and SHA-256 hashes. Inputs and outputs are pinned by
the manifest, source hash, Rust toolchain, `Cargo.lock`, generator version,
coordinate convention, and ordered node/material/animation lists.

```powershell
bun run tools/openpets-3d-factory/pipeline.ts
```

The pipeline runs the Rust build, builds again and compares the bytes and
on-disk artifact, parses the container through `gltf`, runs the Khronos
validator, and writes a combined factory report. It exits with status 2 while
the structural gates are missing; the current expected status is
`blockout-incomplete`.

The validation script pins the Khronos glTF Validator npm/WASM package and
writes a report without a timestamp. It fails the command on validator errors.

The Bevy 0.20.1/wgpu inspection viewport is a separate Rust app so the
headless deterministic exporter does not acquire GPU- or window-system
dependencies:

```powershell
cargo run --manifest-path tools/openpets-3d-factory/viewer/Cargo.toml -- `
  var/openpets/lucy-refantasia-blockout.glb
```

The viewport is for human review; it cannot promote an incomplete blockout to
qualified status.

Do not upload or activate a build until its report says `qualified`, all
required clips and skinning are present, visual review passes, and the GLB
validator reports zero errors. A successful parser round trip alone is not
artistic or OpenPets qualification.
