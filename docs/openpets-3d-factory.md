# OpenPets 3D asset factory

## Tool decision

There is no one-for-one Blender replacement in Rust+wGPU. `wgpu` is a graphics
and compute API. Bun OS already owns the native renderer and authoring surface
in `crates/aphrody-render`: its `author3d` document supports editable meshes,
sculpting, skeletons, weights, clips and preview renders. The `studio3d`
example runs that document headlessly and the Tauri model viewer loads GLB for
desktop inspection. Keep those as the canonical owners when this staging work
moves to Bun OS; do not ship a second Rust authoring workspace beside them.
Bevy is a useful downstream glTF animation/render qualification option, not a
replacement authoring DCC. Truck targets CAD solids, not organic characters.
Blender remains an optional manual DCC when its UI is needed.

Primary references: [wgpu API](https://wgpu.rs/doc/wgpu/), [Bevy glTF skinned
mesh example](https://bevy.org/examples/gltf/gltf-skinned-mesh/),
[Bevy WebGPU examples including glTF animation](https://bevy.org/examples-webgpu/),
and [Truck CAD kernel](https://github.com/ricosjp/truck).

## Reproducible pipeline

The intended pipeline is multi-language, with one versioned asset manifest
and no language owning unsupported claims about the character. Current status
is shown in the table; these are not all implemented yet:

| Stage | Owner | Responsibility |
| --- | --- | --- |
| Image evidence and exact pixel sampling | Python under `uv` | Extraction project exists; mask review and corrected silhouette remain open |
| Scene geometry, rig, GLB | Rust / `aphrody-render` | Canonical Bun OS authoring document supports rigs and clips; current GLB writer exports a static, flattened scene, so skinned animated GLB output remains open |
| GPU inspection | `aphrody-render` / wgpu, Bevy optional | Bun OS has a renderer and desktop GLB viewer; automated animated-pose qualification remains open |
| Pipeline and package contract | Bun / TypeScript | GLB build/validator orchestration and toolchain doctor; read-only OpenPets V2 structural preflight, not release qualification |
| Native extensions | C/C++ only when measured | Optional codecs or kernels with a demonstrated need; not a required second geometry owner |

Blender remains the full DCC for visual editing and can run headlessly through
its Python API. No Rust+wGPU library offers Blender's complete authoring
surface. `wgpu` is a rendering/compute API; Bevy has official glTF skinned mesh
and animation examples, while Truck is a CAD kernel focused on B-rep/NURBS.
Rust owns deterministic procedural generation and validators here; it is not
claimed to replace Blender's sculpting and rigging UI.

The expected tool versions are in `tools/openpets-3d-factory/toolchain.json`.
Run `bun run openpets:3d:doctor` to compare the local executables to those pins.
Rust and JS dependencies are lockfile-pinned, and the Python project has a
`uv.lock`. This check only establishes toolchain presence/version, not a
qualified pet asset.

1. **Evidence** — versioned manifest records source URL/hash, provenance,
   observations, unknown anatomy, palette samples, and every interpretation.
   Source artwork stays outside the repository and outside the GLB unless
   redistribution rights are established.
2. **Geometry** — CPU-only deterministic mesh generation from named parts and
   fixed-order operations; all dimensions use a declared coordinate system.
3. **Rig and motion** — declared skeleton, inverse bind matrices, bounded
   weights, named OpenPets clips, and deterministic key sampling.
4. **Export** — GLB 2.0 JSON and aligned binary buffers; stable metadata/order;
   record manifest and generator hashes in the build report.
5. **Validation** — parse the GLB back, check primitive bounds and skin/clip
   inventory, run Khronos glTF Validator, render fixed turntable and pose views
   through the Bevy/wgpu inspector, and review them against the supplied
   reference. A GPU screenshot is review evidence, never source geometry.
6. **Release** — package only the qualified GLB, report, and allowed preview;
   preserve intermediate source/working files locally.

The staging exporter at `tools/openpets-3d-factory/` currently covers only
the manifest-driven palette, deterministic CPU ellipsoid blockout, GLB
container writer, independent `gltf` parse-back, byte comparison, and build
report. It reports `blockout-incomplete`: no skinning or animation clips have
been generated yet. This staging crate is not the intended Bun OS production
owner. Integration must route procedural geometry and GLB authoring through
`aphrody-render::author3d`; first extend its GLB writer to preserve the
document skeleton and clips, then call that owner from Bun orchestration.
The sibling `viewer/` crate is a Bevy 0.20.1 inspection window using Bevy's
wgpu-backed renderer and glTF loader; it is intentionally downstream of the
deterministic exporter.

The TypeScript runner is exposed as `bun run openpets:3d:build`; it rebuilds
twice from the same manifest, compares bytes, parses the GLB, runs the Khronos
validator and writes a machine-readable report. As the rig, animation and
OpenPets packager stages are implemented, they must join this runner as
fail-closed gates; a missing stage must never be interpreted as a passing
check.

Exact bit-for-bit GLB reproducibility is scoped to a pinned Rust toolchain,
locked dependency graph, architecture, serializer, and manifest. Cross-GPU
render pixels may differ, so visual CI uses a documented tolerance and never
claims byte identity for the rendered images.

## Lucy source limits

The user-provided RE:FANTASIA page is a front view cropped around the shins.
The pink head towel, long blond hair, closed eyes, relaxed smile, raised arms,
and body towel are visible. The back, profile, hair under the towel, feet,
hidden anatomy, and exact joint placement are not evidenced. Those are marked
as interpretations in the manifest and must not be presented as extracted
facts. The current Rust artifact is a procedural blockout until semantic
silhouette, face, cloth folds, rig deformation, all required clips, visual
review, and OpenPets validation pass.

## Candidate dependencies

Keep the generator on CPU-side `glam`, `gltf-json`, and Rust's ordinary
deterministic data paths. Use `wgpu`/Bevy for viewport and capture only. Use
`gltf` to read back the GLB and the Khronos validator for independent schema
validation. Add geometry crates only for a measured requirement: `truck` for
CAD-style solids, not organic character sculpting. Pin exact versions in the
lockfile after API and license review.

## OpenPets package contract

The factory targets the OpenPets V2 Codex sprite layout, separate from the 3D
GLB deliverable: an 8-column by 11-row atlas of 192x208 cells (1536x2288
overall), with 16 gaze cells in the final two rows and the neutral pose at row
0, column 6. The current fork accepts either `spritesheet.svg` or
`spritesheet.webp`; V2 metadata sets `spriteVersionNumber: 2`. A package has
exactly `pet.json` and the one selected spritesheet. The SVG profile is a
restricted static subset, has an 8 MiB limit, and rejects embedded raster
artwork, scripts, stylesheets, external links, and unsupported elements.

The current desktop contract and installer implementation are the authority:
[sprite layout and gaze mapping](https://github.com/aphrody-dev/openpets/blob/main/apps/desktop/src/codex-pets-core.ts)
and [package/SVG validation](https://github.com/aphrody-dev/openpets/blob/main/packages/install-pet/src/spritesheet.ts).
The package overview is [OpenPets pet format](https://github.com/aphrody-dev/openpets/blob/main/docs/pet-format.mdx).
The mesh-to-atlas renderer must keep cell mapping in a versioned manifest and
validate every expected pose before packaging. Having 88 cells does not prove
the 73 animation poses and 16 gaze directions are unique, complete, or
visually correct.

## Current factory gaps

The present Rust exporter is a colored ellipsoid blockout. It does not yet
create a production rig, author the required animation clips, render the 73
OpenPets poses, pack and validate a pet package, or run the installer and
activation path. The Bevy app is presently a manual viewer, not an automated
visual qualification runner. These are release blockers; its report must stay
`blockout-incomplete`.

The package preflight is a separate, read-only command:
`bun run openpets:3d:package:check <openpets-checkout> <pet-directory>`.
It pins the fork revision and loads that checkout's own metadata and sprite
validators; it reports only structural V2 package acceptance. It does not
qualify the sprite poses, direction semantics, GLB, or release readiness, and
it does not install or activate the package. The 3D build and the OpenPets 2D
atlas are separate deliverables that must share a versioned asset manifest.
