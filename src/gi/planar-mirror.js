import * as THREE from 'three';

// Espejo planar clásico (cámara reflejada + clip de plano oblicuo), la misma
// técnica de three/addons/objects/Reflector.js, pero desacoplada de una mesh:
// el plano se da en espacio mundo y el resultado se inyecta en el shader de un
// material EXISTENTE (ver gi/materials.js), no en una mesh nueva.
//
// A diferencia del cono trazado sobre el volumen de voxels (borroso, cualquier
// forma), esto da un reflejo nítido — pero sólo es correcto cerca del plano.
// Por eso en el shader se mezcla con el voxel-GI según qué tan alineada está
// la normal local con el plano del espejo (ver uMirrorNormal/uMirrorFade).

const _cameraWorldPosition = new THREE.Vector3();
const _rotationMatrix = new THREE.Matrix4();
const _lookAtPosition = new THREE.Vector3();
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _reflectorPlane = new THREE.Plane();
const _clipPlane = new THREE.Vector4();
const _q = new THREE.Vector4();

export class PlanarMirror {
  // `normal` y `point` se guardan por referencia (no se clonan): si algo
  // externo muta `point.y` en vivo (p. ej. un slider de la GUI), el espejo y
  // el shader que lo usa quedan sincronizados sin ningún cableado extra.
  constructor(renderer, scene, { normal, point, size = 1024, clipBias = 0.0015 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.normal = normal;
    this.point = point;
    this.clipBias = clipBias;
    this.excluded = [];
    this.reflectionCamera = null;

    this.textureMatrix = new THREE.Matrix4();
    this.renderTarget = createTarget(size);
  }

  get texture() {
    return this.renderTarget.texture;
  }

  // Meshes a esconder durante la captura: la propia superficie reflectante no
  // debe verse a sí misma ni tapar lo que hay detrás del plano.
  exclude(objects) {
    this.excluded = objects;
  }

  setSize(size) {
    this.renderTarget.dispose();
    this.renderTarget = createTarget(size);
  }

  update(camera) {
    const normal = this.normal;
    const point = this.point;

    _cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(point, _cameraWorldPosition);
    // La cámara quedó del otro lado del plano: no vale la pena renderizar.
    if (_view.dot(normal) > 0) return;

    if (!this.reflectionCamera) this.reflectionCamera = camera.clone();
    const reflectionCamera = this.reflectionCamera;

    _view.reflect(normal).negate().add(point);

    _rotationMatrix.extractRotation(camera.matrixWorld);
    _lookAtPosition.set(0, 0, -1).applyMatrix4(_rotationMatrix).add(_cameraWorldPosition);
    _target.subVectors(point, _lookAtPosition).reflect(normal).negate().add(point);

    reflectionCamera.position.copy(_view);
    reflectionCamera.up.set(0, 1, 0).applyMatrix4(_rotationMatrix).reflect(normal);
    reflectionCamera.lookAt(_target);
    reflectionCamera.far = camera.far;
    reflectionCamera.updateMatrixWorld();
    reflectionCamera.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    this.textureMatrix.multiply(reflectionCamera.projectionMatrix);
    this.textureMatrix.multiply(reflectionCamera.matrixWorldInverse);
    // A diferencia de Reflector.js no hay un `* matrixWorld` final: el shader
    // ya nos da la posición en espacio mundo directamente (ver gi/materials.js).

    applyObliqueClip(reflectionCamera, normal, point, this.clipBias);

    this.#render(reflectionCamera);
  }

  #render(reflectionCamera) {
    const renderer = this.renderer;
    const prevVisible = this.excluded.map((o) => o.visible);
    this.excluded.forEach((o) => { o.visible = false; });

    const prevTarget = renderer.getRenderTarget();
    const prevToneMapping = renderer.toneMapping;
    const prevOutputColorSpace = renderer.outputColorSpace;
    const prevShadowAutoUpdate = renderer.shadowMap.autoUpdate;

    // El material que consume esta textura la suma a `radiance` en espacio
    // lineal, sin tonemapear: todo el frame se tonemapea una sola vez al
    // final. Si esta captura ya viniera con ACES + sRGB horneados, el reflejo
    // quedaría doblemente tonemapeado (crush + gamma incorrecto).
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.shadowMap.autoUpdate = false;

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.scene, reflectionCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.toneMapping = prevToneMapping;
    renderer.outputColorSpace = prevOutputColorSpace;
    renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;

    this.excluded.forEach((o, i) => { o.visible = prevVisible[i]; });
  }

  dispose() {
    this.renderTarget.dispose();
  }
}

function createTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    generateMipmaps: false
  });
}

// Técnica de Terathon (Lengyel): mueve el near plane de la cámara reflejada a
// coincidir con el plano del espejo, para que nunca se vea geometría "debajo"
// del espejo, que rompería la ilusión.
function applyObliqueClip(reflectionCamera, normal, point, clipBias) {
  _reflectorPlane.setFromNormalAndCoplanarPoint(normal, point);
  _reflectorPlane.applyMatrix4(reflectionCamera.matrixWorldInverse);
  _clipPlane.set(_reflectorPlane.normal.x, _reflectorPlane.normal.y, _reflectorPlane.normal.z, _reflectorPlane.constant);

  const m = reflectionCamera.projectionMatrix.elements;
  _q.x = (Math.sign(_clipPlane.x) + m[8]) / m[0];
  _q.y = (Math.sign(_clipPlane.y) + m[9]) / m[5];
  _q.z = -1.0;
  _q.w = (1.0 + m[10]) / m[14];

  _clipPlane.multiplyScalar(2.0 / _clipPlane.dot(_q));
  m[2] = _clipPlane.x;
  m[6] = _clipPlane.y;
  m[10] = _clipPlane.z + 1.0 - clipBias;
  m[14] = _clipPlane.w;
}
