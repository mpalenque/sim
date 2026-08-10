import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HELPERS, VOXEL, ATLAS, QUAD_VERTEX } from './glsl.js';
import { voxelUniforms, gridUniforms, skyUniforms } from './uniforms.js';
import { make2D, make3D, clearAllLayers } from './targets.js';

// Radiance Cascades en 3D.
//
// Cascada i: la mitad de sondas por eje que la i-1, cuatro veces más direcciones
// y un intervalo de rayo cuatro veces más largo. El coste por nivel se divide a
// la mitad y la resolución angular crece justo donde la distancia lo pide.
//
// Cada cascada vive en un atlas 2D: un tile por sonda, y dentro del tile un mapa
// octaédrico de direcciones. Con ese layout, promediar las 4 direcciones hijas
// del nivel superior es una sola lectura bilineal en el centro del bloque 2x2.

export class Cascades {
  constructor(renderer) {
    this.renderer = renderer;
    this.levels = [];
    this.shRT = null;
    this.probeGrid = new THREE.Vector3();
    this.maxTextureSize = renderer.getContext().getParameter(renderer.getContext().MAX_TEXTURE_SIZE);
    this.#buildPasses();
  }

  build({ probeRes, voxelSize, cascadeCount, octBase, interval0 }) {
    this.disposeLevels();

    this.probeGrid.copy(probeRes);
    this.octBase = octBase;
    const base = interval0 * voxelSize;

    for (let i = 0; i < cascadeCount; i++) {
      const step = Math.pow(2, i);
      const grid = new THREE.Vector3(
        Math.max(2, Math.floor((probeRes.x - 1) / step) + 1),
        Math.max(2, Math.floor((probeRes.y - 1) / step) + 1),
        Math.max(2, Math.floor((probeRes.z - 1) / step) + 1)
      );

      const oct = octBase * Math.pow(2, i);
      const dirs = oct * oct;
      const tileCount = grid.x * grid.y * grid.z;

      let tilesX = Math.max(1, Math.ceil(Math.sqrt(tileCount)));
      while (tilesX * oct > this.maxTextureSize && tilesX > 1) tilesX--;
      const tilesY = Math.ceil(tileCount / tilesX);

      // Intervalos geométricos: cada nivel arranca donde termina el anterior.
      const tStart = base * (Math.pow(4, i) - 1) / 3;
      const tEnd = tStart + base * Math.pow(4, i);

      this.levels.push({
        index: i,
        probeGrid: grid,
        oct,
        tilesX,
        tileCount,
        width: tilesX * oct,
        height: tilesY * oct,
        tStart,
        tEnd,
        coneTan: 2.0 / Math.sqrt(dirs),
        traceRT: make2D(tilesX * oct, tilesY * oct),
        mergedRT: null
      });
    }

    // La cascada más alta no necesita buffer de merge: no hay nivel por encima.
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      level.mergedRT = (i === this.levels.length - 1) ? level.traceRT : make2D(level.width, level.height);
    }

    // Volumen SH con el layout del LightProbeGrid nativo: 7 grupos RGBA,
    // cada uno con una capa de padding arriba y abajo en Z.
    const paddedZ = probeRes.z + 2;
    this.shRT = make3D(this.renderer, probeRes.x, probeRes.y, 7 * paddedZ, false);
    clearAllLayers(this.renderer, this.shRT);
    gridUniforms.uSHGrid.value = this.shRT.texture;

    return this.shRT;
  }

  get rayCount() {
    return this.levels.reduce((sum, l) => sum + l.tileCount * l.oct * l.oct, 0);
  }

  get reach() {
    return this.levels.length ? this.levels[this.levels.length - 1].tEnd : 0;
  }

  update({ traceSteps, giIntensity }) {
    this.#trace(traceSteps);
    this.#merge();
    this.#resolve(giIntensity);
  }

  #trace(steps) {
    const u = this.trace.material.uniforms;
    u.uSteps.value = steps;

    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      u.uProbeGrid.value.copy(level.probeGrid);
      u.uOct.value = level.oct;
      u.uTilesX.value = level.tilesX;
      u.uTileCount.value = level.tileCount;
      u.uTStart.value = level.tStart;
      u.uTEnd.value = level.tEnd;
      u.uConeTan.value = level.coneTan;
      u.uSky.value = (i === this.levels.length - 1) ? 1 : 0;

      this.renderer.setRenderTarget(level.traceRT);
      this.trace.render(this.renderer);
    }
  }

  #merge() {
    const u = this.merge.material.uniforms;

    for (let i = this.levels.length - 2; i >= 0; i--) {
      const level = this.levels[i];
      const upper = this.levels[i + 1];

      u.uNear.value = level.traceRT.texture;
      u.uUpper.value = upper.mergedRT.texture;
      u.uProbeGrid.value.copy(level.probeGrid);
      u.uOct.value = level.oct;
      u.uTilesX.value = level.tilesX;
      u.uTileCount.value = level.tileCount;
      u.uUpperGrid.value.copy(upper.probeGrid);
      u.uUpperOct.value = upper.oct;
      u.uUpperTilesX.value = upper.tilesX;
      u.uUpperAtlas.value.set(upper.width, upper.height);

      this.renderer.setRenderTarget(level.mergedRT);
      this.merge.render(this.renderer);
    }
  }

  #resolve(intensity) {
    const c0 = this.levels[0];
    const u = this.resolve.material.uniforms;
    const padded = this.probeGrid.z + 2;
    // Con 16 direcciones en c0 sólo se proyecta L1; L2 pediría más muestras.
    const groups = this.octBase >= 8 ? 7 : 3;

    u.uC0.value = c0.mergedRT.texture;
    u.uProbeGrid.value.copy(c0.probeGrid);
    u.uOct.value = c0.oct;
    u.uTilesX.value = c0.tilesX;
    u.uPadded.value = padded;
    u.uIntensity.value = intensity;
    u.uL2.value = groups === 7 ? 1 : 0;

    for (let slice = 0; slice < groups * padded; slice++) {
      u.uSlice.value = slice;
      this.renderer.setRenderTarget(this.shRT, slice);
      this.resolve.render(this.renderer);
    }
  }

  disposeLevels() {
    for (const level of this.levels) {
      level.traceRT?.dispose();
      if (level.mergedRT && level.mergedRT !== level.traceRT) level.mergedRT.dispose();
    }
    this.levels = [];
    this.shRT?.dispose();
    this.shRT = null;
  }

  dispose() {
    this.disposeLevels();
    this.trace?.dispose();
    this.merge?.dispose();
    this.resolve?.dispose();
  }

  #buildPasses() {
    this.trace = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: Object.assign({
        uProbeGrid: { value: new THREE.Vector3() },
        uOct: { value: 4 },
        uTilesX: { value: 1 },
        uTileCount: { value: 1 },
        uTStart: { value: 0 },
        uTEnd: { value: 1 },
        uConeTan: { value: 0.5 },
        uSteps: { value: 24 },
        uSky: { value: 0 }
      }, voxelUniforms, gridUniforms, skyUniforms),
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */`
        ${HELPERS}
        ${VOXEL}
        ${ATLAS}
        uniform vec3 uProbeMin;
        uniform vec3 uProbeMax;
        uniform float uTStart;
        uniform float uTEnd;
        uniform float uConeTan;
        uniform int uSteps;
        uniform float uSky;
        uniform vec3 uSkyColor;

        void main() {
          GiTexel texel = giDecodeTexel(floor(gl_FragCoord.xy));
          if (!texel.valid) { gl_FragColor = vec4(0.0); return; }

          vec3 spacing = (uProbeMax - uProbeMin) / max(uProbeGrid - 1.0, vec3(1.0));
          vec3 origin = uProbeMin + texel.probe * spacing;

          vec2 f = (texel.local + 0.5) / uOct * 2.0 - 1.0;
          vec3 dir = giOctDecode(f);

          vec4 r = giTraceCone(origin, dir, uTStart, uTEnd, uConeTan, 0.0, uSteps);
          if (uSky > 0.5) r.rgb += (1.0 - r.a) * uSkyColor;

          gl_FragColor = r;
        }
      `,
      depthTest: false,
      depthWrite: false
    }));

    this.merge = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        uNear: { value: null },
        uUpper: { value: null },
        uProbeGrid: { value: new THREE.Vector3() },
        uOct: { value: 4 },
        uTilesX: { value: 1 },
        uTileCount: { value: 1 },
        uUpperGrid: { value: new THREE.Vector3() },
        uUpperOct: { value: 8 },
        uUpperTilesX: { value: 1 },
        uUpperAtlas: { value: new THREE.Vector2(1, 1) }
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */`
        ${HELPERS}
        ${ATLAS}
        uniform sampler2D uNear;
        uniform sampler2D uUpper;
        uniform vec3 uUpperGrid;
        uniform float uUpperOct;
        uniform float uUpperTilesX;
        uniform vec2 uUpperAtlas;

        vec4 upperFetch(vec3 probe, vec2 localPixel) {
          float idx = probe.x + uUpperGrid.x * (probe.y + uUpperGrid.y * probe.z);
          vec2 tile = vec2(mod(idx, uUpperTilesX), floor(idx / uUpperTilesX));
          return texture2D(uUpper, (tile * uUpperOct + localPixel) / uUpperAtlas);
        }

        void main() {
          vec2 px = floor(gl_FragCoord.xy);
          GiTexel texel = giDecodeTexel(px);
          if (!texel.valid) { gl_FragColor = vec4(0.0); return; }

          vec4 near = texelFetch(uNear, ivec2(px), 0);

          // Centro del bloque 2x2 de la cascada superior: una lectura bilineal
          // promedia exactamente las 4 direcciones hijas.
          vec2 upperLocal = texel.local * 2.0 + 1.0;

          // Las grillas están anidadas sobre el mismo volumen.
          vec3 ratio = (uUpperGrid - 1.0) / max(uProbeGrid - 1.0, vec3(1.0));
          vec3 g = texel.probe * ratio;
          vec3 g0 = floor(g);
          vec3 fr = g - g0;

          vec3 farRGB = vec3(0.0);
          float farA = 0.0;

          for (int i = 0; i < 8; i++) {
            vec3 off = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
            vec3 neighbour = clamp(g0 + off, vec3(0.0), uUpperGrid - 1.0);
            vec3 wv = mix(1.0 - fr, fr, off);
            float w = wv.x * wv.y * wv.z;
            if (w <= 0.0) continue;
            vec4 s = upperFetch(neighbour, upperLocal);
            farRGB += s.rgb * w;
            farA += s.a * w;
          }

          gl_FragColor = vec4(near.rgb + (1.0 - near.a) * farRGB,
                              near.a + (1.0 - near.a) * farA);
        }
      `,
      depthTest: false,
      depthWrite: false
    }));

    this.resolve = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        uC0: { value: null },
        uProbeGrid: { value: new THREE.Vector3() },
        uOct: { value: 4 },
        uTilesX: { value: 1 },
        uSlice: { value: 0 },
        uPadded: { value: 3 },
        uIntensity: { value: 1 },
        uL2: { value: 0 }
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */`
        ${HELPERS}
        uniform sampler2D uC0;
        uniform vec3 uProbeGrid;
        uniform float uOct;
        uniform float uTilesX;
        uniform float uSlice;
        uniform float uPadded;
        uniform float uIntensity;
        uniform float uL2;

        void main() {
          vec2 pxy = floor(gl_FragCoord.xy);
          float group = floor(uSlice / uPadded);
          float zi = uSlice - group * uPadded - 1.0;
          float pz = clamp(zi, 0.0, uProbeGrid.z - 1.0);

          float idx = pxy.x + uProbeGrid.x * (pxy.y + uProbeGrid.y * pz);
          vec2 tile = vec2(mod(idx, uTilesX), floor(idx / uTilesX));
          ivec2 base = ivec2(tile * uOct);

          int n = int(uOct);
          float sa = 4.0 * GI_PI / (uOct * uOct);

          vec3 c0 = vec3(0.0), c1 = vec3(0.0), c2 = vec3(0.0), c3 = vec3(0.0);
          vec3 c4 = vec3(0.0), c5 = vec3(0.0), c6 = vec3(0.0), c7 = vec3(0.0), c8 = vec3(0.0);

          for (int y = 0; y < n; y++) {
            for (int x = 0; x < n; x++) {
              vec2 f = (vec2(float(x), float(y)) + 0.5) / uOct * 2.0 - 1.0;
              vec3 d = giOctDecode(f);
              vec3 L = texelFetch(uC0, base + ivec2(x, y), 0).rgb * sa;

              c0 += L * 0.282095;
              c1 += L * (0.488603 * d.y);
              c2 += L * (0.488603 * d.z);
              c3 += L * (0.488603 * d.x);

              if (uL2 > 0.5) {
                c4 += L * (1.092548 * d.x * d.y);
                c5 += L * (1.092548 * d.y * d.z);
                c6 += L * (0.315392 * (3.0 * d.z * d.z - 1.0));
                c7 += L * (1.092548 * d.x * d.z);
                c8 += L * (0.546274 * (d.x * d.x - d.y * d.y));
              }
            }
          }

          c0 *= uIntensity; c1 *= uIntensity; c2 *= uIntensity; c3 *= uIntensity;
          c4 *= uIntensity; c5 *= uIntensity; c6 *= uIntensity; c7 *= uIntensity; c8 *= uIntensity;

          vec4 outv;
          if (group < 0.5)      outv = vec4(c0, c1.r);
          else if (group < 1.5) outv = vec4(c1.g, c1.b, c2.r, c2.g);
          else if (group < 2.5) outv = vec4(c2.b, c3);
          else if (group < 3.5) outv = vec4(c4, c5.r);
          else if (group < 4.5) outv = vec4(c5.g, c5.b, c6.r, c6.g);
          else if (group < 5.5) outv = vec4(c6.b, c7);
          else                  outv = vec4(c8, 0.0);

          gl_FragColor = outv;
        }
      `,
      depthTest: false,
      depthWrite: false
    }));
  }
}
