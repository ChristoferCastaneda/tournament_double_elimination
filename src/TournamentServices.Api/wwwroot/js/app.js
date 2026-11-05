import { api } from './api.js';
import { renderTeams } from './teams.js';
import { renderTournament } from './tournament.js';
import { renderBracket } from './bracket-view.js';
import { reportError } from './ui.js';
import { createFighter } from './fighter.js';

const sections = {
  equipos: renderTeams,
  torneo: renderTournament,
  bracket: renderBracket,
};
const defaultSection = 'equipos';

function currentSection() {
  const name = location.hash.replace('#', '');
  return name in sections ? name : defaultSection;
}

async function show() {
  const name = currentSection();
  for (const key of Object.keys(sections)) {
    document.getElementById(`section-${key}`).hidden = key !== name;
  }
  for (const link of document.querySelectorAll('.steps a')) {
    if (link.dataset.section === name) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  }
  try {
    await sections[name](document.getElementById(`section-${name}`));
  } catch (error) {
    reportError(error);
  }
}

async function checkHealth() {
  const status = document.getElementById('api-status');
  try {
    await api.health();
    status.dataset.state = 'ok';
    status.textContent = 'API conectada';
  } catch {
    status.dataset.state = 'down';
    status.textContent = 'Sin conexión con la API';
  }
}

// Abierta como archivo (file://) no cargan los módulos ni las rutas relativas, por eso solo se avisa.
if (location.protocol === 'file:') {
  document.getElementById('file-warning').hidden = false;
} else {
  document.getElementById('hero-fighter').append(createFighter());
  window.addEventListener('hashchange', show);
  checkHealth();
  show();
}
