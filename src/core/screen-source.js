import * as THREE from 'three';
import { params } from '../params.js';

// Fuente de imagen de la PANTALLA: un archivo de video o la captura en vivo de
// una pestaña/ventana. En ambos casos termina en la misma VideoTexture, que
// alimenta a la vez el material emisivo y la inyección de radiancia: lo que se
// ve en la pantalla es exactamente lo que ilumina la escena.
//
// Una página web no se puede volcar a una textura desde un <iframe> (lo impide
// el aislamiento de origen cruzado). getDisplayMedia es la vía que sí funciona
// dentro del navegador: el usuario elige la pestaña y llega como MediaStream.

let element = null;
let texture = null;
let stream = null;
let label = '';

export function getScreenTexture() {
  return texture;
}

export function getScreenLabel() {
  return label;
}

export function isScreenMuted() {
  return element?.muted ?? true;
}

export function toggleScreenMute() {
  if (!element) return null;
  element.muted = !element.muted;
  return element.muted;
}

export async function loadVideoFile(file, screen, canvas) {
  requireScreen(screen);
  disposeCurrent();

  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.loop = true;
  video.muted = false;
  video.playsInline = true;
  video.preload = 'auto';

  element = video;
  label = file.name;
  attachTo(screen);
  video.addEventListener('loadedmetadata', () => applyScreenTransform(screen), { once: true });

  return play(video, canvas);
}

export async function startDisplayCapture(screen, canvas, onEnded) {
  requireScreen(screen);

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Este navegador no permite capturar pantalla');
  }

  // El selector va antes de descartar la fuente actual: si se cancela, lo que
  // estaba sonando en la pantalla sigue intacto.
  const captured = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60 },
    audio: false
  });

  disposeCurrent();
  stream = captured;

  const video = document.createElement('video');
  video.srcObject = captured;
  video.muted = true;
  video.playsInline = true;

  element = video;
  label = 'captura en vivo';
  attachTo(screen);
  video.addEventListener('loadedmetadata', () => applyScreenTransform(screen), { once: true });
  captured.getVideoTracks()[0].addEventListener('ended', () => onEnded?.());

  return play(video, canvas);
}

// Encuadre del video sobre la pantalla: corrige la orientación, la deformación
// por relación de aspecto y deja escala/desplazamiento manual encima.
export function applyScreenTransform(screen) {
  if (!texture || !screen) return;

  const videoAspect = (element?.videoWidth && element?.videoHeight)
    ? element.videoWidth / element.videoHeight
    : 16 / 9;
  const screenAspect = screen.width / screen.height;

  // "cover": muestrea una subregión del video para que su relación de aspecto
  // coincida con la de la pantalla. Llena todo sin deformar, recortando.
  let fitX = 1;
  let fitY = 1;
  if (params.screenFit === 'cover') {
    const ratio = screenAspect / videoAspect;
    fitX = Math.min(1, ratio);
    fitY = Math.min(1, 1 / ratio);
  }

  const scaleX = Math.max(params.screenScaleX, 0.01);
  const scaleY = Math.max(params.screenScaleY, 0.01);

  texture.center.set(0.5, 0.5);
  texture.repeat.set(
    fitX / scaleX,
    (params.screenFlipV ? -1 : 1) * fitY / scaleY
  );
  texture.offset.set(params.screenOffsetX, params.screenOffsetY);
  texture.updateMatrix();
}

export function getVideoAspect() {
  if (element?.videoWidth && element?.videoHeight) {
    return element.videoWidth / element.videoHeight;
  }
  return null;
}

export function pauseScreen() {
  element?.pause();
}

function requireScreen(screen) {
  if (!screen) throw new Error('El GLB no contiene una mesh PANTALLA');
}

function attachTo(screen) {
  texture = new THREE.VideoTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  // Los GLB traen sus texturas con la convención glTF (flipY = false), pero
  // VideoTexture arranca en true: por eso el video entraba dado vuelta.
  texture.flipY = false;

  const material = screen.material;
  material.map = texture;
  material.emissiveMap = texture;
  material.color.set(0xffffff);
  material.emissive.set(0xffffff);
  material.emissiveIntensity = params.screenEmissive;
  material.needsUpdate = true;

  applyScreenTransform(screen);
}

async function play(video, canvas) {
  try {
    await video.play();
    return { playing: true, label };
  } catch {
    // Autoplay bloqueado: arranca con la primera interacción sobre la escena.
    canvas.addEventListener('pointerdown', () => video.play().catch(() => {}), { once: true });
    return { playing: false, label };
  }
}

function disposeCurrent() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (element) {
    element.pause();
    if (element.src) URL.revokeObjectURL(element.src);
    element.srcObject = null;
    element = null;
  }
  texture?.dispose();
  texture = null;
}
