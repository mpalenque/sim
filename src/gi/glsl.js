// Fragmentos GLSL compartidos entre las pasadas de GI y los materiales de escena.
// Los materiales de three.js se compilan como `#version 300 es`, así que se puede
// usar sampler3D / textureLod / texelFetch en todos ellos.

export const HELPERS = /* glsl */`
  #define GI_RCP_PI 0.31830988618379067
  #define GI_PI 3.141592653589793

  vec3 giOctDecode(vec2 f) {
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.x += (n.x >= 0.0) ? -t : t;
    n.y += (n.y >= 0.0) ? -t : t;
    return normalize(n);
  }

  vec3 giSRGBToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  }
`;

// Marcha de conos sobre el volumen de voxels.
// El volumen guarda radiancia premultiplicada por la cobertura del voxel.
export const VOXEL = /* glsl */`
  uniform highp sampler3D uVoxels;
  uniform vec3 uVolMin;
  uniform vec3 uVolSize;
  uniform float uVoxelWorld;
  uniform float uMaxMip;
  uniform float uDensity;

  vec4 giSampleVoxel(vec3 p, float lod) {
    vec3 uvw = (p - uVolMin) / uVolSize;
    if (uvw.x < 0.0 || uvw.y < 0.0 || uvw.z < 0.0 ||
        uvw.x > 1.0 || uvw.y > 1.0 || uvw.z > 1.0) return vec4(0.0);
    return textureLod(uVoxels, uvw, lod);
  }

  // minTan fuerza un crecimiento mínimo del paso: así un cono muy cerrado
  // (un reflejo especular) igual llega al final del intervalo con el
  // presupuesto de pasos disponible, difuminándose con la distancia.
  vec4 giTraceCone(vec3 origin, vec3 dir, float t0, float t1, float coneTan, float minTan, int maxSteps) {
    vec4 acc = vec4(0.0);
    float t = max(t0, uVoxelWorld * 0.25);

    for (int i = 0; i < maxSteps; i++) {
      if (t >= t1 || acc.a > 0.995) break;

      float radius = max(coneTan * t, uVoxelWorld * 0.5);
      float ds = min(max(radius, minTan * t), t1 - t);
      float sampleRadius = max(radius, ds * 0.5);
      float lod = clamp(log2(max(2.0 * sampleRadius / uVoxelWorld, 1.0)), 0.0, uMaxMip);

      vec4 s = giSampleVoxel(origin + dir * (t + ds * 0.5), lod);
      float cov = clamp(s.a * uDensity, 0.0, 0.999);

      if (cov > 1e-4) {
        vec3 rad = s.rgb / max(s.a, 1e-4);
        float lodVoxel = uVoxelWorld * exp2(lod);
        float a = 1.0 - pow(1.0 - cov, max(ds / lodVoxel, 0.0));
        acc.rgb += (1.0 - acc.a) * a * rad;
        acc.a += (1.0 - acc.a) * a;
      }

      t += ds;
    }

    return acc;
  }
`;

// Lectura del volumen de sondas, con el mismo empaquetado que el LightProbeGrid
// nativo de three.js (7 grupos RGBA con padding en Z). Acá sólo se usa L1.
export const SH_GRID = /* glsl */`
  uniform highp sampler3D uSHGrid;
  uniform vec3 uProbeMin;
  uniform vec3 uProbeMax;
  uniform vec3 uProbeRes;

  vec3 giGridIrradiance(vec3 worldPos, vec3 worldNormal) {
    vec3 res = uProbeRes;
    vec3 range = uProbeMax - uProbeMin;
    vec3 resMinusOne = max(res - 1.0, vec3(1.0));
    vec3 spacing = range / resMinusOne;
    vec3 samplePos = worldPos + worldNormal * spacing * 0.5;
    vec3 uvw = clamp((samplePos - uProbeMin) / range, 0.0, 1.0);
    uvw = uvw * resMinusOne / res + 0.5 / res;

    float nz = res.z;
    float padded = nz + 2.0;
    float atlasDepth = 7.0 * padded;
    float zBase = uvw.z * nz + 1.0;

    vec4 s0 = texture(uSHGrid, vec3(uvw.xy, zBase / atlasDepth));
    vec4 s1 = texture(uSHGrid, vec3(uvw.xy, (zBase + padded) / atlasDepth));
    vec4 s2 = texture(uSHGrid, vec3(uvw.xy, (zBase + 2.0 * padded) / atlasDepth));

    vec3 c0 = s0.xyz;
    vec3 c1 = vec3(s0.w, s1.xy);
    vec3 c2 = vec3(s1.zw, s2.x);
    vec3 c3 = s2.yzw;

    vec3 r = c0 * 0.886227
           + c1 * (2.0 * 0.511664 * worldNormal.y)
           + c2 * (2.0 * 0.511664 * worldNormal.z)
           + c3 * (2.0 * 0.511664 * worldNormal.x);

    return max(r, vec3(0.0));
  }
`;

// Decodificación del atlas de cascadas: cada tile es el mapa octaédrico de una sonda.
export const ATLAS = /* glsl */`
  uniform vec3 uProbeGrid;
  uniform float uOct;
  uniform float uTilesX;
  uniform float uTileCount;

  struct GiTexel { vec3 probe; vec2 local; bool valid; };

  GiTexel giDecodeTexel(vec2 fragPx) {
    GiTexel o;
    vec2 tile = floor(fragPx / uOct);
    o.local = fragPx - tile * uOct;
    float idx = tile.y * uTilesX + tile.x;
    o.valid = idx < uTileCount;
    o.probe = vec3(
      mod(idx, uProbeGrid.x),
      mod(floor(idx / uProbeGrid.x), uProbeGrid.y),
      floor(idx / (uProbeGrid.x * uProbeGrid.y))
    );
    return o;
  }
`;

export const QUAD_VERTEX = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
