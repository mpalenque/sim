// Configuración única de la simulación. Todo lo que toca la GUI vive acá.
export const params = {
  // --- Disposición del escenario ---
  // true: piano (Sketchfab_model). false: mesa + DJ.
  piano: true,

  // --- Voxelización ---
  voxelRes: 128,          // voxels en el eje más largo del volumen
  pointDensity: 2.0,      // muestras de superficie por área de voxel
  maxPoints: 700000,      // techo duro de puntos generados
  density: 1.0,           // multiplicador de opacidad del voxel

  // --- Cascadas ---
  cascades: 4,
  octBase: 4,             // 4 => 16 direcciones en la cascada 0
  probeSpacing: 0.65,     // metros deseados entre sondas de la cascada 0
  interval0: 4.0,         // largo del primer intervalo, en voxels
  traceSteps: 24,

  // --- Iluminación global ---
  giIntensity: 1.0,
  bounce: 0.85,           // rebotes múltiples (realimentación temporal)
  skyIntensity: 0.0,
  updateHz: 20,

  // --- Reflejos ---
  specular: true,
  specularIntensity: 1.0,
  specularSteps: 48,
  specularRoughCut: 0.72,

  // --- PANTALLA ---
  screenEmissive: 6.0,
  // El flip real ya lo hace texture.flipY = false en screen-source.js (alinea
  // la VideoTexture con la convención glTF del resto de las texturas del GLB).
  // Este toggle es un flip manual extra, por si algún video en particular
  // sigue viniendo invertido; por default no debe tocar nada.
  screenFlipV: false,
  screenFit: 'cover',       // cover | stretch
  screenScaleX: 1.0,        // zoom manual encima del ajuste automático
  screenScaleY: 1.0,
  screenOffsetX: 0.0,       // desplazamiento manual, en fracción de pantalla
  screenOffsetY: 0.0,

  // --- Espejo planar (material base.001) ---
  mirrorEnabled: true,
  mirrorInset: 0.66,          // metros por debajo del tope de la caja donde está la superficie plana real
  mirrorFadeDistance: 0.35,   // metros: qué tan rápido se apaga el espejo lejos de ese plano
  mirrorResolution: 1024,

  // --- Luces directas (apagadas: sólo iluminan los emisivos) ---
  externalLights: false,
  keyIntensity: 1.35,
  fillIntensity: 0.32,
  shadows: true,

  // --- Salida ---
  ssao: true,
  ssaoRadius: 0.16,
  exposure: 0.92,

  // --- Debug: off | voxels | occupancy | probes ---
  debug: 'off'
};
