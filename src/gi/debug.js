import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HELPERS, VOXEL, SH_GRID, QUAD_VERTEX } from './glsl.js';
import { voxelUniforms, gridUniforms } from './uniforms.js';

// Vistas de inspección: qué guardó realmente el volumen y qué resolvieron
// las cascadas. Útiles para separar "la GI está mal" de "la escena está oscura".

const MODES = { voxels: 0, occupancy: 1, probes: 2 };

export class DebugView {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: Object.assign({
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uCameraPos: { value: new THREE.Vector3() },
        uResolution: { value: new THREE.Vector2() },
        uMode: { value: 0 }
      }, voxelUniforms, gridUniforms),
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */`
        ${HELPERS}
        ${VOXEL}
        ${SH_GRID}
        uniform mat4 uInvProjection;
        uniform mat4 uCameraWorld;
        uniform vec3 uCameraPos;
        uniform vec2 uResolution;
        uniform float uMode;

        void main() {
          vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
          vec4 viewDir = uInvProjection * vec4(ndc, -1.0, 1.0);
          viewDir /= viewDir.w;
          vec3 dir = normalize((uCameraWorld * vec4(viewDir.xyz, 0.0)).xyz);
          float span = length(uVolSize);

          vec3 color;

          if (uMode < 0.5) {
            // Radiancia almacenada en los voxels.
            color = giTraceCone(uCameraPos, dir, uVoxelWorld, span * 2.0, 0.001, 0.02, 256).rgb;

          } else if (uMode < 1.5) {
            // Ocupación: primer voxel sólido, sombreado por profundidad.
            float t = uVoxelWorld;
            float hitT = -1.0;
            for (int i = 0; i < 512; i++) {
              if (t >= span * 2.0) break;
              if (giSampleVoxel(uCameraPos + dir * t, 0.0).a * uDensity > 0.25) { hitT = t; break; }
              t += uVoxelWorld * 0.75;
            }
            color = hitT < 0.0
              ? vec3(0.02, 0.03, 0.05)
              : vec3(clamp(1.0 - hitT / (span * 0.6), 0.05, 1.0));

          } else {
            // Campo de irradiancia resuelto por las cascadas.
            vec3 acc = vec3(0.0);
            float t = uVoxelWorld;
            for (int i = 0; i < 96; i++) {
              acc += giGridIrradiance(uCameraPos + dir * t, -dir) * 0.02;
              t += span / 96.0;
            }
            color = acc;
          }

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false
    }));
  }

  render(camera, mode) {
    const u = this.quad.material.uniforms;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    u.uCameraPos.value.copy(camera.position);
    u.uResolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height);
    u.uMode.value = MODES[mode] ?? 0;

    this.renderer.setRenderTarget(null);
    this.quad.render(this.renderer);
  }

  dispose() {
    this.quad.dispose();
  }
}
