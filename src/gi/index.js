import * as THREE from 'three';
import { params } from '../params.js';
import { voxelUniforms, gridUniforms, specularUniforms } from './uniforms.js';
import { make3D, clearAllLayers } from './targets.js';
import { buildPointCloud } from './pointcloud.js';
import { Voxelizer } from './voxelizer.js';
import { Cascades } from './cascades.js';

// Orquesta el pipeline completo, en este orden por actualización:
//   1. inyección  — la nube de puntos escribe radiancia en el volumen de voxels
//   2. trazado    — cada cascada marcha sus conos contra el volumen
//   3. merge      — de la cascada más alta hacia abajo
//   4. resolve    — la cascada 0 se proyecta a armónicos esféricos por sonda
//
// El resultado se publica como LightProbeGrid: three.js lo aplica solo a todos
// los materiales de la escena, sin parchear la difusa.

export class GlobalIllumination {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.cascades = new Cascades(renderer);

    this.ready = false;
    this.bounds = new THREE.Box3();
    this.volumeBox = new THREE.Box3();
    this.voxelDims = new THREE.Vector3();
    this.voxelSize = 1;
    this.voxelRT = null;
    this.voxelizer = null;
    this.probeVolume = null;
    this.pointCount = 0;
    this.lastUpdate = 0;
    this.updateMs = 0;
  }

  build(model, screenMesh) {
    this.dispose();
    if (!model) return;

    model.updateMatrixWorld(true);
    this.bounds.setFromObject(model);

    this.#buildVolume();
    const cloud = buildPointCloud({
      root: model,
      screenMesh,
      volumeBox: this.volumeBox,
      voxelDims: this.voxelDims,
      voxelSize: this.voxelSize,
      pointDensity: params.pointDensity,
      maxPoints: params.maxPoints
    });
    this.pointCount = cloud.count;
    this.voxelizer = new Voxelizer(this.renderer, cloud, this.voxelSize);

    const probeRes = this.#buildProbeGrid();
    this.cascades.build({
      probeRes,
      voxelSize: this.voxelSize,
      cascadeCount: params.cascades,
      octBase: params.octBase,
      interval0: params.interval0
    });

    this.#publishProbeVolume(probeRes);
    this.ready = true;
    // El primer update lo dispara quien llama, ya con la textura de PANTALLA puesta.
  }

  update() {
    if (!this.ready) return;
    const t0 = performance.now();

    this.voxelizer.setBounce(params.bounce);
    this.voxelizer.render(this.voxelRT);
    this.cascades.update({ traceSteps: params.traceSteps, giIntensity: params.giIntensity });

    this.renderer.setRenderTarget(null);
    this.updateMs = performance.now() - t0;
    this.lastUpdate = t0;
  }

  setScreen(screenInfo) {
    this.voxelizer?.setScreen(screenInfo);
  }

  get stats() {
    if (!this.ready) return null;
    return {
      voxelDims: this.voxelDims,
      voxelSize: this.voxelSize,
      probeGrid: this.cascades.probeGrid,
      cascadeCount: this.cascades.levels.length,
      rays: this.cascades.rayCount,
      reach: this.cascades.reach,
      points: this.pointCount,
      updateMs: this.updateMs
    };
  }

  dispose() {
    if (this.probeVolume) this.scene.remove(this.probeVolume);
    this.probeVolume = null;
    this.voxelRT?.dispose();
    this.voxelRT = null;
    this.voxelizer?.dispose();
    this.voxelizer = null;
    this.cascades.disposeLevels();
    this.ready = false;
  }

  // Volumen de voxels cúbicos ajustado al bounding box del modelo.
  #buildVolume() {
    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());
    const maxExtent = Math.max(size.x, size.y, size.z) * 1.04;
    const voxelSize = maxExtent / params.voxelRes;

    const dims = new THREE.Vector3(
      voxelAxis(size.x * 1.04, voxelSize),
      voxelAxis(size.y * 1.04, voxelSize),
      voxelAxis(size.z * 1.04, voxelSize)
    );

    const volSize = new THREE.Vector3(dims.x * voxelSize, dims.y * voxelSize, dims.z * voxelSize);
    const volMin = center.clone().addScaledVector(volSize, -0.5);

    this.voxelSize = voxelSize;
    this.voxelDims.copy(dims);
    this.volumeBox.set(volMin, volMin.clone().add(volSize));

    this.voxelRT = make3D(this.renderer, dims.x, dims.y, dims.z, true);
    clearAllLayers(this.renderer, this.voxelRT);

    voxelUniforms.uVoxels.value = this.voxelRT.texture;
    voxelUniforms.uVolMin.value.copy(volMin);
    voxelUniforms.uVolSize.value.copy(volSize);
    voxelUniforms.uVoxelWorld.value = voxelSize;
    voxelUniforms.uMaxMip.value = Math.floor(Math.log2(Math.min(dims.x, dims.y, dims.z)));
    specularUniforms.uSpecDist.value = volSize.length();
  }

  #buildProbeGrid() {
    const volSize = new THREE.Vector3().subVectors(this.volumeBox.max, this.volumeBox.min);
    const probeRes = new THREE.Vector3(
      probeAxis(volSize.x, params.cascades),
      probeAxis(volSize.y, params.cascades),
      probeAxis(volSize.z, params.cascades)
    );

    gridUniforms.uProbeMin.value.copy(this.volumeBox.min);
    gridUniforms.uProbeMax.value.copy(this.volumeBox.max);
    gridUniforms.uProbeRes.value.copy(probeRes);

    return probeRes;
  }

  // three.js r185 acepta cualquier objeto con isLightProbeGrid y aplica su
  // volumen SH a todos los materiales que usan luces.
  #publishProbeVolume(probeRes) {
    const volume = new THREE.Object3D();
    volume.isLightProbeGrid = true;
    volume.texture = this.cascades.shRT.texture;
    volume.boundingBox = this.volumeBox.clone();
    volume.resolution = probeRes.clone();
    volume.frustumCulled = false;
    this.scene.add(volume);
    this.probeVolume = volume;
  }
}

// Cada eje toma los voxels que necesita (múltiplo de 4 para que la cadena de
// mips baje limpia), sin desperdiciar memoria en los ejes cortos.
function voxelAxis(extent, voxelSize) {
  const n = Math.max(8, Math.ceil(extent / voxelSize - 1e-6));
  return Math.min(256, Math.ceil(n / 4) * 4);
}

// 2^k + 1 sondas por eje: así cada cascada muestrea una de cada dos sondas de la
// anterior y las grillas quedan anidadas sobre el mismo volumen.
function probeAxis(extent, cascadeCount) {
  const wanted = Math.max(2, Math.round(extent / params.probeSpacing));
  const k = THREE.MathUtils.clamp(Math.round(Math.log2(wanted)), cascadeCount, 5);
  return Math.pow(2, k) + 1;
}
