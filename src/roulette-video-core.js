import { demand, matchView } from './roulette-core.js';

export const VIDEO_LEASE_MS = 20_000;
export const validSession = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);

// Separate from the model-visible match: SDP and ICE credentials never enter chat state.
export function videoAction(match, video, participant, sessionId, action, args, now) {
  const view = matchView(match, participant, now);
  demand(view.phase === 'active', 'This pawshake ended. Return to Roulette to meet another cat.');
  demand(validSession(sessionId), 'Invalid camera session.');
  for (const [id, session] of Object.entries(video)) if (session.seen + VIDEO_LEASE_MS <= now) delete video[id];
  if (action === 'open') {
    demand(!video[participant] || video[participant].id === sessionId, 'Your camera is open in another tab. Stop it there or wait 20 seconds.');
    video[participant] ||= { id: sessionId, seen: now, description: null, count: 0, window: now };
  }
  const self = video[participant];
  if (action === 'close') {
    if (self?.id === sessionId) delete video[participant];
    return { closed: true };
  }
  demand(self?.id === sessionId, 'Camera session ended. Tap Share camera to reconnect.');
  if (now - self.window >= 1000) { self.window = now; self.count = 0; }
  demand(++self.count <= 12, 'Too many camera updates. Try again shortly.');
  self.seen = now;
  const peerId = match.members.find((m) => m.id !== participant).id;
  const peer = video[peerId];
  const initiator = match.members[0].id === participant;
  if (action === 'signal') {
    demand(peer && args.peerSession === peer.id, 'The other camera changed. Reconnect.');
    demand(args.description?.type === (initiator ? 'offer' : 'answer'), 'Unexpected camera negotiation.');
    demand(typeof args.description.sdp === 'string' && args.description.sdp.startsWith('v=0') && args.description.sdp.length <= 24_000, 'Invalid camera description.');
    self.description = { target: peer.id, type: args.description.type, sdp: args.description.sdp };
  } else demand(['open', 'poll'].includes(action), 'Unknown camera action.');
  const description = peer?.description?.target === sessionId ? peer.description : null;
  return { sessionId, initiator, expires: match.expires,
    peer: peer ? { sessionId: peer.id, name: match.members.find((m) => m.id === peerId).name } : null,
    description: description ? { type: description.type, sdp: description.sdp } : null };
}
