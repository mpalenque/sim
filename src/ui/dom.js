// Acceso al chrome de la página: estado, loader y panel de métricas.

const statusEl = document.querySelector('#status');
const statusTextEl = document.querySelector('#status-text');
const loadingEl = document.querySelector('#loading');
const loaderTitleEl = document.querySelector('#loader-title');
const loaderSubEl = document.querySelector('#loader-sub');
const statsEl = document.querySelector('#stats');

export const videoInput = document.querySelector('#video-input');
export const captureButton = document.querySelector('#capture-button');
export const viewport = document.querySelector('#viewport');

export function setStatus(message, state = '') {
  statusEl.className = `status ${state}`.trim();
  statusTextEl.textContent = message;
}

export function setLoader(title, subtitle) {
  loaderTitleEl.textContent = title;
  if (subtitle !== undefined) loaderSubEl.textContent = subtitle;
}

export function showLoader(visible) {
  loadingEl.classList.toggle('hidden', !visible);
}

export function setStats(text) {
  statsEl.textContent = text;
}

// Cede el hilo para que el navegador pinte el loader antes de arrancar un
// trabajo pesado y sincrónico.
//
// requestAnimationFrame no dispara si la pestaña está oculta o no está
// componiendo, así que siempre va con un temporizador de respaldo: sin él, la
// carga se cuelga para siempre en una pestaña en segundo plano.
export function nextFrame(fallbackMs = 120) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, fallbackMs);
  });
}
