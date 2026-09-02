import * as THREE from 'three';
import { params } from './params.js';
import {
  setStatus, setLoader, showLoader, setStats, nextFrame,
  videoInput, audioToggleButton, captureButton
} from './ui/dom.js';
import { createGUI } from './ui/gui.js';
import { createViewer } from './core/viewer.js';
import { loadStage, frameCamera, disposeModel, findMirrorPlane, setStageLayout } from './core/stage.js';
import {
  loadVideoFile, startDisplayCapture, pauseScreen, getScreenTexture, applyScreenTransform
  , isScreenMuted, toggleScreenMute
} from './core/screen-source.js';
import { GlobalIllumination } from './gi/index.js';
import { patchSceneMaterials } from './gi/materials.js';
import { setSkyIntensity, specularUniforms, voxelUniforms } from './gi/uniforms.js';
import { PlanarMirror } from './gi/planar-mirror.js';
import { DebugView } from './gi/debug.js';

const MIRROR_MATERIAL = 'base.001';

THREE.ColorManagement.enabled = true;

const MODEL_URL = './ESCENARIO2.glb';

const viewer = createViewer();
const gi = new GlobalIllumination(viewer.renderer, viewer.scene);
const debugView = new DebugView(viewer.renderer);

let stage = null;
let lastStatsAt = 0;
let mirrorPlane = null;
let planarMirror = null;
let mirrorUniforms = null;

setSkyIntensity(params.skyIntensity);
voxelUniforms.uDensity.value = params.density;
specularUniforms.uSpecEnabled.value = params.specular ? 1 : 0;
specularUniforms.uSpecIntensity.value = params.specularIntensity;
specularUniforms.uSpecSteps.value = params.specularSteps;
specularUniforms.uSpecRoughCut.value = params.specularRoughCut;

const caps = viewer.capabilities();
if (!caps.floatRenderTargets) {
  specularUniforms.uSpecEnabled.value = 0;
  setStatus('Esta GPU no permite render targets HDR: la GI no puede correr', 'error');
}

createGUI({
  viewer,
  hooks: {
    rebuild: rebuildGI,
    onLights: () => viewer.applyLightingMode(),
    onScreenEmissive: (value) => {
      if (stage?.screen) stage.screen.material.emissiveIntensity = value;
      pushScreenToGI();
    },
    onScreenTransform: () => {
      if (stage?.screen) applyScreenTransform(stage.screen);
      pushScreenToGI();
    },
    onMirrorToggle: (value) => {
      if (mirrorUniforms) mirrorUniforms.uMirrorEnabled.value = value ? 1 : 0;
    },
    onMirrorInset: (value) => {
      if (mirrorPlane) mirrorPlane.point.y = mirrorPlane.boxMaxY - value;
    },
    onMirrorFade: (value) => {
      if (mirrorUniforms) mirrorUniforms.uMirrorFade.value = value;
    },
    onMirrorResolution: (value) => {
      if (!planarMirror) return;
      planarMirror.setSize(value);
      mirrorUniforms.uMirrorMap.value = planarMirror.texture;
    },
    onPianoToggle: async (pianoVisible) => {
      if (!stage) return;
      setStageLayout(stage.model, pianoVisible);
      await rebuildGI();
    }
  }
});

videoInput.addEventListener('change', async () => {
  const [file] = videoInput.files;
  if (!file) return;
  try {
    const { playing } = await loadVideoFile(file, stage?.screen, viewer.renderer.domElement);
    pushScreenToGI();
    updateAudioToggle();
    setStatus(playing
      ? `${file.name} · emisión de PANTALLA → cascadas`
      : `${file.name} listo · tocá la escena para reproducir`, 'ready');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

audioToggleButton.addEventListener('click', () => {
  if (toggleScreenMute() === null) return;
  updateAudioToggle();
});

captureButton.addEventListener('click', async () => {
  try {
    const { playing, label } = await startDisplayCapture(stage?.screen, viewer.renderer.domElement, () => {
      setStatus('Captura de pantalla finalizada', '');
    });
    pushScreenToGI();
    updateAudioToggle();
    setStatus(playing
      ? `${label} · emisión de PANTALLA → cascadas`
      : `${label} lista · tocá la escena para reproducir`, 'ready');
  } catch (error) {
    // El usuario cancela el selector de pestaña: no es un error real.
    if (error?.name !== 'NotAllowedError') setStatus(error.message, 'error');
  }
});

addEventListener('resize', () => viewer.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseScreen(); });

await boot();
viewer.renderer.setAnimationLoop(frame);

async function boot() {
  setStatus('Cargando ESCENARIO2.glb…');

  try {
    stage = await loadStage(MODEL_URL);
    setStageLayout(stage.model, params.piano);
    viewer.scene.add(stage.model);
    viewer.fitLights(stage.bounds);
    viewer.applyLightingMode();
    frameCamera(viewer.camera, viewer.controls, stage.bounds, stage.screen);

    setLoader('Construyendo iluminación global', 'Muestreando la malla y armando el volumen de voxels');
    await nextFrame();

    if (caps.floatRenderTargets) {
      gi.build(stage.model, stage.screenMesh);
      pushScreenToGI();
      gi.update();
    }
    patchSceneMaterials(stage.model, buildMirror());

    showLoader(false);
    setStatus(summary(), 'ready');
  } catch (error) {
    console.error(error);
    showLoader(false);
    setStatus(`No se pudo cargar ESCENARIO2.glb: ${error.message}`, 'error');
  }
}

async function rebuildGI() {
  if (!stage || !caps.floatRenderTargets) return;
  showLoader(true);
  setLoader('Reconstruyendo iluminación global', 'Voxelizando y rearmando las cascadas');
  await nextFrame();

  try {
    gi.build(stage.model, stage.screenMesh);
    pushScreenToGI();
    gi.update();
    setStatus(summary(), 'ready');
  } catch (error) {
    console.error(error);
    setStatus(`Error al construir la GI: ${error.message}`, 'error');
  }

  showLoader(false);
}

// Arma el espejo planar para MIRROR_MATERIAL y devuelve el mapa que
// patchSceneMaterials espera: { [nombreDeMaterial]: { uniforms } }. Si el GLB
// no tiene ese material, no hace nada (patchSceneMaterials sigue andando
// normal, sólo sin espejo).
function buildMirror() {
  mirrorPlane = findMirrorPlane(stage.model, MIRROR_MATERIAL, params.mirrorInset);
  if (!mirrorPlane) return {};

  planarMirror = new PlanarMirror(viewer.renderer, viewer.scene, {
    normal: mirrorPlane.normal,
    point: mirrorPlane.point,
    size: params.mirrorResolution
  });
  planarMirror.exclude(mirrorPlane.meshes);

  mirrorUniforms = {
    uMirrorMap: { value: planarMirror.texture },
    uMirrorMatrix: { value: planarMirror.textureMatrix },
    uMirrorNormal: { value: mirrorPlane.normal },
    uMirrorPoint: { value: mirrorPlane.point },
    uMirrorEnabled: { value: params.mirrorEnabled ? 1 : 0 },
    uMirrorFade: { value: params.mirrorFadeDistance }
  };

  return { [MIRROR_MATERIAL]: { uniforms: mirrorUniforms } };
}

// La PANTALLA usa el video si hay uno cargado; si no, su propio emissiveMap.
function pushScreenToGI() {
  const material = stage?.screen?.material;
  gi.setScreen({
    texture: getScreenTexture() ?? material?.emissiveMap ?? null,
    tint: material?.emissive,
    emissive: params.screenEmissive
  });
}

function updateAudioToggle() {
  const muted = isScreenMuted();
  audioToggleButton.disabled = false;
  audioToggleButton.ariaPressed = String(muted);
  audioToggleButton.textContent = muted ? 'Activar sonido' : 'Silenciar video';
}

function frame(time) {
  viewer.controls.update();

  if (gi.ready && time - gi.lastUpdate >= 1000 / params.updateHz) gi.update();

  if (params.debug !== 'off' && gi.ready) {
    debugView.render(viewer.camera, params.debug);
  } else {
    if (planarMirror && params.mirrorEnabled) planarMirror.update(viewer.camera);
    viewer.renderFrame();
  }

  if (time - lastStatsAt > 400) {
    lastStatsAt = time;
    refreshStats();
  }
}

function refreshStats() {
  const s = gi.stats;
  if (!s) { setStats(''); return; }
  const d = s.voxelDims;
  const p = s.probeGrid;
  setStats(
    `voxels    ${d.x}×${d.y}×${d.z}  (${s.voxelSize.toFixed(3)} m)\n` +
    `sondas    ${p.x}×${p.y}×${p.z} × ${s.cascadeCount} cascadas\n` +
    `rayos     ${(s.rays / 1000).toFixed(0)}k por actualización\n` +
    `puntos    ${(s.points / 1000).toFixed(0)}k\n` +
    `GI        ${s.updateMs.toFixed(1)} ms`
  );
}

function summary() {
  const s = gi.stats;
  if (!s) return 'GI no disponible';
  return `GI activa · ${s.cascadeCount} cascadas · alcance ${s.reach.toFixed(1)} m`;
}

// Handle de inspección desde la consola del navegador.
window.SIM = {
  params, gi, viewer, stage, rebuildGI, disposeModel,
  get planarMirror() { return planarMirror; },
  get mirrorPlane() { return mirrorPlane; },
  get mirrorUniforms() { return mirrorUniforms; }
};
