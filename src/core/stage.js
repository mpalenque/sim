import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { params } from '../params.js';

const SCREEN_PATTERN = /(pantalla|screen|display|monitor|tv|led)/;

// Carga del GLB, detección de la mesh PANTALLA y encuadre inicial de la cámara.

export async function loadStage(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  let screenMesh = null;

  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const searchable = `${object.name} ${materials.map((m) => m?.name || '').join(' ')}`.toLowerCase();
    if (!screenMesh && SCREEN_PATTERN.test(searchable)) screenMesh = object;
  });

  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const screen = screenMesh ? describeScreen(screenMesh, bounds) : null;

  return { model, screenMesh, screen, bounds };
}

// Alterna las dos disposiciones que vienen dentro del GLB. Al ocultar la
// raíz se ocultan también todos sus hijos, sin alterar su jerarquía original.
export function setStageLayout(model, pianoVisible) {
  setNamedObjectsVisible(model, 'Sketchfab_model', pianoVisible);
  setNamedObjectsVisible(model, 'mesa', !pianoVisible);
  setNamedObjectsVisible(model, 'dj', !pianoVisible);
  model.updateMatrixWorld(true);
}

function setNamedObjectsVisible(model, name, visible) {
  model.traverse((object) => {
    if (object.name === name) object.visible = visible;
  });
}

// El eje más delgado de la mesh es la normal de la pantalla; el signo se elige
// apuntando hacia el centro del resto del set.
function describeScreen(mesh, bounds) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const sceneCenter = bounds.getCenter(new THREE.Vector3());

  const axes = [
    { size: size.x, vector: new THREE.Vector3(1, 0, 0) },
    { size: size.y, vector: new THREE.Vector3(0, 1, 0) },
    { size: size.z, vector: new THREE.Vector3(0, 0, 1) }
  ].sort((a, b) => a.size - b.size);

  const normal = axes[0].vector.clone();
  if (sceneCenter.clone().sub(center).dot(normal) < 0) normal.negate();

  const planeAxes = axes.slice(1).sort((a, b) => b.size - a.size);
  const horizontal = planeAxes[0].vector.clone();
  const vertical = planeAxes[1].vector.clone();
  if (vertical.dot(new THREE.Vector3(0, 1, 0)) < 0) vertical.negate();

  // Material propio para poder cambiarle la emisión sin tocar el GLB original.
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const cloned = materials.map((m) => m.clone());
  mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  const material = cloned[0];
  material.emissiveIntensity = params.screenEmissive;
  material.needsUpdate = true;

  return {
    mesh,
    material,
    center,
    normal,
    horizontal,
    vertical,
    width: Math.max(planeAxes[0].size, 0.5),
    height: Math.max(planeAxes[1].size, 0.25)
  };
}

export function frameCamera(camera, controls, bounds, screen) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 1);

  camera.near = Math.max(radius / 400, 0.02);
  camera.far = Math.max(radius * 40, 200);
  camera.updateProjectionMatrix();

  if (screen) {
    // Arranca adentro del set, mirando la pantalla: encuadrar el bounding box
    // completo dejaría la cámara detrás de la pared exterior curva.
    const n = screen.normal;
    const roomDepth = Math.abs(size.x * n.x) + Math.abs(size.y * n.y) + Math.abs(size.z * n.z);
    controls.target.copy(screen.center)
      .addScaledVector(n, roomDepth * 0.19)
      .addScaledVector(screen.vertical, screen.height * 0.05);
    camera.position.copy(controls.target)
      .addScaledVector(n, roomDepth * 0.30)
      .addScaledVector(screen.horizontal, screen.width * 0.48)
      .addScaledVector(screen.vertical, screen.height * 0.24);
  } else {
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const direction = new THREE.Vector3(-1, 0.45, 1).normalize();
    controls.target.copy(center).add(new THREE.Vector3(0, size.y * 0.04, 0));
    camera.position.copy(center).addScaledVector(direction, distance * 0.82);
  }

  controls.minDistance = radius * 0.08;
  controls.maxDistance = radius * 8;
  controls.update();
}

// Ubica todas las meshes que usan un material por nombre y calcula un plano
// espejo en espacio mundo: normal +Y, a `insetFromTop` metros por debajo del
// tope de su bounding box combinada.
//
// El tope exacto de la caja no siempre es la superficie plana real (puede
// haber un reborde o una tapa recesada por debajo) — de ahí el inset, pensado
// para ajustarse a ojo desde la GUI mientras se ve el reflejo en vivo.
export function findMirrorPlane(model, materialName, insetFromTop = 0) {
  const meshes = [];
  let material = null;

  model.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const match = materials.find((m) => m?.name === materialName);
    if (match) {
      meshes.push(object);
      material = match;
    }
  });

  if (!meshes.length) return null;

  const box = new THREE.Box3();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    box.expandByObject(mesh);
  }
  const center = box.getCenter(new THREE.Vector3());

  return {
    meshes,
    material,
    boxMaxY: box.max.y,
    normal: new THREE.Vector3(0, 1, 0),
    point: new THREE.Vector3(center.x, box.max.y - insetFromTop, center.z)
  };
}

export function disposeModel(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose();
  });
}
