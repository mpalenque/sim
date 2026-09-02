import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { params } from '../params.js';
import { specularUniforms, voxelUniforms, setSkyIntensity } from '../gi/uniforms.js';

// Panel de control. `hooks` trae las acciones que dependen del resto de la app:
// rebuild() reconstruye la GI, onLights() reaplica las luces directas.

export function createGUI({ viewer, hooks }) {
  const gui = new GUI({ title: 'Radiance Cascades GI' });
  gui.add(params, 'piano').name('PIANO').onChange(hooks.onPianoToggle);
  const advanced = gui.addFolder('ADVANCED');

  const global = advanced.addFolder('Global illumination');
  global.add(params, 'giIntensity', 0, 6, 0.01).name('GI intensity');
  global.add(params, 'bounce', 0, 2, 0.01).name('Multi-bounce');
  global.add(params, 'updateHz', 1, 60, 1).name('Updates/s');
  global.add(params, 'density', 0.2, 4, 0.05).name('Voxel opacity')
    .onChange((v) => voxelUniforms.uDensity.value = v);
  global.add(params, 'skyIntensity', 0, 2, 0.01).name('Ambient sky')
    .onChange(setSkyIntensity);
  global.add(params, 'traceSteps', 4, 64, 1).name('Steps per cone');
  global.add({ rebuild: hooks.rebuild }, 'rebuild').name('Rebuild GI');

  const cascades = advanced.addFolder('Cascades');
  cascades.add(params, 'cascades', 2, 5, 1).name('Levels').onChange(hooks.rebuild);
  cascades.add(params, 'octBase', { '16 dir (fast)': 4, '64 dir (quality)': 8 })
    .name('Directions c0').onChange(hooks.rebuild);
  cascades.add(params, 'probeSpacing', 0.15, 3, 0.05).name('Probe spacing (m)').onChange(hooks.rebuild);
  cascades.add(params, 'interval0', 0.5, 8, 0.1).name('Base interval (voxels)').onChange(hooks.rebuild);

  const voxels = advanced.addFolder('Voxelization');
  voxels.add(params, 'voxelRes', { 64: 64, 96: 96, 128: 128, 160: 160, 192: 192 })
    .name('Resolution (long axis)').onChange(hooks.rebuild);
  voxels.add(params, 'pointDensity', 0.5, 6, 0.1).name('Samples per voxel').onChange(hooks.rebuild);

  const screen = advanced.addFolder('SCREEN');
  screen.add(params, 'screenEmissive', 0, 40, 0.1).name('Emission').onChange(hooks.onScreenEmissive);
  screen.add(params, 'screenFlipV').name('Flip vertical').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenFit', { 'Cover (no distortion)': 'cover', 'Stretch': 'stretch' })
    .name('Fit').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenScaleX', 0.1, 3, 0.01).name('Width (zoom)').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenScaleY', 0.1, 3, 0.01).name('Height (zoom)').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenOffsetX', -1, 1, 0.005).name('Shift X').onChange(hooks.onScreenTransform);
  screen.add(params, 'screenOffsetY', -1, 1, 0.005).name('Shift Y').onChange(hooks.onScreenTransform);

  const mirror = advanced.addFolder('Mirror (base.001)');
  mirror.add(params, 'mirrorEnabled').name('Enabled').onChange(hooks.onMirrorToggle);
  mirror.add(params, 'mirrorInset', 0, 1.5, 0.01).name('Depth from top (m)').onChange(hooks.onMirrorInset);
  mirror.add(params, 'mirrorFadeDistance', 0.05, 1.5, 0.01).name('Plane reach (m)').onChange(hooks.onMirrorFade);
  mirror.add(params, 'mirrorResolution', { 512: 512, 1024: 1024, 2048: 2048 })
    .name('Resolution').onChange(hooks.onMirrorResolution);

  const reflections = advanced.addFolder('Reflections');
  reflections.add(params, 'specular').name('Cone tracing')
    .onChange((v) => specularUniforms.uSpecEnabled.value = v ? 1 : 0);
  reflections.add(params, 'specularIntensity', 0, 3, 0.01).name('Intensity')
    .onChange((v) => specularUniforms.uSpecIntensity.value = v);
  reflections.add(params, 'specularSteps', 8, 128, 1).name('Steps')
    .onChange((v) => specularUniforms.uSpecSteps.value = v);
  reflections.add(params, 'specularRoughCut', 0, 1, 0.01).name('Max roughness')
    .onChange((v) => specularUniforms.uSpecRoughCut.value = v);

  const direct = advanced.addFolder('Direct lights');
  direct.add(params, 'externalLights').name('Turn on lights').onChange(hooks.onLights);
  direct.add(params, 'keyIntensity', 0, 8, 0.05).name('Key').onChange(hooks.onLights);
  direct.add(params, 'fillIntensity', 0, 4, 0.05).name('Fill').onChange(hooks.onLights);
  direct.add(params, 'shadows').name('Shadows').onChange(hooks.onLights);

  const output = advanced.addFolder('Quality / output');
  output.add(params, 'ssao').name('SSAO');
  output.add(params, 'ssaoRadius', 0.02, 1, 0.01).name('SSAO radius')
    .onChange((v) => viewer.ssaoPass.kernelRadius = v);
  output.add(params, 'exposure', 0.2, 2.5, 0.01).name('ACES exposure')
    .onChange((v) => viewer.renderer.toneMappingExposure = v);
  output.add(params, 'debug', {
    'Scene': 'off',
    'Voxels (radiance)': 'voxels',
    'Voxels (occupancy)': 'occupancy',
    'Probe field': 'probes'
  }).name('View');

  advanced.close();

  return gui;
}
