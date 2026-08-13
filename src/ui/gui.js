import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { params } from '../params.js';
import { specularUniforms, voxelUniforms, setSkyIntensity } from '../gi/uniforms.js';

// Panel de control. `hooks` trae las acciones que dependen del resto de la app:
// rebuild() reconstruye la GI, onLights() reaplica las luces directas.

export function createGUI({ viewer, hooks }) {
  const gui = new GUI({ title: 'Radiance Cascades GI' });
  gui.add(params, 'piano').name('PIANO').onChange(hooks.onPianoToggle);
  const advanced = gui.addFolder('ADVANCED');

  const global = advanced.addFolder('Iluminación global');
  global.add(params, 'giIntensity', 0, 6, 0.01).name('Intensidad GI');
  global.add(params, 'bounce', 0, 2, 0.01).name('Rebotes múltiples');
  global.add(params, 'updateHz', 1, 60, 1).name('Actualizaciones/s');
  global.add(params, 'density', 0.2, 4, 0.05).name('Opacidad de voxels')
    .onChange((v) => voxelUniforms.uDensity.value = v);
  global.add(params, 'skyIntensity', 0, 2, 0.01).name('Cielo ambiente')
    .onChange(setSkyIntensity);
  global.add(params, 'traceSteps', 4, 64, 1).name('Pasos por cono');
  global.add({ rebuild: hooks.rebuild }, 'rebuild').name('Reconstruir GI');

  const cascades = advanced.addFolder('Cascadas');
  cascades.add(params, 'cascades', 2, 5, 1).name('Niveles').onChange(hooks.rebuild);
  cascades.add(params, 'octBase', { '16 dir (rápido)': 4, '64 dir (calidad)': 8 })
    .name('Direcciones c0').onChange(hooks.rebuild);
  cascades.add(params, 'probeSpacing', 0.15, 3, 0.05).name('Separación sondas (m)').onChange(hooks.rebuild);
  cascades.add(params, 'interval0', 0.5, 8, 0.1).name('Intervalo base (voxels)').onChange(hooks.rebuild);

  const voxels = advanced.addFolder('Voxelización');
  voxels.add(params, 'voxelRes', { 64: 64, 96: 96, 128: 128, 160: 160, 192: 192 })
    .name('Resolución (eje largo)').onChange(hooks.rebuild);
  voxels.add(params, 'pointDensity', 0.5, 6, 0.1).name('Muestras por voxel').onChange(hooks.rebuild);

  const screen = advanced.addFolder('PANTALLA');
  screen.add(params, 'screenEmissive', 0, 40, 0.1).name('Emisión').onChange(hooks.onScreenEmissive);
  screen.add(params, 'screenFlipV').name('Invertir vertical').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenFit', { 'Cubrir (sin deformar)': 'cover', 'Estirar': 'stretch' })
    .name('Ajuste').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenScaleX', 0.1, 3, 0.01).name('Ancho (zoom)').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenScaleY', 0.1, 3, 0.01).name('Alto (zoom)').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenOffsetX', -1, 1, 0.005).name('Desplazar X').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenOffsetY', -1, 1, 0.005).name('Desplazar Y').onChange(hooks.onScreenTransform);

  const mirror = advanced.addFolder('Espejo (base.001)');
  mirror.add(params, 'mirrorEnabled').name('Activado').onChange(hooks.onMirrorToggle);
  mirror.add(params, 'mirrorInset', 0, 1.5, 0.01).name('Profundidad desde arriba (m)').onChange(hooks.onMirrorInset);
  mirror.add(params, 'mirrorFadeDistance', 0.05, 1.5, 0.01).name('Alcance del plano (m)').onChange(hooks.onMirrorFade);
  mirror.add(params, 'mirrorResolution', { 512: 512, 1024: 1024, 2048: 2048 })
    .name('Resolución').onChange(hooks.onMirrorResolution);

  const reflections = advanced.addFolder('Reflejos');
  reflections.add(params, 'specular').name('Cone tracing')
    .onChange((v) => specularUniforms.uSpecEnabled.value = v ? 1 : 0);
  reflections.add(params, 'specularIntensity', 0, 3, 0.01).name('Intensidad')
    .onChange((v) => specularUniforms.uSpecIntensity.value = v);
  reflections.add(params, 'specularSteps', 8, 128, 1).name('Pasos')
    .onChange((v) => specularUniforms.uSpecSteps.value = v);
  reflections.add(params, 'specularRoughCut', 0, 1, 0.01).name('Rugosidad máx.')
    .onChange((v) => specularUniforms.uSpecRoughCut.value = v);

  const direct = advanced.addFolder('Luces directas');
  direct.add(params, 'externalLights').name('Encender luces').onChange(hooks.onLights);
  direct.add(params, 'keyIntensity', 0, 8, 0.05).name('Principal').onChange(hooks.onLights);
  direct.add(params, 'fillIntensity', 0, 4, 0.05).name('Relleno').onChange(hooks.onLights);
  direct.add(params, 'shadows').name('Sombras').onChange(hooks.onLights);

  const output = advanced.addFolder('Calidad / salida');
  output.add(params, 'ssao').name('SSAO');
  output.add(params, 'ssaoRadius', 0.02, 1, 0.01).name('Radio SSAO')
    .onChange((v) => viewer.ssaoPass.kernelRadius = v);
  output.add(params, 'exposure', 0.2, 2.5, 0.01).name('Exposición ACES')
    .onChange((v) => viewer.renderer.toneMappingExposure = v);
  output.add(params, 'debug', {
    'Escena': 'off',
    'Voxels (radiancia)': 'voxels',
    'Voxels (ocupación)': 'occupancy',
    'Campo de sondas': 'probes'
  }).name('Vista');

  advanced.close();

  return gui;
}
