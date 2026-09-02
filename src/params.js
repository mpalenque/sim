// Configuración única de la simulación. Todo lo que toca la GUI vive acá.
export const params = {
  // --- Scene layout ---
  // true: piano (Sketchfab_model). false: desk + DJ.
  piano: true,

  // --- Voxelization ---
  voxelRes: 128,          // voxels on the longest axis of the volume
  pointDensity: 2.0,      // surface samples per voxel area
  maxPoints: 700000,      // hard cap for generated points
  density: 1.0,           // voxel opacity multiplier

  // --- Cascades ---
  cascades: 4,
  octBase: 4,             // 4 => 16 directions in cascade 0
  probeSpacing: 0.65,     // desired meters between probes in cascade 0
  interval0: 4.0,         // length of the first interval, in voxels
  traceSteps: 24,

  // --- Global illumination ---
  giIntensity: 1.0,
  bounce: 0.85,           // multi-bounce feedback (temporal)
  skyIntensity: 0.0,
  updateHz: 30,

  // --- Reflections ---
  specular: true,
  specularIntensity: 1.0,
  specularSteps: 48,
  specularRoughCut: 0.72,

  // --- SCREEN ---
  screenEmissive: 6.0,
  // The real flip is already done by texture.flipY = false in screen-source.js (aligns
  // the VideoTexture with the glTF convention used by the rest of the GLB textures).
  // This toggle is an extra manual flip in case a particular video still comes in inverted;
  // by default it should do nothing.
  screenFlipV: false,
  screenFit: 'cover',       // cover | stretch
  screenScaleX: 1.0,        // manual zoom on top of auto framing
  screenScaleY: 1.0,
  screenOffsetX: 0.0,       // manual offset, in screen-fraction units
  screenOffsetY: 0.0,

  // --- Planar mirror (material base.001) ---
  mirrorEnabled: true,
  mirrorInset: 0.66,          // meters below the upper edge of the real planar surface
  mirrorFadeDistance: 0.35,   // meters: how quickly the mirror fades away from that plane
  mirrorResolution: 1024,

  // --- Direct lights (off: only emissive materials illuminate) ---
  externalLights: false,
  keyIntensity: 1.35,
  fillIntensity: 0.32,
  shadows: true,

  // --- Output ---
  ssao: true,
  ssaoRadius: 0.16,
  exposure: 0.92,

  // --- Debug: off | voxels | occupancy | probes ---
  debug: 'off'
};
