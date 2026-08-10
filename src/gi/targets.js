import * as THREE from 'three';

// Helpers de render target. Los volúmenes 3D se dibujan capa por capa:
// renderer.setRenderTarget(rt, z) engancha esa capa con framebufferTextureLayer.

const emptyScene = new THREE.Scene();
const blitCamera = new THREE.Camera();

export { blitCamera };

export function make2D(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    colorSpace: THREE.NoColorSpace
  });
}

export function make3D(renderer, width, height, depth, mipmapped) {
  const rt = new THREE.WebGL3DRenderTarget(width, height, depth, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: mipmapped ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: !!mipmapped,
    colorSpace: THREE.NoColorSpace
  });
  rt.texture.wrapR = THREE.ClampToEdgeWrapping;

  // Fuerza la creación del framebuffer y de la cadena de mips antes de usarlo;
  // después se apaga el flag para no regenerar mips en cada capa.
  renderer.setRenderTarget(rt, 0);
  renderer.setRenderTarget(null);
  if (mipmapped) rt.texture.generateMipmaps = false;

  return rt;
}

export function clearAllLayers(renderer, rt) {
  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);

  for (let z = 0; z < rt.depth; z++) {
    renderer.setRenderTarget(rt, z);
    renderer.clear(true, false, false);
  }

  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha);
}

// Regenera los mips sin tocar el contenido: un render vacío dispara
// updateRenderTargetMipmap() al final de WebGLRenderer.render().
export function regenerateMips(renderer, rt) {
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  rt.texture.generateMipmaps = true;
  renderer.setRenderTarget(rt, 0);
  renderer.render(emptyScene, blitCamera);
  rt.texture.generateMipmaps = false;
  renderer.setRenderTarget(null);
  renderer.autoClear = prevAuto;
}
