import { api, ApiError } from './api.js';
import { loadTeams } from './teams.js';
import { state, setTournament, teamName, teamBadge, isKnownTeam, h, toast, withBusy, reportError, go } from './ui.js';

const tournamentType = 'DOUBLE_ELIMINATION';
const statusText = { CREATED: 'Inscripción abierta', IN_PROGRESS: 'En juego', FINISHED: 'Terminado' };

export function formatFor(participants) {
  const numberOfGroups = participants >= 16 ? 4 : 2;
  const maxTeamsPerGroup = Math.max(1, Math.ceil(participants / numberOfGroups));
  return { maxTeamsPerGroup, numberOfGroups, type: tournamentType };
}

export function capacityOf(tournament) {
  return tournament.format.numberOfGroups * tournament.format.maxTeamsPerGroup;
}

export function inscribedIds(tournament) {
  return [...new Set((tournament.groups ?? []).flatMap((g) => g.teamIds ?? []))];
}

export function uniqueName(name, takenNames) {
  const taken = new Set(takenNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(name.trim().toLowerCase())) return name.trim();
  for (let n = 2; ; n++) {
    const candidate = `${name.trim()} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function nextGroupNames(existingNames, howMany) {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const names = [];
  for (let i = 0; names.length < howMany; i++) {
    const letter = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
    const name = `Grupo ${letter}`;
    if (!taken.has(name.toLowerCase())) { names.push(name); taken.add(name.toLowerCase()); }
  }
  return names;
}

export function distribute(groups, teamIds, maxTeamsPerGroup) {
  const free = groups.map((g) => ({ id: g.id, free: maxTeamsPerGroup - (g.teamIds?.length ?? 0) }));
  const plan = new Map();
  const leftOver = [];
  for (const teamId of teamIds) {
    const target = free.reduce((best, g) => (g.free > (best?.free ?? 0) ? g : best), null);
    if (!target) { leftOver.push(teamId); continue; }
    target.free--;
    if (!plan.has(target.id)) plan.set(target.id, []);
    plan.get(target.id).push(teamId);
  }
  return { plan, leftOver };
}

// Siempre parte del estado real del servidor: si se corta a la mitad, volver a pulsar
// "Inscribir equipos" termina lo que faltaba sin duplicar nada.
async function inscribe(tournamentId, selectedIds) {
  let tournament = await api.getTournament(tournamentId);
  if (tournament.status !== 'CREATED') throw new Error('El torneo ya inició; ya no se pueden inscribir equipos.');

  const missingGroups = tournament.format.numberOfGroups - tournament.groups.length;
  if (missingGroups > 0) {
    for (const name of nextGroupNames(tournament.groups.map((g) => g.name), missingGroups)) {
      try {
        await api.createGroup(tournamentId, name);
      } catch (error) {
        // 422 por máximo de grupos o nombre repetido: alguien ya lo creó, seguimos con lo que haya.
        if (!(error instanceof ApiError) || error.status !== 422) throw error;
      }
    }
    tournament = await api.getTournament(tournamentId);
  }

  const already = new Set(inscribedIds(tournament));
  const pending = selectedIds.filter((teamId) => !already.has(teamId));
  const { plan, leftOver } = distribute(tournament.groups, pending, tournament.format.maxTeamsPerGroup);
  const removed = [];

  for (const [groupId, teamIds] of plan) {
    try {
      await api.assignTeams(tournamentId, groupId, teamIds);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error;
      // Un solo equipo inexistente o ya asignado hace fallar el PATCH completo, así que se limpia
      // la lista y se reintenta una vez.
      await loadTeams();
      const fresh = await api.getTournament(tournamentId);
      const nowInscribed = new Set(inscribedIds(fresh));
      const valid = teamIds.filter((teamId) => isKnownTeam(teamId) && !nowInscribed.has(teamId));
      removed.push(...teamIds.filter((teamId) => !isKnownTeam(teamId)));
      if (valid.length > 0) await api.assignTeams(tournamentId, groupId, valid);
    }
  }

  return { removed, leftOver };
}

export async function renderTournament(root) {
  root.replaceChildren(h('p', { class: 'loading' }, 'Cargando torneos…'));
  let tournaments;
  try {
    [tournaments] = await Promise.all([api.listTournaments(), loadTeams()]);
  } catch (error) {
    root.replaceChildren(h('p', { class: 'empty' }, error.message));
    return;
  }

  const ours = tournaments.filter((t) => t.format?.type === tournamentType);
  let current = null;
  if (state.tournamentId) {
    try {
      current = await api.getTournament(state.tournamentId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setTournament(null);
      else { reportError(error); }
    }
  }
  state.currentTournament = current;

  const rerender = () => renderTournament(root);

  root.replaceChildren(
    h('div', { class: 'section-head' },
      h('h2', {}, 'Torneo'),
      h('p', { class: 'lead' }, 'Crea un torneo, inscribe a los equipos y arráncalo. Al iniciar se sortean los cruces.'),
    ),
    h('div', { class: 'tournament-layout' },
      h('div', { class: 'stack' },
        createPanel(tournaments, rerender),
        listPanel(ours, current, rerender),
      ),
      current ? currentPanel(current, rerender) : h('div', { class: 'panel panel-empty' },
        h('p', {}, 'Elige un torneo de la lista o crea uno nuevo para inscribir equipos.')),
    ),
  );
}

function createPanel(allTournaments, rerender) {
  const nameInput = h('input', { id: 't-name', required: true, maxlength: '80', autocomplete: 'off', value: 'Copa de doble eliminación' });
  const countInput = h('input', { id: 't-count', type: 'number', min: '2', max: '128', step: '1', required: true, value: '32' });
  const hint = h('p', { class: 'hint' });
  const updateHint = () => {
    const n = Number(countInput.value);
    if (!Number.isInteger(n) || n < 2) { hint.textContent = 'Se necesitan al menos 2 equipos.'; return; }
    const f = formatFor(n);
    hint.textContent = `Se armarán ${f.numberOfGroups} grupos de hasta ${f.maxTeamsPerGroup} equipos.`;
  };
  countInput.addEventListener('input', updateHint);
  updateHint();

  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Crear torneo');
  const form = h('form', { class: 'panel form-grid', onsubmit: async (event) => {
    event.preventDefault();
    const participants = Number(countInput.value);
    if (!Number.isInteger(participants) || participants < 2) { toast('Se necesitan al menos 2 equipos.', 'error'); return; }
    await withBusy(submit, async () => {
      const name = uniqueName(nameInput.value, allTournaments.map((t) => t.name));
      try {
        const created = await api.createTournament(name, formatFor(participants));
        setTournament(created.id);
        toast(name === nameInput.value.trim() ? 'Torneo creado.' : `Ya había uno con ese nombre; se creó como "${name}".`, 'success');
        await rerender();
      } catch (error) { reportError(error); }
    });
  } },
    h('h3', {}, 'Nuevo torneo'),
    h('label', { for: 't-name' }, 'Nombre'), nameInput,
    h('label', { for: 't-count' }, 'Equipos participantes'), countInput,
    hint,
    submit,
  );
  return form;
}

function listPanel(tournaments, current, rerender) {
  if (tournaments.length === 0) {
    return h('div', { class: 'panel' }, h('h3', {}, 'Torneos'), h('p', { class: 'empty' }, 'Aún no hay torneos de doble eliminación.'));
  }
  return h('div', { class: 'panel' },
    h('h3', {}, 'Torneos'),
    h('ul', { class: 'tournament-list' }, tournaments.map((t) => {
      const isCurrent = current?.id === t.id;
      const del = h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: async () => {
        if (!confirm(`¿Borrar el torneo "${t.name}"? Se borran sus grupos y partidos.`)) return;
        await withBusy(del, async () => {
          try {
            await api.deleteTournament(t.id);
            if (state.tournamentId === t.id) setTournament(null);
            toast('Torneo borrado.', 'success');
            await rerender();
          } catch (error) { reportError(error); }
        });
      } }, 'Borrar');
      return h('li', { class: isCurrent ? 'is-current' : '' },
        h('button', { class: 'link-button', type: 'button', 'aria-current': isCurrent ? 'true' : null, onclick: async () => {
          setTournament(t.id);
          await rerender();
        } }, t.name),
        h('span', { class: `status status-${(t.status ?? 'CREATED').toLowerCase()}` }, statusText[t.status] ?? t.status),
        del,
      );
    })),
  );
}

function currentPanel(tournament, rerender) {
  const inscribed = inscribedIds(tournament);
  const capacity = capacityOf(tournament);

  const header = h('div', { class: 'panel-head' },
    h('h3', {}, tournament.name),
    h('span', { class: `status status-${tournament.status.toLowerCase()}` }, statusText[tournament.status] ?? tournament.status),
  );

  if (tournament.status !== 'CREATED') {
    const teams = tournament.seededTeamIds?.length ?? inscribed.length;
    return h('div', { class: 'panel panel-current' },
      header,
      h('p', {}, tournament.status === 'FINISHED'
        ? `Torneo terminado. Campeón: ${teamName(tournament.championTeamId)}.`
        : `En juego con ${teams} equipos. Ya no se pueden cambiar inscripciones.`),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('bracket') }, 'Ver bracket'),
      groupsView(tournament),
    );
  }

  return h('div', { class: 'panel panel-current' },
    header,
    h('p', { class: 'hint' }, `${inscribed.length} de ${capacity} lugares ocupados, en ${tournament.format.numberOfGroups} grupos de hasta ${tournament.format.maxTeamsPerGroup} equipos.`),
    inscribePanel(tournament, inscribed, capacity, rerender),
    startPanel(tournament, inscribed, rerender),
    groupsView(tournament),
  );
}

function inscribePanel(tournament, inscribed, capacity, rerender) {
  const inscribedSet = new Set(inscribed);
  const available = state.teams.filter((t) => !inscribedSet.has(t.id));
  const room = capacity - inscribed.length;

  if (state.teams.length === 0) {
    return h('div', { class: 'block' },
      h('h4', {}, 'Inscribir equipos'),
      h('p', { class: 'empty' }, 'No hay equipos registrados.'),
      h('button', { class: 'btn', type: 'button', onclick: () => go('equipos') }, 'Ir a Equipos'));
  }
  if (room <= 0) {
    return h('div', { class: 'block' }, h('h4', {}, 'Inscribir equipos'), h('p', {}, 'El torneo ya está lleno.'));
  }
  if (available.length === 0) {
    return h('div', { class: 'block' }, h('h4', {}, 'Inscribir equipos'),
      h('p', {}, 'Todos los equipos registrados ya están inscritos.'),
      h('button', { class: 'btn', type: 'button', onclick: () => go('equipos') }, 'Agregar más equipos'));
  }

  const counter = h('span', { class: 'counter', 'aria-live': 'polite' });
  const boxes = available.map((team) => h('input', { type: 'checkbox', value: team.id, id: `chk-${team.id}` }));
  const selected = () => boxes.filter((b) => b.checked).map((b) => b.value);
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Inscribir equipos');

  const refresh = () => {
    const count = selected().length;
    counter.textContent = `${count} seleccionados de ${room} lugares libres`;
    for (const box of boxes) box.disabled = !box.checked && count >= room;
    submit.disabled = count === 0;
  };

  const selectAll = h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => {
    let count = selected().length;
    for (const box of boxes) { if (!box.checked && count < room) { box.checked = true; count++; } }
    refresh();
  } }, 'Seleccionar todos');
  const clear = h('button', { class: 'btn btn-small btn-quiet', type: 'button', onclick: () => {
    for (const box of boxes) box.checked = false;
    refresh();
  } }, 'Quitar selección');

  const form = h('form', { class: 'block', onchange: refresh, onsubmit: async (event) => {
    event.preventDefault();
    await withBusy(submit, async () => {
      try {
        const { removed, leftOver } = await inscribe(tournament.id, selected());
        if (removed.length) toast(`Se omitieron ${removed.length} equipos que ya no existen.`, 'error');
        if (leftOver.length) toast(`No cupieron ${leftOver.length} equipos.`, 'error');
        toast('Equipos inscritos.', 'success');
      } catch (error) {
        reportError(error);
        toast('Puedes volver a pulsar "Inscribir equipos": continúa donde se quedó.', 'info');
      }
      await rerender();
    }, 'Inscribiendo…');
  } },
    h('div', { class: 'block-head' }, h('h4', {}, 'Inscribir equipos'), counter),
    h('div', { class: 'inline-form' }, selectAll, clear),
    h('ul', { class: 'check-list' }, available.map((team, i) =>
      h('li', {}, boxes[i], h('label', { for: `chk-${team.id}` }, teamBadge(team.id), team.name)))),
    submit,
  );
  refresh();
  return form;
}

function startPanel(tournament, inscribed, rerender) {
  const deleted = inscribed.filter((teamId) => !isKnownTeam(teamId));
  const canStart = inscribed.length >= 2;
  const button = h('button', { class: 'btn btn-go', type: 'button', disabled: !canStart, onclick: async () => {
    if (!confirm(`Se sortearán ${inscribed.length} equipos y el torneo empezará. Después ya no se puede cambiar la inscripción. ¿Iniciar?`)) return;
    await withBusy(button, async () => {
      try {
        await api.startTournament(tournament.id);
        toast('Torneo iniciado.', 'success');
        go('bracket');
      } catch (error) {
        // Un 422 después de un 409 puede significar que el otro /start sí se guardó.
        if (error instanceof ApiError && error.afterConflict) {
          const fresh = await api.getTournament(tournament.id).catch(() => null);
          if (fresh?.status === 'IN_PROGRESS') { go('bracket'); return; }
        }
        reportError(error);
        await rerender();
      }
    }, 'Iniciando…');
  } }, 'Iniciar torneo');

  return h('div', { class: 'block' },
    h('h4', {}, 'Iniciar'),
    canStart ? null : h('p', { class: 'hint' }, 'Inscribe al menos 2 equipos para poder iniciar.'),
    deleted.length ? h('p', { class: 'warning' },
      `${deleted.length} equipos inscritos ya fueron borrados y entrarían al bracket sin nombre. Para quitarlos hay que borrar su grupo.`) : null,
    button,
  );
}

function groupsView(tournament) {
  if (!tournament.groups?.length) return null;
  return h('details', { class: 'block groups' },
    h('summary', {}, `Ver grupos (${tournament.groups.length})`),
    h('p', { class: 'hint' }, 'En doble eliminación los grupos sólo sirven para inscribir: al iniciar, todos los equipos se sortean juntos. La API no permite sacar a un equipo de un grupo; para corregirlo hay que borrar el grupo.'),
    h('div', { class: 'groups-grid' }, tournament.groups.map((g) =>
      h('div', { class: 'group-card' },
        h('h5', {}, `${g.name} (${g.teamIds.length} de ${tournament.format.maxTeamsPerGroup})`),
        g.teamIds.length ? h('ol', {}, g.teamIds.map((id) => h('li', {}, teamBadge(id), teamName(id)))) : h('p', { class: 'empty' }, 'Sin equipos')))),
  );
}
