# Radiance Cascades GI — structure

This is the active version of the sim. GitHub Pages serves it from `../index.html`;
`../index-rc.html` is kept as a copy of the same entry point.

## What it does

The scene is lit **only by its emissive materials**. The SCREEN emits real light:
it bounces around the set (diffuse) and reflects on polished materials
(specular). No studio lights are enabled by default.

## Real-time GI pipeline

```
point cloud ──inject──► voxel volume (RGBA16F 3D, with mips)
                                      │
                                      ├─ cone tracing ─► cascades 0..N (2D atlas)
                                      │                           │
                                      │                        merge ▼ (top to bottom)
                                      │                      cascade 0 ─► SH projection
                                      │                                      │
                                      │                                 LightProbeGrid
                                      │                                      │
                                      │                               three.js applies it only
                                      │                             to indirect diffuse materials
                                      │
                                      └─ per-pixel cone tracing ─► indirect specular
```

## Files

| File | Role |
| --- | --- |
| `main.js` | Boot, render loop, wiring between modules |
| `params.js` | All configuration in one object |
| `style.css` | UI styles |
| `core/viewer.js` | Renderer, camera, controls, composer, direct lights |
| `core/stage.js` | GLB loading, SCREEN detection, framing |
| `core/screen-source.js` | Video or tab capture → emissive SCREEN texture, with framing |
| `ui/dom.js` | Status, loader, and metric panel |
| `ui/gui.js` | lil-gui panel |
| `gi/index.js` | Orchestrates the pipeline and publishes the LightProbeGrid |
| `gi/glsl.js` | Shared GLSL fragments (cone tracing, octahedral, SH) |
| `gi/uniforms.js` | Shared uniforms across passes and materials |
| `gi/targets.js` | 2D/3D render targets, per-layer clears, mips |
| `gi/pointcloud.js` | Mesh sampling → surface points |
| `gi/voxelizer.js` | Radiance injection into the volume |
| `gi/cascades.js` | Radiance Cascades: tracing, merge, and SH projection |
| `gi/materials.js` | Indirect specular patch (voxel GI + planar mirror) in materials |
| `gi/planar-mirror.js` | Planar mirror: reflected camera + oblique plane clipping |
| `gi/debug.js` | Debug views (voxels, occupancy, probes) |

## Important details

- **Probes: 2^k + 1 per axis**: each cascade samples every other probe from the previous level,
  so the grids stay nested over the same volume.
- **Octahedral atlas**: averaging the 4 child directions from the parent level becomes a single
  bilinear read at the center of the 2×2 block.
- **Diffuse without shader patching**: three.js r185 accepts any object with
  `isLightProbeGrid` and applies its SH volume to all materials using lights.
- **Layered injection**: the point cloud is sorted by Z layer of the volume,
  so one cloud feeds all N layers with a `setDrawRange` per layer.
- **Reflections**: the cone widens with distance (`minTan`) to reach the scene depth under the configured
  step budget.
- **SCREEN framing**: the fit (cover/stretch, zoom, offset, flip) lives in the texture matrix
  (`texture.matrix`). The visible material uses it automatically; GI injection mirrors it manually
  (`uScreenUV`) so the emitted light matches what the camera sees.
- **Web page on the SCREEN**: there is no safe way to push an `<iframe>` into a WebGL texture
  (cross-origin isolation). `getDisplayMedia` does work: the user chooses a tab/window and its
  content arrives as a `MediaStream`, using the same pipeline as a video file.
- **Planar mirror (`base.001`)**: the cone-traced voxel GI is fuzzy and limited by volume resolution
  and step budget — it is not enough for a sharp SCREEN reflection. For that material, a classic planar
  mirror is added (three.js `Reflector.js` approach: reflected camera + Terathon oblique plane clipping),
  which renders the scene again each frame from the reflected viewpoint. It is only geometrically correct
  near a real plane, so the shader blends it with voxel GI using `dot(normal, uMirrorNormal)` and the
  plane distance (`uMirrorFade`): it dominates on the flat face and fades on curved parts (sides, legs).
  Capture uses `NoToneMapping` and linear color space — otherwise it would be tonemapped twice and would appear saturated.
  Plane height and reach are adjustable live from the Mirror panel.

## Console

`window.SIM` exposes `{ params, gi, viewer, stage, rebuildGI }` for inspection or manual rebuilds.
