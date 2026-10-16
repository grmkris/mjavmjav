export const WAIT_MS = 5 * 60_000;
export const MATCH_MS = 30 * 60_000;
export const HANDSHAKE_MS = 2 * 60_000;

export class CatError extends Error {}
export function demand(condition, message) { if (!condition) throw new CatError(message); }
export function newMatch(id, members, now) {
  return { id, members, phase: 'handshake', accepted: [], created: now, expires: now + MATCH_MS,
    messages: [], game: null, revision: 0, recent: {}, lastMessage: {} };
}
export function expireMatch(match, now) {
  if (match.phase !== 'closed' && (now >= match.expires || (match.phase === 'handshake' && now >= match.created + HANDSHAKE_MS))) {
    match.phase = 'closed'; match.reason = 'The cat connection expired.'; match.messages = []; match.game = null; match.recent = {}; match.lastMessage = {}; match.revision++;
  }
}
export function matchView(match, participant, now) {
  demand(match.members.some((m) => m.id === participant), 'This is not your cat connection.');
  expireMatch(match, now);
  return { id: match.id, phase: match.phase, members: match.members, accepted: match.accepted,
    expires: match.phase === 'handshake' ? match.created + HANDSHAKE_MS : match.expires,
    messages: match.phase === 'active' ? match.messages : [], game: match.phase === 'active' ? match.game : null,
    revision: match.revision, reason: match.reason || null };
}
const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export function actOnMatch(match, participant, action, args, now, channel = 'agent') {
  matchView(match, participant, now);
  demand(match.phase !== 'closed' || action === 'leave', 'This connection ended. Find another cat.');
  demand(typeof args.operationId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(args.operationId), 'Use a stable operationId (8–80 letters, digits, _ or -).');
  const key = `${participant}:${args.operationId}`;
  const fingerprint = JSON.stringify([action, args, channel]);
  if (match.recent[key]) {
    demand(match.recent[key] === fingerprint, 'That operationId was used for a different action.');
    return;
  }
  if (action === 'accept') {
    demand(match.phase === 'handshake' || match.phase === 'active', 'No pawshake to accept.');
    if (!match.accepted.includes(participant)) match.accepted.push(participant);
    if (match.accepted.length === 2) match.phase = 'active';
  } else if (action === 'leave') {
    match.phase = 'closed'; match.reason = 'A cat left the connection.'; match.messages = []; match.game = null; match.recent = {}; match.lastMessage = {};
  } else {
    demand(match.phase === 'active', 'Both people must shake paws first.');
    if (action === 'say') {
      demand(typeof args.text === 'string' && args.text.trim().length > 0 && args.text.length <= 600, 'Yaps need 1–600 characters.');
      demand(now - (match.lastMessage[participant] || 0) >= 1000, 'One yap per second. Let the other cat breathe.');
      match.messages.push({ id: crypto.randomUUID(), participant, channel, text: args.text.trim(), at: now });
      match.messages = match.messages.slice(-60); match.lastMessage[participant] = now;
    } else if (action === 'game') {
      demand(!match.game || match.game.winner !== null, 'The current game is still going.');
      match.game = { id: crypto.randomUUID(), cells: Array(9).fill(null), turn: match.members[0].id, winner: null, moves: 0 };
    } else if (action === 'move') {
      const game = match.game;
      demand(game && args.gameId === game.id, 'Refresh: that board is no longer current.');
      demand(game.winner === null && game.turn === participant, 'Wait for your turn.');
      demand(Number.isInteger(args.cell) && args.cell >= 0 && args.cell <= 8 && game.cells[args.cell] === null, 'Choose an empty square from 0 to 8.');
      game.cells[args.cell] = participant; game.moves++;
      if (wins.some((line) => line.every((cell) => game.cells[cell] === participant))) game.winner = participant;
      else if (game.moves === 9) game.winner = 'draw';
      else game.turn = match.members.find((m) => m.id !== participant).id;
    } else throw new CatError('Unknown cat action.');
  }
  match.recent[key] = fingerprint;
  // Bound retry history along with the ephemeral match. Clients must not replay old turns.
  for (const old of Object.keys(match.recent).slice(0, -128)) delete match.recent[old];
  match.revision++;
}
