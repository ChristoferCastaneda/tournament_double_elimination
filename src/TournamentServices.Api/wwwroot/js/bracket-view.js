import { api, ApiError } from './api.js';
import { loadTeams } from './teams.js';
import { layoutFor, placeMatches, winnersFeeders } from './bracket-layout.js';
import { simulateRound, simulateAll } from './simulate.js';
import { createFighter } from './fighter.js';
import { state, setTournament, teamName, teamBadge, h, toast, withBusy, reportError, go } from './ui.js';

let currentRoot = null;
// La simulación redibuja la vista varias veces; con esto los botones nuevos nacen deshabilitados.
let simulationRunning = false;

export async function renderBracket(root) {
  currentRoot = root;
  if (!state.tournamentId) { go('torneo'); return; }

  if (!root.hasChildNodes()) root.append(h('p', { class: 'loading' }, 'Cargando bracket…'));

  let tournament;
  let matches;
  try {
    [tournament, matches] = await Promise.all([
      api.getTournament(state.tournamentId),
      api.getMatches(state.tournamentId),
      loadTeams(),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      setTournament(null);
      toast('Ese torneo ya no existe. Elige otro.', 'error');
      go('torneo');
      return;
    }
    root.replaceChildren(h('p', { class: 'empty' }, error.message));
    return;
  }
  state.currentTournament = tournament;

  if (tournament.status === 'CREATED') {
    root.replaceChildren(
      h('div', { class: 'section-head' }, h('h2', {}, tournament.name)),
      h('p', { class: 'empty' }, 'Este torneo todavía no inicia. Inscribe equipos y arráncalo para ver el bracket.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go('torneo') }, 'Ir a Torneo'),
    );
    return;
  }

  const seeded = tournament.seededTeamIds ?? [];
  const layout = layoutFor(seeded.length);
  const { byKey, others } = placeMatches(layout, matches);
  const bracketMatches = matches.filter((m) => m.bracketKey);
  const played = bracketMatches.filter((m) => m.isCompleted).length;
  const hasReset = byKey.has('grand-final-reset');
  const total = layout.baseMatchCount + (hasReset ? 1 : 0);
  const pending = bracketMatches.filter((m) => !m.isCompleted);

  const view = h('div', { class: 'bracket-page' },
    header(tournament, played, total, pending.length),
    tournament.status === 'FINISHED' ? await championBanner(tournament, hasReset) : null,
    h('div', { class: 'bracket-scroll', tabindex: '0', 'aria-label': 'Bracket del torneo, se desplaza a los lados' },
      side('Winners', 'Nadie ha perdido todavía. Quien pierde aquí baja a losers.', 'winners',
        layout.winners.map((column, r) => renderColumn(column, (slot) =>
          winnersSlot(slot, r + 1, layout, byKey, seeded))), true),
      side('Losers', 'Segunda oportunidad: quien pierde aquí queda eliminado.', 'losers',
        layout.losers.map((column) => renderColumn(column, (slot) => losersSlot(slot, byKey))), false),
      side('Final', 'El campeón de winners contra el de losers. Si gana el de losers, se juega un desempate.', 'final',
        layout.final.map((column) => (column.id === 'grand-final-reset' && !hasReset && tournament.status === 'FINISHED')
          ? null
          : renderColumn(column, (slot) => finalSlot(slot, byKey, hasReset))), false),
      others.length ? side('Otros partidos', 'Partidos que no encajan en la estructura calculada.', 'others',
        [renderColumn({ id: 'others', title: 'Sin casilla', slots: others.map((m) => ({ match: m })) }, (slot) => matchCard(slot.match, 'Partido'))], false) : null,
    ),
  );

  root.replaceChildren(view);
  wireHighlight(view);
}

function header(tournament, played, total, pendingCount) {
  const simulating = tournament.status === 'IN_PROGRESS';
  const roundButton = h('button', { class: 'btn', type: 'button', disabled: simulationRunning || pendingCount === 0, onclick: () => runSimulation(roundButton, false) }, 'Simular ronda');
  const allButton = h('button', { class: 'btn', type: 'button', disabled: simulationRunning, onclick: () => runSimulation(allButton, true) }, 'Simular todo');
  const refreshButton = h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => withBusy(refreshButton, () => renderBracket(currentRoot)) }, 'Actualizar');

  return h('div', { class: 'bracket-head' },
    h('div', {},
      h('h2', {}, tournament.name),
      h('p', { class: 'lead' },
        tournament.status === 'FINISHED' ? 'Torneo terminado.' : `${pendingCount} partidos listos para jugarse. Haz clic en uno para capturar el marcador.`),
    ),
    h('div', { class: 'bracket-meta' },
      h('p', { class: 'played' }, h('strong', {}, String(played)), ` de ${total} partidos jugados`),
      h('div', { class: 'progress-bar', role: 'progressbar', 'aria-label': 'Avance del torneo', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(played) },
        h('span', { style: `width: ${total ? Math.round((played / total) * 100) : 0}%` })),
      h('div', { class: 'inline-form' },
        simulating ? h('span', { class: 'demo-tag' }, 'Demo') : null,
        simulating ? roundButton : null,
        simulating ? allButton : null,
        refreshButton),
    ),
  );
}

async function runSimulation(button, all) {
  if (simulationRunning) return;
  simulationRunning = true;
  await withBusy(button, async () => {
    try {
      const fn = all ? simulateAll : simulateRound;
      const result = await fn(state.tournamentId, () => renderBracket(currentRoot));
      if (result.stoppedReason) toast(result.stoppedReason, 'error');
      else toast(`Se simularon ${result.reported} partidos.`, 'success');
    } catch (error) { reportError(error); }
    simulationRunning = false;
    await renderBracket(currentRoot);
  }, 'Simulando…');
  simulationRunning = false;
}

// El torneo ya trae championTeamId; /champion queda solo como respaldo.
async function championBanner(tournament, hasReset) {
  let championId = tournament.championTeamId;
  if (!championId) {
    try {
      const champion = await api.getChampion(tournament.id);
      championId = champion?.id ?? champion?.teamId ?? champion?.championTeamId ?? null;
    } catch {
      championId = null;
    }
  }
  return h('div', { class: 'champion', role: 'status' },
    createFighter('fighter fighter-champion'),
    teamBadge(championId, 'large'),
    h('div', { class: 'champion-text' },
      h('p', { class: 'champion-label' }, 'Campeón'),
      h('p', { class: 'champion-name' }, teamName(championId)),
      h('p', { class: 'champion-note' }, hasReset
        ? 'Llegó por losers, ganó la gran final y también el desempate.'
        : 'Ganó la gran final.')),
  );
}

function side(title, description, kind, columns, connected) {
  return h('section', { class: `bracket-side side-${kind}${connected ? ' is-connected' : ''}`, 'aria-label': title },
    h('header', { class: 'side-head' }, h('h3', {}, title), h('p', {}, description)),
    h('div', { class: 'columns' }, columns),
  );
}

function renderColumn(column, renderSlot) {
  const matchCount = column.slots.filter((slot) => slot.kind !== 'bye' && slot.kind !== 'carry').length;
  return h('div', { class: 'column', dataset: { column: column.id } },
    h('h4', { class: 'column-title' }, column.title,
      matchCount > 1 ? h('span', { class: 'column-count' }, `${matchCount} partidos`) : null),
    column.note ? h('p', { class: 'column-note' }, column.note) : null,
    h('ol', { class: 'slots' }, column.slots.map((slot) => h('li', { class: 'slot' }, renderSlot(slot)))),
  );
}

function winnersSlot(slot, round, layout, byKey, seeded) {
  if (slot.kind === 'bye') {
    return h('div', { class: 'card card-bye' },
      teamLine(seeded[slot.byeSeedIndex], null, false),
      h('p', { class: 'card-note' }, 'Pase directo a la siguiente ronda'));
  }
  const match = byKey.get(slot.key);
  if (match) return matchCard(match, `${layout.winners[round - 1].title}, partido ${slot.index + 1}`);
  const feeders = winnersFeeders(layout, round, slot.index, byKey, seeded);
  return placeholderCard(feeders ?? [{ from: 'Por definir' }, { from: 'Por definir' }]);
}

function losersSlot(slot, byKey) {
  if (slot.kind === 'carry') {
    return h('div', { class: 'card card-bye' }, h('p', { class: 'card-note' }, 'Pase libre: un equipo avanza sin jugar'));
  }
  const match = byKey.get(slot.key);
  if (match) return matchCard(match, `Losers, partido ${slot.index + 1}`);
  return placeholderCard([{ from: 'Por definir' }, { from: 'Por definir' }]);
}

function finalSlot(slot, byKey, hasReset) {
  const match = byKey.get(slot.key);
  if (match) return matchCard(match, slot.key === 'grand-final' ? 'Gran final' : 'Final de desempate');
  if (slot.kind === 'reset' && !hasReset) {
    return h('div', { class: 'card card-placeholder' }, h('p', { class: 'card-note' }, 'Sólo se juega si gana quien viene de losers.'));
  }
  return placeholderCard([{ from: 'Campeón de winners' }, { from: 'Campeón de losers' }]);
}

function placeholderCard(feeders) {
  return h('div', { class: 'card card-placeholder' },
    feeders.map((f) => (f.teamId ? teamLine(f.teamId, null, false)
      : h('p', { class: 'team team-unknown' }, teamBadge(null), h('span', { class: 'team-name' }, f.from)))));
}

function teamLine(teamId, score, isWinner, isLoser = false) {
  return h('p', { class: `team${isWinner ? ' is-winner' : ''}${isLoser ? ' is-loser' : ''}`, dataset: teamId ? { team: teamId } : undefined },
    teamBadge(teamId),
    h('span', { class: 'team-name' }, teamName(teamId)),
    score === null ? null : h('span', { class: 'team-score' }, String(score)));
}

function matchCard(match, label) {
  const done = match.isCompleted;
  const homeWon = done && match.winner === 'HOME';
  const visitorWon = done && match.winner === 'VISITOR';
  const lines = [
    teamLine(match.homeTeamId, done ? match.score?.homeTeamScore ?? 0 : null, homeWon, visitorWon),
    teamLine(match.visitorTeamId, done ? match.score?.visitorTeamScore ?? 0 : null, visitorWon, homeWon),
  ];
  if (done) return h('div', { class: 'card card-done', 'aria-label': `${label}, terminado` }, lines);

  return h('button', { class: 'card card-playable', type: 'button', 'aria-label': `${label}: ${teamName(match.homeTeamId)} contra ${teamName(match.visitorTeamId)}. Capturar marcador`,
    onclick: () => openScoreDialog(match, label) }, lines, h('span', { class: 'card-cta', 'aria-hidden': 'true' }, 'Capturar'));
}

function wireHighlight(view) {
  let current = null;
  const set = (teamId) => {
    if (teamId === current) return;
    current = teamId;
    for (const node of view.querySelectorAll('.is-highlight')) node.classList.remove('is-highlight');
    if (teamId) for (const node of view.querySelectorAll(`[data-team="${CSS.escape(teamId)}"]`)) node.classList.add('is-highlight');
  };
  view.addEventListener('mouseover', (event) => set(event.target.closest('[data-team]')?.dataset.team ?? null));
  view.addEventListener('mouseleave', () => set(null));
}

function openScoreDialog(match, label) {
  const dialog = document.getElementById('score-dialog');
  const form = document.getElementById('score-form');
  const home = document.getElementById('score-home');
  const visitor = document.getElementById('score-visitor');
  const error = document.getElementById('score-error');
  const save = document.getElementById('score-save');

  document.getElementById('score-round').textContent = label;
  document.getElementById('score-home-label').textContent = teamName(match.homeTeamId);
  document.getElementById('score-visitor-label').textContent = teamName(match.visitorTeamId);
  home.value = '';
  visitor.value = '';
  error.textContent = '';

  const close = () => dialog.close();
  document.getElementById('score-cancel').onclick = close;

  form.onsubmit = async (event) => {
    event.preventDefault();
    const scores = readScores(home.value, visitor.value);
    if (scores.error) { error.textContent = scores.error; return; }
    error.textContent = '';

    await withBusy(save, async () => {
      try {
        await api.reportScore(state.tournamentId, match.id, scores.home, scores.visitor);
        close();
        toast('Marcador guardado.', 'success');
      } catch (err) {
        // Si el partido ya quedó jugado (desde otra pestaña, o en el reintento tras un 409),
        // no es un error de quien captura.
        if (err instanceof ApiError && err.status === 422) {
          const fresh = await api.getMatches(state.tournamentId).catch(() => []);
          if (fresh.find((m) => m.id === match.id)?.isCompleted) {
            close();
            toast(err.afterConflict ? 'Marcador guardado.' : 'Este partido ya se había jugado; se actualizó el bracket.', 'info');
            await renderBracket(currentRoot);
            return;
          }
        }
        error.textContent = err.message;
        return;
      }
      await renderBracket(currentRoot);
    }, 'Guardando…');
  };

  dialog.showModal();
  home.focus();
}

export function readScores(homeText, visitorText) {
  const parse = (text) => (/^\d{1,3}$/.test(String(text).trim()) ? Number(String(text).trim()) : null);
  const homeScore = parse(homeText);
  const visitorScore = parse(visitorText);
  if (homeScore === null || visitorScore === null) return { error: 'Escribe ambos marcadores como números enteros de 0 a 999.' };
  if (homeScore === visitorScore) return { error: 'En eliminación no hay empates: alguien tiene que ganar.' };
  return { home: homeScore, visitor: visitorScore };
}
