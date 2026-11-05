// La API solo crea un partido cuando ya conoce a sus dos equipos. Para dibujar las casillas
// futuras, aquí se corre la misma lógica de Domain/Brackets/DoubleEliminationBracket.cs con
// equipos de mentira. Qué partidos existen no depende de quién gane ni del orden de los
// resultados, por eso basta con una corrida. Si cambia esa lógica en el backend, este
// archivo tiene que cambiar igual.

export function layoutFor(teamCount) {
  if (!Number.isInteger(teamCount) || teamCount < 2) throw new Error('Se necesitan al menos 2 equipos.');
  const sim = new StructureSimulator(teamCount);
  sim.run();
  return sim.toLayout();
}

class StructureSimulator {
  constructor(n) {
    let total = 1;
    while (total < n) total *= 2;
    this.n = n;
    this.totalSlots = total;
    this.rounds = Math.log2(total);
    this.byeCount = total - n;

    this.wb = [];
    for (let level = 0; level <= this.rounds; level++) this.wb.push(new Array(total >> level).fill(null));
    this.expected = {};
    for (let level = 0; level < this.rounds; level++) this.expected[level + 1] = this.wb[level].length / 2;
    this.expected[1] -= this.byeCount;

    this.wbLosers = {};
    this.wbChampion = null;
    this.lbChampion = null;
    this.lbSurvivors = [];
    this.lbBuffer = null;
    this.nextMerge = 2;
    this.lbAwaiting = null;
    this.lbCounter = 0;
    this.gfCreated = false;

    this.matches = new Map();
    this.pending = [];
    this.created = [];
    this.lbRounds = [];
  }

  // Se respeta el orden sorteado tal cual, igual que el KeepOrderSeeder del backend.
  run() {
    const pairCount = this.totalSlots / 2;
    let teamIndex = 0;
    const slots = [];
    for (let pair = 0; pair < pairCount; pair++) {
      slots.push(`T${teamIndex++}`);
      slots.push(pair < this.byeCount ? null : `T${teamIndex++}`);
    }
    for (let pair = 0; pair < pairCount; pair++) {
      const a = slots[pair * 2];
      const b = slots[pair * 2 + 1];
      if (b === null) this.advanceWinner(1, pair, a);
      else this.createWinners(0, pair, a, b);
    }
    // Siempre gana el local; así se recorre toda la estructura sin llegar al desempate.
    let guard = this.n * 4 + 10;
    while (this.pending.length > 0 && guard-- > 0) {
      this.report(this.pending[0]);
    }
  }

  add(key, home, visitor, side, level, index) {
    this.matches.set(key, { home, visitor, side, level, index });
    this.pending.push(key);
    this.created.push(key);
  }

  createWinners(level, index, home, visitor) {
    this.add(`wb-r${level + 1}-m${index}`, home, visitor, 'W', level, index);
  }

  advanceWinner(level, index, team) {
    this.wb[level][index] = team;
    if (level === this.rounds) { this.wbChampion = team; this.tryGrandFinal(); return; }
    const pair = Math.floor(index / 2);
    const sibling = pair * 2 === index ? index + 1 : index - 1;
    if (this.wb[level][sibling] === null) return;
    this.createWinners(level, pair, this.wb[level][pair * 2], this.wb[level][pair * 2 + 1]);
  }

  addWbLoser(round, team) {
    (this.wbLosers[round] ??= []).push(team);
    const list = this.wbLosers[round];
    if (list.length !== this.expected[round]) return;
    if (round === 1) this.startLb(list, false, null, null);
    else if (this.lbAwaiting === round) this.advanceLb();
  }

  advanceLb() {
    const s = this.lbSurvivors;
    if (s.length === 1 && this.nextMerge > this.rounds) { this.lbChampion = s[0]; this.tryGrandFinal(); return; }
    if (this.nextMerge <= this.rounds) {
      if (s.length > this.expected[this.nextMerge]) { this.startLb(s, false, null, null); return; }
      const newcomers = this.wbLosers[this.nextMerge];
      if (newcomers && newcomers.length === this.expected[this.nextMerge]) {
        const mergeRound = this.nextMerge++;
        this.lbAwaiting = null;
        this.startLb(s, true, newcomers, mergeRound);
      } else {
        this.lbAwaiting = this.nextMerge;
      }
      return;
    }
    if (s.length > 1) this.startLb(s, false, null, null);
  }

  startLb(entrants, isDropIn, newcomers, wbRound) {
    const pairCount = isDropIn ? Math.min(entrants.length, newcomers.length) : Math.floor(entrants.length / 2);
    const total = isDropIn ? Math.max(entrants.length, newcomers.length) : pairCount + (entrants.length % 2);
    const label = isDropIn ? `lb-dropin-${wbRound}` : `lb-round-${this.lbCounter++}`;
    const buffer = new Array(total).fill(null);

    for (let i = 0; i < pairCount; i++) {
      const visitor = isDropIn ? newcomers[i] : entrants[pairCount + i];
      this.add(`${label}-m${i}`, entrants[i], visitor, 'L', 0, i);
    }
    let carry = pairCount;
    if (isDropIn) {
      for (let i = pairCount; i < entrants.length; i++) buffer[carry++] = entrants[i];
      for (let i = pairCount; i < newcomers.length; i++) buffer[carry++] = newcomers[i];
    } else if (entrants.length % 2 === 1) {
      buffer[carry] = entrants[entrants.length - 1];
    }
    this.lbRounds.push({ label, isDropIn, wbRound, matchCount: pairCount, carries: total - pairCount });

    this.lbBuffer = buffer;
    if (buffer.every((v) => v !== null)) this.completeLb([...buffer]);
  }

  completeLb(survivors) {
    this.lbSurvivors = survivors;
    this.lbBuffer = null;
    this.advanceLb();
  }

  tryGrandFinal() {
    if (!this.wbChampion || !this.lbChampion || this.gfCreated) return;
    this.gfCreated = true;
    this.add('grand-final', this.wbChampion, this.lbChampion, 'GF', 0, 0);
  }

  report(key) {
    const m = this.matches.get(key);
    this.pending.splice(this.pending.indexOf(key), 1);
    const winner = m.home;
    const loser = m.visitor;
    if (m.side === 'W') {
      this.advanceWinner(m.level + 1, m.index, winner);
      this.addWbLoser(m.level + 1, loser);
    } else if (m.side === 'L') {
      this.lbBuffer[m.index] = winner;
      if (this.lbBuffer.every((v) => v !== null)) this.completeLb([...this.lbBuffer]);
    }
  }

  toLayout() {
    const winners = [];
    for (let r = 1; r <= this.rounds; r++) {
      const slotCount = this.totalSlots >> r;
      const slots = [];
      for (let i = 0; i < slotCount; i++) {
        const key = `wb-r${r}-m${i}`;
        // En la ronda 1 los primeros byeCount pares no juegan: ese equipo pasa directo.
        const isBye = r === 1 && i < this.byeCount;
        slots.push({ key, index: i, kind: isBye ? 'bye' : 'match', byeSeedIndex: isBye ? i : null });
      }
      winners.push({ id: `wb-r${r}`, title: winnersTitle(r, this.rounds), slots });
    }

    // Con 2 equipos queda una ronda de losers sin partidos, solo con un pase libre, y no se dibuja.
    const lbRounds = this.lbRounds.filter((round) => round.matchCount > 0);
    let lbNumber = 0;
    const losers = lbRounds.map((round) => {
      lbNumber++;
      const slots = [];
      for (let i = 0; i < round.matchCount; i++) slots.push({ key: `${round.label}-m${i}`, index: i, kind: 'match' });
      for (let i = 0; i < round.carries; i++) slots.push({ key: null, index: round.matchCount + i, kind: 'carry' });
      const title = round === lbRounds[lbRounds.length - 1] ? 'Final de losers' : `Losers ${lbNumber}`;
      return { id: round.label, title, note: round.isDropIn ? `Entran los que pierden la ronda ${round.wbRound} de winners` : null, slots };
    });

    const final = [
      { id: 'grand-final', title: 'Gran final', slots: [{ key: 'grand-final', index: 0, kind: 'match' }] },
      { id: 'grand-final-reset', title: 'Final de desempate', slots: [{ key: 'grand-final-reset', index: 0, kind: 'reset' }] },
    ];

    const keys = new Set(this.created);
    keys.add('grand-final-reset');
    return {
      teamCount: this.n,
      byeCount: this.byeCount,
      rounds: this.rounds,
      winners,
      losers,
      final,
      keys,
      baseMatchCount: this.created.length,
    };
  }
}

function winnersTitle(round, rounds) {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return 'Final de winners';
  if (fromEnd === 1) return 'Semifinal';
  if (fromEnd === 2) return 'Cuartos de final';
  return `Ronda ${round}`;
}

// Los partidos sin bracketKey no son del bracket. Si llega una clave que el cálculo no conoce,
// el partido se muestra aparte para no perderlo.
export function placeMatches(layout, matches) {
  const byKey = new Map();
  const others = [];
  for (const match of matches) {
    if (!match.bracketKey) continue;
    if (layout.keys.has(match.bracketKey)) byKey.set(match.bracketKey, match);
    else others.push(match);
  }
  if (others.length) console.warn('Partidos con bracketKey fuera del layout:', others.map((m) => m.bracketKey));
  return { byKey, others };
}

export function winnersFeeders(layout, round, index, byKey, seededTeamIds) {
  if (round === 1) return null;
  const feeder = (feederIndex) => {
    if (round === 2) {
      const slot = layout.winners[0].slots[feederIndex];
      if (slot.kind === 'bye') return { teamId: seededTeamIds?.[slot.byeSeedIndex] ?? null, from: 'Pase directo' };
    }
    const key = `wb-r${round - 1}-m${feederIndex}`;
    const match = byKey.get(key);
    if (match?.isCompleted && match.winner) {
      return { teamId: match.winner === 'HOME' ? match.homeTeamId : match.visitorTeamId, from: null };
    }
    return { teamId: null, from: `Ganador del partido ${feederIndex + 1}` };
  };
  return [feeder(index * 2), feeder(index * 2 + 1)];
}
