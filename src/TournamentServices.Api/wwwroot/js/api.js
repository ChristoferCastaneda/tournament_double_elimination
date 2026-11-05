// Las rutas son relativas porque la misma API sirve la página; así no hace falta CORS.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Se marca cuando el error llegó en el reintento después de un 409, para que quien llama
    // revise si la operación sí quedó guardada.
    this.afterConflict = false;
  }
}

const defaultMessages = {
  0: 'No se pudo conectar con la API. Revisa que esté levantada.',
  400: 'La petición no es válida.',
  404: 'No se encontró lo que se buscaba.',
  409: 'Otra operación modificó estos datos al mismo tiempo. Intenta de nuevo.',
  422: 'La operación no cumple las reglas del torneo.',
  500: 'La API tuvo un error inesperado.',
};

function messageFrom(status, data) {
  if (data && typeof data === 'object') {
    if (data.detail) return data.detail;
    if (data.errors && typeof data.errors === 'object') {
      const first = Object.values(data.errors).flat()[0];
      if (first) return first;
    }
    if (data.title) return data.title;
  }
  return defaultMessages[status] ?? `Error ${status}.`;
}

async function send(method, path, body) {
  const options = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, defaultMessages[0]);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) throw new ApiError(response.status, messageFrom(response.status, data));
  return data;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Un 409 significa que la operación no se guardó, así que es seguro reintentar una vez.
export async function request(method, path, body) {
  try {
    return await send(method, path, body);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    await wait(300);
    try {
      return await send(method, path, body);
    } catch (retryError) {
      if (retryError instanceof ApiError) retryError.afterConflict = true;
      throw retryError;
    }
  }
}

const id = (value) => encodeURIComponent(value);

export const api = {
  health: () => send('GET', '/health'),

  getTeams: () => request('GET', '/teams'),
  createTeam: (name) => request('POST', '/teams', { name }),
  updateTeam: (teamId, name) => request('PUT', `/teams/${id(teamId)}`, { name }),
  deleteTeam: (teamId) => request('DELETE', `/teams/${id(teamId)}`),

  listTournaments: () => request('GET', '/tournaments'),
  getTournament: (tournamentId) => request('GET', `/tournaments/${id(tournamentId)}`),
  createTournament: (name, format) => request('POST', '/tournaments', { name, format }),
  deleteTournament: (tournamentId) => request('DELETE', `/tournaments/${id(tournamentId)}`),

  // La asignación lleva un arreglo plano de ids y agrega equipos, no reemplaza la lista.
  getGroups: (tournamentId) => request('GET', `/tournaments/${id(tournamentId)}/groups`),
  createGroup: (tournamentId, name) => request('POST', `/tournaments/${id(tournamentId)}/groups`, { name }),
  assignTeams: (tournamentId, groupId, teamIds) =>
    request('PATCH', `/tournaments/${id(tournamentId)}/groups/${id(groupId)}/teams`, teamIds),

  // El partido se reporta con su id (un GUID), no con su bracketKey.
  startTournament: (tournamentId) => request('POST', `/tournaments/${id(tournamentId)}/start`),
  getMatches: (tournamentId) => request('GET', `/tournaments/${id(tournamentId)}/matches`),
  reportScore: (tournamentId, matchId, homeTeamScore, visitorTeamScore) =>
    request('PATCH', `/tournaments/${id(tournamentId)}/bracket/matches/${id(matchId)}/score`,
      { homeTeamScore, visitorTeamScore }),
  getChampion: (tournamentId) => request('GET', `/tournaments/${id(tournamentId)}/champion`),
};
