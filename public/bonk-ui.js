import { cellDistance, cellName, canStep } from './game-core.js';

export function createBonkUI({ getWorld, getPlayer, isPaused, submit, sound }) {
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
  let key = '', draft, pending = false, confirmed = false, acknowledgement = '', lastReveal = '', lastUpdate = '';
  let rosterKey = '';
  const buttons = Array.from({ length: 36 }, (_, cell) => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.cell = cell;
    button.tabIndex = cell ? -1 : 0;
    button.addEventListener('click', () => {
      const world = getWorld(), player = getPlayer();
      if (!canPlan(world, player)) return;
      if (draft.tool === 'move') {
        if (!canStep(cell, player.cell)) { text('bonk-plan', 'Tiny legs. Pick your tile or one next to it, diagonals too.'); return; }
        draft.move = cell;
      } else draft.target = cell;
      acknowledgement = ''; update();
    });
    button.addEventListener('keydown', (event) => {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -6, ArrowDown: 6 };
      if (!(event.key in offsets)) return;
      event.preventDefault();
      const next = cell + offsets[event.key];
      if (next < 0 || next >= 36 || cellDistance(next, cell) !== 1) return;
      button.tabIndex = -1; buttons[next].tabIndex = 0; buttons[next].focus();
    });
    $('bonk-map').append(button);
    return button;
  });
  function canPlan(world, player) {
    return !isPaused() && world?.mode === 'bonk' && world.phase === 'playing' && world.turnPhase === 'plan' && player?.alive && !player.ready && !pending && !confirmed;
  }
  for (const tool of ['move', 'throw', 'shield']) $( `bonk-${tool}` ).addEventListener('click', () => {
    if (!canPlan(getWorld(), getPlayer())) return;
    draft.tool = tool === 'shield' ? 'move' : tool;
    if (tool === 'shield') draft.target = null;
    acknowledgement = ''; update();
  });
  $('bonk-lock').addEventListener('click', () => {
    const world = getWorld(), player = getPlayer();
    if (!canPlan(world, player) || (draft.target === null && !player.shields)) return;
    pending = true; acknowledgement = 'Sending your secret plan…';
    submit({ round: world.round, turn: world.turn, move: draft.move, target: draft.target });
    update();
  });
  function ack(message) {
    const world = getWorld();
    if (message.round !== world.round || message.turn !== world.turn) return;
    pending = false;
    confirmed = message.accepted;
    acknowledgement = message.accepted ? 'Plan locked. The other cats cannot see it.' : 'That plan missed the turn. Choose again if there’s time.';
    if (message.accepted) sound('blep');
    update();
  }
  function update() {
    const world = getWorld(), player = getPlayer();
    const visible = world?.mode === 'bonk' && world.phase !== 'over' && world.players.length > 0;
    if (!visible) {
      if (lastUpdate !== 'hidden') for (const id of ['bonk-map', 'bonk-controls', 'bonk-cats']) $(id).hidden = true;
      lastUpdate = 'hidden'; key = ''; return;
    }
    const nextKey = `${world.round}:${world.turn}:${player?.id || 'spectator'}`;
    if (nextKey !== key) {
      key = nextKey; pending = false; confirmed = false; acknowledgement = '';
      draft = { move: player?.cell ?? 0, target: null, tool: 'move' };
      for (const button of buttons) button.tabIndex = Number(button.dataset.cell) === draft.move ? 0 : -1;
    }
    if (player?.ready) { pending = false; confirmed = true; }
    const updateKey = JSON.stringify([nextKey, world.phase, world.turnPhase, Math.ceil(world.turnRemaining), world.players.map(({ id, cell, hp, shields, alive, ready, damage }) => [id, cell, hp, shields, alive, ready, damage]), isPaused(), draft, pending, confirmed, acknowledgement]);
    if (lastUpdate === updateKey) return;
    lastUpdate = updateKey;
    for (const id of ['bonk-map', 'bonk-controls', 'bonk-cats']) $(id).hidden = false;
    const allowed = canPlan(world, player);
    $('bonk-move').disabled = !allowed; $('bonk-throw').disabled = !allowed;
    $('bonk-shield').disabled = !allowed || !player.shields;
    $('bonk-lock').disabled = !allowed || (draft.target === null && !player.shields);
    $('bonk-move').setAttribute('aria-pressed', String(draft.tool === 'move'));
    $('bonk-throw').setAttribute('aria-pressed', String(draft.tool === 'throw'));
    $('bonk-shield').setAttribute('aria-pressed', String(draft.target === null));
    text('bonk-shield', `shield (${player?.shields ?? 0})`);
    text('bonk-lock', player?.ready || confirmed ? 'plan locked ✓' : pending ? 'sending…' : 'lock my plan');
    text('bonk-status', isPaused() ? 'Cat nap. Resume to keep plotting.' : world.phase === 'countdown' ? 'Meet the other cats. Plot something rude.' : world.turnPhase === 'reveal' ? 'The fish have landed.' : !player ? 'Watching the catfight' : !player.alive ? 'You’re out. Spectate and send a honk.' : `Turn ${world.turn}/8 · ${Math.ceil(world.turnRemaining)}s · ${player.hp} hearts`);
    const action = draft.target === null ? (player?.shields ? 'shield' : 'choose a fish target') : `fish at ${cellName(draft.target)}`;
    text('bonk-plan', !player ? 'Watch the plans unfold. Tap play next round to join the map.' : !player.alive ? 'Your cat has been thoroughly bonked. Watch the survivors.' : world.turnPhase === 'reveal' ? world.events.join(' ') : acknowledgement || (player?.ready ? 'Plan locked. The other cats cannot see it.' : `Move to ${cellName(draft.move)} + ${action}. Then lock it.`));
    const revealKey = `${world.round}:${world.turn}`;
    if (world.turnPhase === 'reveal' && lastReveal !== revealKey) { lastReveal = revealKey; sound(player?.damage ? 'bonk' : 'honk'); }
    for (let cell = 0; cell < 36; cell++) {
      const cats = world.players.filter((cat) => cat.cell === cell);
      const label = `${cellName(cell)}${cats.length ? ': ' + cats.map((cat) => `${cat.name}${cat.id === player?.id ? ' (you)' : ''}, ${cat.hp} hearts`).join('; ') : ', empty'}`;
      if (buttons[cell].getAttribute('aria-label') !== label) buttons[cell].setAttribute('aria-label', label);
      buttons[cell].disabled = !allowed;
      buttons[cell].setAttribute('aria-pressed', String(cell === (draft.tool === 'move' ? draft.move : draft.target)));
    }
    const signature = JSON.stringify([world.turnPhase, world.players.map(({ id, name, hp, color, alive, ready }) => ({ id, name, hp, color, alive, ready }))]);
    if (signature !== rosterKey) {
      rosterKey = signature;
      $('bonk-cats').replaceChildren(...world.players.map((cat, i) => {
        const row = document.createElement('li');
        row.style.setProperty('--cat-color', cat.color);
        row.textContent = `${i + 1}. ${cat.id === player?.id ? 'You' : cat.name} · ${cat.alive ? '♥'.repeat(cat.hp) : 'out'}${cat.ready && world.turnPhase === 'plan' ? ' ✓' : ''}`;
        return row;
      }));
    }
  }
  return { update, ack, draft: () => draft };
}
