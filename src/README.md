# Radiance Cascades GI — estructura

Esta es la versión activa de la sim. GitHub Pages la sirve desde `../index.html`;
`../index-rc.html` se conserva como copia de la misma entrada.

## Qué hace

La escena se ilumina **sólo con sus materiales emisivos**. La PANTALLA emite luz
real: rebota sobre el set (difusa) y se refleja en los materiales pulidos
(especular). No hay luces de estudio encendidas por defecto.

## Pipeline, por actualización de GI

```
nube de puntos ──inyección──► volumen de voxels (RGBA16F 3D, con mips)
                                      │
                                      ├─ trazado de conos ─► cascadas 0..N (atlas 2D)
                                      │                            │
                                      │                         merge ▼ (de arriba hacia abajo)
                                      │                       cascada 0 ─► proyección SH
                                      │                                        │
                                      │                                   LightProbeGrid
                                      │                                        │
                                      │                              three.js lo aplica solo
                                      │                              a la difusa indirecta
                                      │
                                      └─ cone tracing por píxel ─► especular indirecta
```

## Archivos

| Archivo | Rol |
| --- | --- |
| `main.js` | Arranque, bucle de render, cableado entre módulos |
| `params.js` | Toda la configuración en un objeto |
| `style.css` | Estilos de la UI |
| `core/viewer.js` | Renderer, cámara, controles, composer, luces directas |
| `core/stage.js` | Carga del GLB, detección de PANTALLA, encuadre |
| `core/screen-source.js` | Video o captura de pestaña → textura emisiva de la PANTALLA, con encuadre |
| `ui/dom.js` | Estado, loader y panel de métricas |
| `ui/gui.js` | Panel lil-gui |
| `gi/index.js` | Orquesta el pipeline y publica el LightProbeGrid |
| `gi/glsl.js` | Fragmentos GLSL compartidos (cone tracing, octaédrico, SH) |
| `gi/uniforms.js` | Uniforms compartidos entre pasadas y materiales |
| `gi/targets.js` | Render targets 2D/3D, limpieza por capa, mips |
| `gi/pointcloud.js` | Muestreo de la malla → puntos de superficie |
| `gi/voxelizer.js` | Inyección de radiancia en el volumen |
| `gi/cascades.js` | Radiance Cascades: trazado, merge y proyección a SH |
| `gi/materials.js` | Parche de especular indirecta (voxel-GI + espejo planar) en los materiales |
| `gi/planar-mirror.js` | Espejo planar: cámara reflejada + clip de plano oblicuo |
| `gi/debug.js` | Vistas de inspección (voxels, ocupación, sondas) |

## Detalles que importan

- **Sondas 2^k+1 por eje**: cada cascada muestrea una de cada dos sondas de la
  anterior, así las grillas quedan anidadas sobre el mismo volumen.
- **Atlas octaédrico**: promediar las 4 direcciones hijas del nivel superior es
  una sola lectura bilineal en el centro del bloque 2×2.
- **Difusa sin parchear shaders**: three.js r185 acepta cualquier objeto con
  `isLightProbeGrid` y aplica su volumen SH a todos los materiales con luces.
- **Inyección por capas**: la nube de puntos se ordena por capa Z del volumen,
  así una sola nube alimenta las N capas con un `setDrawRange` por capa.
- **Reflejos**: el cono se ensancha con la distancia (`minTan`) para llegar al
  fondo de la escena con el presupuesto de pasos configurado.
- **Encuadre de PANTALLA**: el ajuste (cover/stretch, zoom, offset, flip) vive
  en la matriz de la textura (`texture.matrix`). El material visible la usa
  automáticamente; la inyección de GI la replica a mano (`uScreenUV`) para que
  la luz coincida exactamente con lo que se ve.
- **Página web en la PANTALLA**: no hay forma de volcar un `<iframe>` a una
  textura WebGL (aislamiento de origen cruzado). `getDisplayMedia` sí funciona:
  el usuario elige una pestaña/ventana y su contenido llega como `MediaStream`,
  con el mismo pipeline que un archivo de video.
- **Espejo planar (`base.001`)**: el cono trazado sobre el voxel-GI es borroso
  (limitado por la resolución del volumen y el presupuesto de pasos) — no
  alcanza para un reflejo nítido de la PANTALLA. Para ese material específico
  se agrega un espejo planar clásico (la técnica de `Reflector.js` de three.js:
  cámara reflejada + clip de plano oblicuo de Terathon), que renderiza la
  escena una vez más por frame desde el punto de vista reflejado. Sólo es
  geométricamente correcto cerca de un plano real, así que en el shader se
  mezcla con el voxel-GI según `dot(normal, uMirrorNormal)` y la distancia al
  plano (`uMirrorFade`): domina en la tapa plana, se apaga en las partes
  curvas (costados, patas). La captura se hace con `NoToneMapping` y color
  space lineal — si no, quedaría tonemapeada dos veces (una al capturarla, otra
  al componer el frame final) y se vería quemada/con el gamma mal.
  Altura del plano y alcance ajustables en vivo desde *Espejo (base.001)*.

## Consola

`window.SIM` expone `{ params, gi, viewer, stage, rebuildGI }` para inspeccionar
o forzar una reconstrucción a mano.
