import * as THREE from 'three';
import { HELPERS, SH_GRID } from './glsl.js';
import { voxelUniforms, gridUniforms } from './uniforms.js';
import { blitCamera, regenerateMips } from './targets.js';

// Inyección: dibuja la nube de puntos dentro del volumen 3D, una capa por vez.
// Cada punto escribe su radiancia (emisivo + rebote del frame anterior)
// premultiplicada por la cobertura del voxel, con blending aditivo.

export class Voxelizer {
  constructor(renderer, cloud, voxelSize) {
    this.renderer = renderer;
    this.layerStart = cloud.layerStart;
    this.layerCount = cloud.layerCount;
    this.count = cloud.count;

    this.material = new THREE.ShaderMaterial({
      uniforms: Object.assign({
        uScreenMap: { value: null },
        uHasScreenMap: { value: 0 },
        uScreenTint: { value: new THREE.Color(1, 1, 1) },
        uScreenEmissive: { value: 1 },
        uScreenUV: { value: new THREE.Matrix3() },
        uBounce: { value: 0 },
        uVoxelArea: { value: voxelSize * voxelSize }
      }, voxelUniforms, gridUniforms),
      vertexShader: /* glsl */`
        ${HELPERS}
        ${SH_GRID}
        uniform vec3 uVolMin;
        uniform vec3 uVolSize;
        uniform sampler2D uScreenMap;
        uniform float uHasScreenMap;
        uniform vec3 uScreenTint;
        uniform float uScreenEmissive;
        uniform mat3 uScreenUV;
        uniform float uBounce;
        uniform float uVoxelArea;

        attribute vec4 aAlbedo;
        attribute vec4 aEmissive;
        attribute float aEmissiveScale;
        attribute float aArea;

        varying vec4 vCol;

        void main() {
          vec3 uvw = (position - uVolMin) / uVolSize;
          gl_Position = vec4(uvw.xy * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;

          vec3 albedo = aAlbedo.rgb * aAlbedo.rgb;
          vec3 emissive = aEmissive.rgb * aEmissive.rgb * aEmissiveScale;

          // La PANTALLA muestrea su textura por punto: la GI hereda el detalle
          // espacial del video, con el mismo encuadre (offset/escala/flip) que
          // se ve en el material, vía la misma matriz de UV.
          if (aAlbedo.a > 0.5 && uHasScreenMap > 0.5) {
            vec2 screenUv = (uScreenUV * vec3(uv, 1.0)).xy;
            emissive = giSRGBToLinear(textureLod(uScreenMap, screenUv, 0.0).rgb) * uScreenTint * uScreenEmissive;
          }

          vec3 bounce = vec3(0.0);
          if (uBounce > 0.001) {
            bounce = albedo * giGridIrradiance(position, normal) * GI_RCP_PI * uBounce;
          }

          float coverage = clamp(aArea / uVoxelArea, 0.0, 1.0);
          vCol = vec4((emissive + bounce) * coverage, coverage);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec4 vCol;
        void main() { gl_FragColor = vCol; }
      `,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      depthTest: false,
      depthWrite: false
    });

    this.points = new THREE.Points(cloud.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.points);
  }

  setScreen({ texture, tint, emissive }) {
    const u = this.material.uniforms;
    u.uScreenMap.value = texture ?? null;
    u.uHasScreenMap.value = texture ? 1 : 0;
    u.uScreenEmissive.value = emissive;
    if (tint) u.uScreenTint.value.copy(tint);
    // Algunos GLB dejan emissiveFactor en negro y confían sólo en el mapa.
    const t = u.uScreenTint.value;
    if (texture && t.r + t.g + t.b < 0.01) t.setRGB(1, 1, 1);

    // Misma matriz de UV que el material visible: la GI se enciende con el
    // mismo encuadre (offset/escala/flip) que se ve en pantalla.
    if (texture) {
      texture.updateMatrix();
      u.uScreenUV.value.copy(texture.matrix);
    }
  }

  setBounce(value) {
    this.material.uniforms.uBounce.value = value;
  }

  render(target) {
    const renderer = this.renderer;
    const prevAuto = renderer.autoClear;
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();

    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);

    for (let z = 0; z < target.depth; z++) {
      renderer.setRenderTarget(target, z);
      renderer.clear(true, false, false);
      const count = this.layerCount[z];
      if (count === 0) continue;
      this.points.geometry.setDrawRange(this.layerStart[z], count);
      renderer.render(this.scene, blitCamera);
    }

    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(null);

    regenerateMips(renderer, target);
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.points);
  }
}
