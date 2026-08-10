import * as THREE from 'three';

// Objetos de uniform compartidos: las pasadas de GI y los materiales parcheados
// referencian estos mismos objetos, así un solo cambio se propaga a todos los
// shaders sin recorrer la escena.

export const voxelUniforms = {
  uVoxels: { value: null },
  uVolMin: { value: new THREE.Vector3() },
  uVolSize: { value: new THREE.Vector3(1, 1, 1) },
  uVoxelWorld: { value: 1 },
  uMaxMip: { value: 1 },
  uDensity: { value: 1 }
};

export const gridUniforms = {
  uSHGrid: { value: null },
  uProbeMin: { value: new THREE.Vector3() },
  uProbeMax: { value: new THREE.Vector3(1, 1, 1) },
  uProbeRes: { value: new THREE.Vector3(1, 1, 1) }
};

export const specularUniforms = {
  uSpecEnabled: { value: 1 },
  uSpecIntensity: { value: 1 },
  uSpecDist: { value: 40 },
  uSpecSteps: { value: 48 },
  uSpecRoughCut: { value: 0.72 }
};

export const skyUniforms = {
  uSkyColor: { value: new THREE.Color(0, 0, 0) }
};

export function setSkyIntensity(intensity) {
  skyUniforms.uSkyColor.value.setRGB(0.05 * intensity, 0.07 * intensity, 0.11 * intensity);
}
