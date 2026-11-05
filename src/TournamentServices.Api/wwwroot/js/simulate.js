import { api, ApiError } from './api.js';

function randomScore() {
  const home = Math.floor(Math.random() * 6);
  let visitor = Math.floor(Math.random() * 6);
  while (visitor === home) visitor = Math.floor(Math.random() * 6);
  return { home, visitor };
}

async function pendingMatches(tournamentId) {
  const matches = await api.getMatches(tournamentId);
  return matches.filter((m) => m.bracketKey && !m.isCompleted);
}

async function playPending(tournamentId, pending) {
  let reported = 0;
  for (const match of pending) {
    const { home, visitor } = randomScore();
    try {
      await api.reportScore(tournamentId, match.id, home, visitor);
      reported++;
    } catch (error) {
      // Un 422 aquí casi siempre es un partido que ya se reportó desde otra pestaña; se sigue con los demás.
      if (!(error instanceof ApiError) || error.status !== 422) throw error;
    }
  }
  return reported;
}

export async function simulateRound(tournamentId, onRound) {
  const pending = await pendingMatches(tournamentId);
  const reported = await playPending(tournamentId, pending);
  await onRound?.();
  return { reported, stoppedReason: pending.length && reported === 0 ? 'No se pudo reportar ningún partido.' : null };
}

export async function simulateAll(tournamentId, onRound) {
  const tournament = await api.getTournament(tournamentId);
  const teamCount = tournament.seededTeamIds?.length ?? 0;
  // El tope evita ciclarse si algo falla: un torneo de n equipos nunca pasa de 2n - 1 partidos.
  const maxReports = teamCount * 2 + 5;
  let reported = 0;

  while (reported < maxReports) {
    const pending = await pendingMatches(tournamentId);
    if (pending.length === 0) {
      const fresh = await api.getTournament(tournamentId);
      return { reported, stoppedReason: fresh.status === 'FINISHED' ? null : 'No quedan partidos pendientes pero el torneo no terminó.' };
    }
    const round = await playPending(tournamentId, pending);
    reported += round;
    await onRound?.();
    if (round === 0) return { reported, stoppedReason: 'La simulación se detuvo: ningún partido avanzó en la última vuelta.' };
  }
  return { reported, stoppedReason: 'La simulación llegó al tope de partidos sin terminar el torneo.' };
}
