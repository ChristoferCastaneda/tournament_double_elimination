import { api, ApiError } from './api.js';
import { state, setTeams, teamBadge, h, toast, withBusy, reportError } from './ui.js';

const sampleNames = [
  'Halcones de Bruma', 'Linces del Valle', 'Coyotes de Arena', 'Mantarrayas Azules',
  'Búhos de Cantera', 'Zorros del Puerto', 'Venados de Niebla', 'Pumas de Ceniza',
  'Garzas del Delta', 'Toros de Basalto', 'Cuervos del Faro', 'Jaguares de Lluvia',
  'Delfines de Coral', 'Águilas de Granito', 'Tejones del Bosque', 'Nutrias del Río',
  'Osos de Pino', 'Gavilanes del Cañón', 'Lobos de Escarcha', 'Iguanas del Sol',
  'Tortugas de Jade', 'Correcaminos Rojos', 'Ballenas del Norte', 'Ocelotes de Musgo',
  'Colibríes de Cobre', 'Bisontes de la Meseta', 'Pelícanos de Sal', 'Armadillos de Barro',
  'Tlacuaches Nocturnos', 'Cóndores de Viento', 'Ajolotes del Lago', 'Quetzales de Bruma',
];

export async function loadTeams() {
  setTeams(await api.getTeams());
  return state.teams;
}

function* candidateNames(existingLower) {
  for (const name of sampleNames) {
    if (!existingLower.has(name.toLowerCase())) yield name;
  }
  for (let n = 1; ; n++) {
    const name = `Equipo ${n}`;
    if (!existingLower.has(name.toLowerCase())) yield name;
  }
}

async function generateTeams(count, onProgress) {
  const existing = new Set(state.teams.map((t) => t.name.toLowerCase()));
  const names = candidateNames(existing);
  let created = 0;
  let attempts = 0;

  // Se crean en secuencia y no en paralelo para no chocar con el índice único de nombre.
  while (created < count && attempts < count * 3) {
    attempts++;
    const name = names.next().value;
    existing.add(name.toLowerCase());
    try {
      await api.createTeam(name);
      created++;
      onProgress(created, count);
    } catch (error) {
      // Un 400 aquí es un nombre que alguien más acaba de crear: probar el siguiente.
      if (!(error instanceof ApiError) || error.status !== 400) throw error;
    }
  }
  return created;
}

export async function renderTeams(root) {
  root.replaceChildren(h('p', { class: 'loading' }, 'Cargando equipos…'));
  try {
    await loadTeams();
  } catch (error) {
    root.replaceChildren(h('p', { class: 'empty' }, error.message));
    return;
  }

  const rerender = () => renderTeams(root);

  const nameInput = h('input', { id: 'team-name', name: 'name', required: true, maxlength: '80', autocomplete: 'off', placeholder: 'Nombre del equipo' });
  const createForm = h('form', { class: 'inline-form', onsubmit: async (event) => {
    event.preventDefault();
    const button = event.submitter ?? createForm.querySelector('button');
    await withBusy(button, async () => {
      try {
        await api.createTeam(nameInput.value.trim());
        toast('Equipo creado.', 'success');
        await rerender();
      } catch (error) { reportError(error); }
    });
  } },
    h('label', { for: 'team-name', class: 'visually-hidden' }, 'Nombre del equipo'),
    nameInput,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Crear equipo'),
  );

  const countSelect = h('select', { id: 'sample-count', 'aria-label': 'Cuántos equipos generar' },
    [8, 16, 32].map((n) => h('option', { value: String(n), selected: n === 32 }, `${n} equipos`)));
  const progress = h('span', { class: 'progress', 'aria-live': 'polite' });
  const generateButton = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const count = Number(countSelect.value);
    await withBusy(generateButton, async () => {
      try {
        const created = await generateTeams(count, (done, total) => { progress.textContent = `${done} de ${total}`; });
        toast(`Se crearon ${created} equipos de ejemplo.`, 'success');
        await rerender();
      } catch (error) {
        reportError(error);
        await rerender();
      }
    }, 'Generando…');
  } }, 'Generar equipos de ejemplo');

  const rows = state.teams.map((team) => teamRow(team, rerender));

  root.replaceChildren(
    h('div', { class: 'section-head' },
      h('h2', {}, 'Equipos'),
      h('p', { class: 'lead' }, 'Da de alta a los equipos que pueden participar. Para una demo, genera 32 de un jalón.'),
    ),
    h('div', { class: 'toolbar' },
      createForm,
      h('div', { class: 'inline-form' }, countSelect, generateButton, progress),
    ),
    state.teams.length === 0
      ? h('p', { class: 'empty' }, 'Todavía no hay equipos. Crea uno o genera equipos de ejemplo.')
      : h('div', { class: 'table-wrap' },
        h('table', { class: 'table' },
          h('caption', {}, `${state.teams.length} equipos registrados`),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Nombre'), h('th', { scope: 'col', class: 'col-actions' }, 'Acciones'))),
          h('tbody', {}, rows),
        )),
  );
}

function teamRow(team, rerender) {
  const nameCell = h('td', {}, h('span', { class: 'team-cell' }, teamBadge(team.id), team.name));
  const row = h('tr', {}, nameCell);

  const editButton = h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => startEdit() }, 'Renombrar');
  const deleteButton = h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: () => remove() }, 'Borrar');
  row.append(h('td', { class: 'col-actions' }, editButton, deleteButton));

  function startEdit() {
    const input = h('input', { value: team.name, 'aria-label': `Nuevo nombre para ${team.name}`, required: true, maxlength: '80' });
    const save = h('button', { class: 'btn btn-small btn-primary', type: 'submit' }, 'Guardar');
    const cancel = h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => rerender() }, 'Cancelar');
    const form = h('form', { class: 'inline-form', onsubmit: async (event) => {
      event.preventDefault();
      await withBusy(save, async () => {
        try {
          await api.updateTeam(team.id, input.value.trim());
          toast('Nombre actualizado.', 'success');
          await rerender();
        } catch (error) { reportError(error); }
      });
    } }, input, save, cancel);
    nameCell.replaceChildren(form);
    input.focus();
    input.select();
  }

  async function remove() {
    // El backend deja borrar un equipo aunque esté jugando, así que al menos se advierte.
    const playing = state.currentTournament?.status === 'IN_PROGRESS'
      && (state.currentTournament.seededTeamIds ?? []).includes(team.id);
    const message = playing
      ? `${team.name} está jugando en el torneo abierto. Si lo borras, en el bracket aparecerá como "Equipo eliminado". ¿Borrarlo de todos modos?`
      : `¿Borrar a ${team.name}?`;
    if (!confirm(message)) return;
    await withBusy(deleteButton, async () => {
      try {
        await api.deleteTeam(team.id);
        toast('Equipo borrado.', 'success');
        await rerender();
      } catch (error) { reportError(error); }
    });
  }

  return row;
}
