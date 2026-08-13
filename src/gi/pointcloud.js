import * as THREE from 'three';

// Convierte la malla del GLB en una nube de puntos de superficie, ordenada por
// capa Z del volumen. Cada punto lleva su albedo/emisivo horneado y el área que
// representa, para poder inyectarlo como radiancia con cobertura correcta.

const textureAverageCache = new WeakMap();

export function buildPointCloud({ root, screenMesh, volumeBox, voxelDims, voxelSize, pointDensity, maxPoints }) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position && isVisibleInHierarchy(o)) meshes.push(o);
  });

  const voxelArea = voxelSize * voxelSize;
  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

  let totalArea = 0;
  forEachTriangle(meshes, matrix, a, b, c, () => {
    ab.subVectors(b, a); ac.subVectors(c, a);
    totalArea += cross.crossVectors(ab, ac).length() * 0.5;
  });

  const wanted = pointDensity / voxelArea;
  const density = Math.min(wanted, maxPoints / Math.max(totalArea, 1e-6));
  const cap = maxPoints;

  const posArr = new Float32Array(cap * 3);
  const nrmArr = new Float32Array(cap * 3);
  const uvArr = new Float32Array(cap * 2);
  const albArr = new Uint8Array(cap * 4);
  const emiArr = new Uint8Array(cap * 4);
  const escArr = new Float32Array(cap);
  const areaArr = new Float32Array(cap);

  // Secuencia R2 de baja discrepancia: reparte las muestras dentro del triángulo
  // sin agrupamientos y de forma determinista entre reconstrucciones.
  const GOLDEN = 1.32471795724474602596;
  const A1 = 1 / GOLDEN;
  const A2 = 1 / (GOLDEN * GOLDEN);

  const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const ta = new THREE.Vector2(), tb = new THREE.Vector2(), tc = new THREE.Vector2();
  const materialCache = new Map();
  let count = 0;

  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    matrix.copy(mesh.matrixWorld);
    normalMatrix.getNormalMatrix(matrix);

    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    const index = geometry.index;
    const triCount = index ? index.count / 3 : position.count / 3;
    const isScreen = mesh === screenMesh;

    const groups = geometry.groups.length ? geometry.groups : null;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (let t = 0; t < triCount; t++) {
      if (count >= cap) break;

      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

      a.fromBufferAttribute(position, i0).applyMatrix4(matrix);
      b.fromBufferAttribute(position, i1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, i2).applyMatrix4(matrix);

      ab.subVectors(b, a); ac.subVectors(c, a);
      const area = cross.crossVectors(ab, ac).length() * 0.5;
      if (area <= 1e-9) continue;

      if (normal) {
        na.fromBufferAttribute(normal, i0).applyMatrix3(normalMatrix).normalize();
        nb.fromBufferAttribute(normal, i1).applyMatrix3(normalMatrix).normalize();
        nc.fromBufferAttribute(normal, i2).applyMatrix3(normalMatrix).normalize();
      } else {
        na.copy(cross).normalize(); nb.copy(na); nc.copy(na);
      }

      if (uv) {
        ta.fromBufferAttribute(uv, i0);
        tb.fromBufferAttribute(uv, i1);
        tc.fromBufferAttribute(uv, i2);
      } else {
        ta.set(0, 0); tb.set(0, 0); tc.set(0, 0);
      }

      const material = materials.length === 1
        ? materials[0]
        : materials[groupIndexFor(groups, t * 3, materials.length)];
      const baked = bakeMaterial(material, materialCache);

      const n = Math.max(1, Math.round(area * density));
      const pointArea = area / n;

      for (let k = 0; k < n && count < cap; k++) {
        let u = (0.5 + A1 * (k + 1)) % 1;
        let v = (0.5 + A2 * (k + 1)) % 1;
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;

        const o3 = count * 3;
        posArr[o3] = a.x * w + b.x * u + c.x * v;
        posArr[o3 + 1] = a.y * w + b.y * u + c.y * v;
        posArr[o3 + 2] = a.z * w + b.z * u + c.z * v;

        const nx = na.x * w + nb.x * u + nc.x * v;
        const ny = na.y * w + nb.y * u + nc.y * v;
        const nz = na.z * w + nb.z * u + nc.z * v;
        const len = Math.hypot(nx, ny, nz) || 1;
        nrmArr[o3] = nx / len;
        nrmArr[o3 + 1] = ny / len;
        nrmArr[o3 + 2] = nz / len;

        const o2 = count * 2;
        uvArr[o2] = ta.x * w + tb.x * u + tc.x * v;
        uvArr[o2 + 1] = ta.y * w + tb.y * u + tc.y * v;

        const o4 = count * 4;
        albArr[o4] = baked.albedo[0];
        albArr[o4 + 1] = baked.albedo[1];
        albArr[o4 + 2] = baked.albedo[2];
        albArr[o4 + 3] = isScreen ? 255 : 0;

        emiArr[o4] = baked.emissive[0];
        emiArr[o4 + 1] = baked.emissive[1];
        emiArr[o4 + 2] = baked.emissive[2];
        emiArr[o4 + 3] = 255;

        escArr[count] = baked.emissiveScale;
        areaArr[count] = pointArea;
        count++;
      }
    }
  }

  return sortByLayer({ count, posArr, nrmArr, uvArr, albArr, emiArr, escArr, areaArr, volumeBox, voxelDims });
}

function isVisibleInHierarchy(object) {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

// Orden por capa Z + rangos: cada capa del volumen se dibuja con un setDrawRange,
// así una sola nube de puntos alimenta las N capas sin repetir vértices.
function sortByLayer({ count, posArr, nrmArr, uvArr, albArr, emiArr, escArr, areaArr, volumeBox, voxelDims }) {
  const nz = voxelDims.z;
  const volMin = volumeBox.min;
  const volSize = new THREE.Vector3().subVectors(volumeBox.max, volMin);

  const layerOf = new Int32Array(count);
  const layerCount = new Int32Array(nz);

  for (let i = 0; i < count; i++) {
    const z = Math.floor(((posArr[i * 3 + 2] - volMin.z) / volSize.z) * nz);
    const layer = THREE.MathUtils.clamp(z, 0, nz - 1);
    layerOf[i] = layer;
    layerCount[layer]++;
  }

  const layerStart = new Int32Array(nz);
  let running = 0;
  for (let z = 0; z < nz; z++) { layerStart[z] = running; running += layerCount[z]; }

  const cursor = layerStart.slice();
  const sPos = new Float32Array(count * 3);
  const sNrm = new Float32Array(count * 3);
  const sUv = new Float32Array(count * 2);
  const sAlb = new Uint8Array(count * 4);
  const sEmi = new Uint8Array(count * 4);
  const sEsc = new Float32Array(count);
  const sArea = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const d = cursor[layerOf[i]]++;
    sPos[d * 3] = posArr[i * 3]; sPos[d * 3 + 1] = posArr[i * 3 + 1]; sPos[d * 3 + 2] = posArr[i * 3 + 2];
    sNrm[d * 3] = nrmArr[i * 3]; sNrm[d * 3 + 1] = nrmArr[i * 3 + 1]; sNrm[d * 3 + 2] = nrmArr[i * 3 + 2];
    sUv[d * 2] = uvArr[i * 2]; sUv[d * 2 + 1] = uvArr[i * 2 + 1];
    sAlb[d * 4] = albArr[i * 4]; sAlb[d * 4 + 1] = albArr[i * 4 + 1];
    sAlb[d * 4 + 2] = albArr[i * 4 + 2]; sAlb[d * 4 + 3] = albArr[i * 4 + 3];
    sEmi[d * 4] = emiArr[i * 4]; sEmi[d * 4 + 1] = emiArr[i * 4 + 1];
    sEmi[d * 4 + 2] = emiArr[i * 4 + 2]; sEmi[d * 4 + 3] = emiArr[i * 4 + 3];
    sEsc[d] = escArr[i];
    sArea[d] = areaArr[i];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(sNrm, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(sUv, 2));
  geometry.setAttribute('aAlbedo', new THREE.BufferAttribute(sAlb, 4, true));
  geometry.setAttribute('aEmissive', new THREE.BufferAttribute(sEmi, 4, true));
  geometry.setAttribute('aEmissiveScale', new THREE.BufferAttribute(sEsc, 1));
  geometry.setAttribute('aArea', new THREE.BufferAttribute(sArea, 1));

  return { geometry, layerStart, layerCount, count };
}

function groupIndexFor(groups, startIndex, materialCount) {
  if (!groups) return 0;
  for (const g of groups) {
    if (startIndex >= g.start && startIndex < g.start + g.count) {
      return Math.min(g.materialIndex ?? 0, materialCount - 1);
    }
  }
  return 0;
}

// Albedo/emisivo por material. Cuando hay textura se usa su color promedio: la
// GI es de baja frecuencia y no necesita el detalle, salvo en la PANTALLA, que
// se muestrea por punto en el shader de inyección.
function bakeMaterial(material, cache) {
  if (!material) return { albedo: [200, 200, 200], emissive: [0, 0, 0], emissiveScale: 0 };
  if (cache.has(material)) return cache.get(material);

  const albedo = new THREE.Color(1, 1, 1);
  if (material.color) albedo.copy(material.color);
  const mapAvg = averageTextureColor(material.map);
  if (mapAvg) albedo.multiply(mapAvg);

  // Los metales casi no aportan difusa: bajamos su albedo para no inflar el rebote.
  if (typeof material.metalness === 'number') {
    albedo.multiplyScalar(1 - 0.85 * THREE.MathUtils.clamp(material.metalness, 0, 1));
  }

  const emissive = new THREE.Color(0, 0, 0);
  if (material.emissive) emissive.copy(material.emissive);
  const emissiveAvg = averageTextureColor(material.emissiveMap);
  if (emissiveAvg) emissive.multiply(emissiveAvg);

  const baked = {
    albedo: encodeColor(albedo),
    emissive: encodeColor(emissive),
    emissiveScale: material.emissiveIntensity ?? 1
  };
  cache.set(material, baked);
  return baked;
}

// sqrt para ganar precisión en los tonos oscuros al guardar en 8 bits.
function encodeColor(color) {
  return [
    Math.round(Math.sqrt(THREE.MathUtils.clamp(color.r, 0, 1)) * 255),
    Math.round(Math.sqrt(THREE.MathUtils.clamp(color.g, 0, 1)) * 255),
    Math.round(Math.sqrt(THREE.MathUtils.clamp(color.b, 0, 1)) * 255)
  ];
}

function averageTextureColor(texture) {
  if (!texture || !texture.image) return null;
  if (textureAverageCache.has(texture)) return textureAverageCache.get(texture);

  let result = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(texture.image, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = data.length / 4;
    result = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    result = null;
  }

  textureAverageCache.set(texture, result);
  return result;
}

function forEachTriangle(meshes, matrix, a, b, c, callback) {
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    matrix.copy(mesh.matrixWorld);
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const triCount = index ? index.count / 3 : position.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(position, i0).applyMatrix4(matrix);
      b.fromBufferAttribute(position, i1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, i2).applyMatrix4(matrix);
      callback();
    }
  }
}
