const storageKey = 'torneo-actual';

export const state = {
  teams: [],
  teamNames: new Map(),
  tournamentId: readStoredTournament(),
  currentTournament: null,
};

function readStoredTournament() {
  try { return localStorage.getItem(storageKey); } catch { return null; }
}

export function setTournament(tournamentId) {
  state.tournamentId = tournamentId;
  try {
    if (tournamentId) localStorage.setItem(storageKey, tournamentId);
    else localStorage.removeItem(storageKey);
  } catch {
    // Sin almacenamiento disponible, simplemente no se recuerda el torneo.
  }
}

export function setTeams(teams) {
  state.teams = [...teams].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  state.teamNames = new Map(teams.map((t) => [t.id, t.name]));
}

// Un equipo borrado sigue apareciendo en grupos y partidos con su id, así que no siempre hay nombre.
export function teamName(teamId) {
  if (!teamId) return 'Por definir';
  return state.teamNames.get(teamId) ?? `Equipo eliminado (${teamId.slice(0, 6)})`;
}

const smallWords = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);

function initialsOf(name) {
  const words = name.split(/\s+/).filter((w) => w && !smallWords.has(w.toLowerCase()));
  const letters = (words.length > 1 ? [words[0], words[1]] : [name]).map((w) => w[0]).join('');
  return letters.toUpperCase().slice(0, 2);
}

// El color sale del id para que un equipo conserve el mismo color aunque lo renombren.
function hueOf(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 12) * 30;
}

export function teamBadge(teamId, size = 'small') {
  if (!teamId) return h('span', { class: `badge badge-${size} badge-empty`, 'aria-hidden': 'true' });
  const name = state.teamNames.get(teamId);
  return h('span', { class: `badge badge-${size}${name ? '' : ' badge-empty'}`, style: `--hue: ${hueOf(teamId)}`, 'aria-hidden': 'true' },
    name ? initialsOf(name) : '');
}

export function isKnownTeam(teamId) {
  return state.teamNames.has(teamId);
}

// Se arma el DOM sin innerHTML para que un nombre de equipo nunca se interprete como HTML.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  const item = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(item);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(() => item.remove(), kind === 'error' ? 7000 : 3500);
}

export async function withBusy(button, task, busyText) {
  if (button.disabled) return undefined;
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (busyText) button.textContent = busyText;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (busyText) button.textContent = original;
  }
}

export function reportError(error) {
  toast(error?.message ?? 'Ocurrió un error inesperado.', 'error');
}

export function go(section) {
  if (location.hash !== `#${section}`) location.hash = section;
}
