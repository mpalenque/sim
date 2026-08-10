import { HELPERS, VOXEL } from './glsl.js';
import { voxelUniforms, specularUniforms, skyUniforms } from './uniforms.js';

// La difusa indirecta la resuelve three.js solo: el volumen SH se publica como
// LightProbeGrid y `lights_fragment_begin` lo suma a `irradiance`.
// Acá se inyecta la especular indirecta: un cono trazado sobre el volumen de
// voxels en la dirección de reflexión — y, para el/los materiales marcados
// como espejo, un reflejo planar nítido que domina donde la superficie es
// realmente plana (ver gi/planar-mirror.js).

const patched = new WeakSet();

const SPEC_PARS = /* glsl */`
  ${VOXEL}
  uniform float uSpecEnabled;
  uniform float uSpecIntensity;
  uniform float uSpecDist;
  uniform int uSpecSteps;
  uniform float uSpecRoughCut;
  uniform vec3 uSkyColor;
`;

// Primera mitad: cono trazado sobre el voxel-GI, resultado en `giSpec`.
const SPEC_BODY_MAIN = /* glsl */`
  #if defined( RE_IndirectSpecular )
    if (uSpecEnabled > 0.5) {
      vec3 giWorldPos = ((vec4(geometryPosition, 1.0) - viewMatrix[3]) * viewMatrix).xyz;
      vec3 giWorldNormal = transformNormalByInverseViewMatrix(geometryNormal, viewMatrix);
      vec3 giWorldView = normalize(cameraPosition - giWorldPos);
      vec3 giRefl = normalize(reflect(-giWorldView, giWorldNormal));
      float giRough = clamp(material.roughness, 0.02, 1.0);

      vec3 giFallback = uSkyColor;
      #ifdef USE_LIGHT_PROBES_GRID
        giFallback += getLightProbeGridIrradiance(giWorldPos, giRefl) * RECIPROCAL_PI;
      #endif

      vec3 giSpec = giFallback;
      if (giRough <= uSpecRoughCut) {
        float giTan = clamp(giRough * giRough * 1.8, 0.0, 1.0);
        // Crecimiento mínimo del paso para cubrir uSpecDist con el presupuesto dado.
        float giMinTan = pow(uSpecDist / max(uVoxelWorld, 1e-4), 1.0 / float(uSpecSteps)) - 1.0;
        vec3 giOrigin = giWorldPos + giWorldNormal * uVoxelWorld * 1.5;
        vec4 giHit = giTraceCone(giOrigin, giRefl, uVoxelWorld, uSpecDist, giTan, giMinTan, uSpecSteps);
        giSpec = giHit.rgb + (1.0 - giHit.a) * giFallback;
      }
`;

// Segunda mitad: aplica `giSpec` (ya sea el del cono solo, o mezclado con el
// espejo planar si MIRROR_BODY corrió en el medio).
const SPEC_BODY_TAIL = /* glsl */`
      radiance += giSpec * uSpecIntensity;
    }
  #endif
`;

const MIRROR_PARS = /* glsl */`
  uniform sampler2D uMirrorMap;
  uniform mat4 uMirrorMatrix;
  uniform vec3 uMirrorNormal;
  uniform vec3 uMirrorPoint;
  uniform float uMirrorEnabled;
  uniform float uMirrorFade;
`;

// Peso del espejo: 1 donde la normal local coincide con el plano del espejo Y
// el punto está cerca de él (la tapa plana), cae a 0 en las partes curvas
// (costados, patas) para que ahí gane el reflejo borroso del voxel-GI.
const MIRROR_BODY = /* glsl */`
      if (uMirrorEnabled > 0.5) {
        vec4 giMirrorUv = uMirrorMatrix * vec4(giWorldPos, 1.0);
        vec3 giMirrorColor = texture2DProj(uMirrorMap, giMirrorUv).rgb;
        float giPlaneAlign = clamp(dot(giWorldNormal, uMirrorNormal), 0.0, 1.0);
        float giPlaneDist = abs(dot(giWorldPos - uMirrorPoint, uMirrorNormal));
        float giMirrorFade = 1.0 - smoothstep(0.0, max(uMirrorFade, 1e-3), giPlaneDist);
        float giMirrorWeight = giPlaneAlign * giPlaneAlign * giMirrorFade;
        giSpec = mix(giSpec, giMirrorColor, giMirrorWeight);
      }
`;

export function patchSceneMaterials(root, mirrors = {}) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      patchMaterial(material, material?.name ? mirrors[material.name] : null);
    }
  });
}

// `mirror`, si se pasa, es { uniforms } con uMirrorMap/uMirrorMatrix/etc —
// ver dónde se arma en main.js. Los objetos de uniform se guardan por
// referencia, así los sliders de la GUI los pueden mutar en vivo.
export function patchMaterial(material, mirror = null) {
  if (!material || patched.has(material)) return;
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return;
  patched.add(material);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, voxelUniforms, specularUniforms, skyUniforms);

    let pars = `${HELPERS}\n${SPEC_PARS}`;
    let body = SPEC_BODY_MAIN;

    if (mirror) {
      Object.assign(shader.uniforms, mirror.uniforms);
      pars += `\n${MIRROR_PARS}`;
      body += MIRROR_BODY;
    }

    body += SPEC_BODY_TAIL;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${pars}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${body}`);
  };

  material.customProgramCacheKey = () => mirror ? 'rc-gi-spec-mirror' : 'rc-gi-spec';
  material.needsUpdate = true;
}
