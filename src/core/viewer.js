import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { params } from '../params.js';
import { viewport } from '../ui/dom.js';

// Renderer, cámara, controles, composer y las dos luces directas (apagadas por
// defecto: la escena se ilumina sólo con los materiales emisivos).

export function createViewer() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 500);
  camera.position.set(10, 7, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = params.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  viewport.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 0.35;
  controls.maxDistance = 180;

  const msaaTarget = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4
  });
  const composer = new EffectComposer(renderer, msaaTarget);
  composer.addPass(new RenderPass(scene, camera));
  const ssaoPass = new SSAOPass(scene, camera, innerWidth, innerHeight);
  ssaoPass.kernelRadius = params.ssaoRadius;
  ssaoPass.minDistance = 0.003;
  ssaoPass.maxDistance = 0.12;
  composer.addPass(ssaoPass);
  composer.addPass(new OutputPass());

  const keyLight = new THREE.DirectionalLight(0xfff3df, params.keyIntensity);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.025;
  keyLight.visible = params.externalLights;
  scene.add(keyLight, keyLight.target);

  const fillLight = new THREE.DirectionalLight(0xb9d4ff, params.fillIntensity);
  fillLight.visible = params.externalLights;
  scene.add(fillLight, fillLight.target);

  const viewer = {
    scene, camera, renderer, controls, composer, ssaoPass, keyLight, fillLight,

    renderFrame() {
      ssaoPass.enabled = params.ssao;
      if (params.ssao) composer.render();
      else renderer.render(scene, camera);
    },

    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
      composer.setSize(innerWidth, innerHeight);
    },

    applyLightingMode() {
      keyLight.visible = params.externalLights;
      fillLight.visible = params.externalLights;
      keyLight.intensity = params.keyIntensity;
      fillLight.intensity = params.fillIntensity;
      keyLight.castShadow = params.shadows;
    },

    // Encuadra las luces directas al tamaño real del set.
    fitLights(bounds) {
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.z, 4) * 0.65;

      keyLight.position.copy(center).add(new THREE.Vector3(span * 0.55, Math.max(size.y, 3), span * 0.45));
      keyLight.target.position.copy(center);
      keyLight.shadow.camera.left = -span;
      keyLight.shadow.camera.right = span;
      keyLight.shadow.camera.top = span;
      keyLight.shadow.camera.bottom = -span;
      keyLight.shadow.camera.far = Math.max(size.length() * 3, 30);
      keyLight.shadow.camera.updateProjectionMatrix();

      fillLight.position.copy(center).add(new THREE.Vector3(-span, size.y * 0.7, -span * 0.7));
      fillLight.target.position.copy(center);
    },

    capabilities() {
      const gl = renderer.getContext();
      return {
        max3D: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        floatRenderTargets: renderer.extensions.has('EXT_color_buffer_float') ||
                            renderer.extensions.has('EXT_color_buffer_half_float')
      };
    }
  };

  return viewer;
}
