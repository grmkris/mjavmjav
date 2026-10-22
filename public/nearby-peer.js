// No STUN/TURN or signalling service: both peers must be reachable on the LAN.
const PREFIX = 'MJAV1:';
const MAX_SIGNAL = 2400;

export async function encodeSignal(signal) {
  const source = new Blob([JSON.stringify(signal)]).stream();
  const bytes = new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const text = PREFIX + btoa(String.fromCharCode(...bytes));
  if (text.length > MAX_SIGNAL) throw new Error('Pairing code is too large. Disable VPNs and unused network adapters, then pair again.');
  return text;
}

export async function decodeSignal(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX) || text.length > MAX_SIGNAL) throw new Error('Scan a nearby-play QR code from the other phone.');
  try {
    const bytes = Uint8Array.from(atob(text.slice(PREFIX.length)), (c) => c.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16000) throw new Error('Oversized signal');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const signal = JSON.parse(await new Blob(chunks).text());
    if (!/^[a-f0-9-]{36}$/.test(signal.id) || !['offer', 'answer'].includes(signal.type) || typeof signal.sdp !== 'string' || !signal.sdp.startsWith('v=0\r\n') || !signal.sdp.includes('a=candidate:')) throw new Error('Invalid signal');
    return signal;
  } catch { throw new Error('That pairing code is damaged or has no local network address. Pair again on the same Wi-Fi.'); }
}

export class NearbyPeer {
  constructor({ onStatus, onMessage, onOpen, Peer = globalThis.RTCPeerConnection }) {
    this.callbacks = { onStatus, onMessage, onOpen }; this.Peer = Peer;
    this.status = 'idle'; this.generation = 0;
  }
  setStatus(status, detail = '') { this.status = status; this.callbacks.onStatus(status, detail); }
  reset() {
    this.generation++;
    clearTimeout(this.deadline); clearInterval(this.heartbeat);
    this.channel?.close(); this.pc?.close(); this.pc = null; this.channel = null;
  }
  close() { this.reset(); this.setStatus('idle'); }
  fail(detail = 'Connection dropped. Both cats must pair again.') {
    if (!this.pc) return;
    this.reset(); this.setStatus('disconnected', detail);
  }
  create(role) {
    this.reset(); this.role = role;
    const pc = this.pc = new this.Peer({ iceServers: [] });
    const generation = this.generation;
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc === pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.fail();
    });
    pc.addEventListener('datachannel', ({ channel }) => {
      if (role !== 'guest' || this.channel || channel.label !== 'mjav-nearby-v1') { channel.close(); return; }
      this.attach(channel, generation);
    });
    this.setStatus('gathering', 'Making a local pairing code…');
    return { pc, generation };
  }
  attach(channel, generation) {
    this.channel = channel;
    channel.addEventListener('open', () => {
      if (generation !== this.generation) return;
      clearTimeout(this.deadline); this.lastSeen = Date.now();
      this.setStatus('connected', 'Two nearby cats connected.'); this.callbacks.onOpen();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastSeen > 8000) this.fail();
        else this.send({ type: 'ping' });
      }, 1000);
    });
    channel.addEventListener('message', ({ data }) => {
      if (generation !== this.generation || typeof data !== 'string' || data.length > 16000) return;
      let message; try { message = JSON.parse(data); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      this.lastSeen = Date.now();
      if (message.type === 'ping') this.send({ type: 'pong' });
      else if (message.type !== 'pong') this.callbacks.onMessage(message);
    });
    for (const event of ['close', 'error']) channel.addEventListener(event, () => { if (generation === this.generation) this.fail(); });
  }
  send(message) {
    if (this.channel?.readyState !== 'open') return false;
    // Do not queue unbounded snapshots on a stalled connection.
    if (this.channel.bufferedAmount > 64000) { this.fail(); return false; }
    try { this.channel.send(JSON.stringify(message)); return true; } catch { this.fail(); return false; }
  }
  async localCode(pc, generation) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('No local address found. Check Wi-Fi and pair again.')), 6000);
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      function finish(error) { clearTimeout(timeout); pc.removeEventListener('icegatheringstatechange', check); error ? reject(error) : resolve(); }
      pc.addEventListener('icegatheringstatechange', check); check();
    });
    if (generation !== this.generation) throw new Error('Pairing cancelled.');
    if (!pc.localDescription.sdp.includes('a=candidate:')) throw new Error('No local address found. Check Wi-Fi and pair again.');
    const code = await encodeSignal({ id: this.id, type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    if (generation !== this.generation) throw new Error('Pairing cancelled.');
    return code;
  }
  async host() {
    const { pc, generation } = this.create('host'); this.id = crypto.randomUUID();
    this.attach(pc.createDataChannel('mjav-nearby-v1', { ordered: true }), generation);
    await pc.setLocalDescription(await pc.createOffer());
    const code = await this.localCode(pc, generation);
    if (generation === this.generation) this.setStatus('offer', 'Let your friend scan this code. Then scan their reply.');
    return code;
  }
  async accept(text) {
    const initialGeneration = this.generation;
    const signal = await decodeSignal(text);
    if (initialGeneration !== this.generation) throw new Error('Pairing cancelled.');
    if (signal.type === 'offer') {
      if (this.status !== 'idle' && this.status !== 'disconnected') throw new Error('Already pairing. Tap pair again first.');
      const { pc, generation } = this.create('guest'); this.id = signal.id;
      await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
      if (generation !== this.generation) throw new Error('Pairing cancelled.');
      await pc.setLocalDescription(await pc.createAnswer());
      const code = await this.localCode(pc, generation);
      if (generation === this.generation) this.setStatus('answer', 'Show this reply to the first phone. They scan it to connect.');
      if (generation === this.generation) this.connectDeadline();
      return code;
    }
    if (this.role !== 'host' || this.status !== 'offer' || signal.id !== this.id) throw new Error('This reply belongs to a different pair. Scan your friend’s current reply.');
    const pc = this.pc, generation = this.generation;
    this.setStatus('connecting', 'Connecting on your local network…');
    await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    if (generation !== this.generation) throw new Error('Pairing cancelled.');
    this.connectDeadline();
    return null;
  }
  connectDeadline() {
    if (this.status === 'connected') return;
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this.fail('Could not connect within 30 seconds. Check the same Wi-Fi or hotspot; guest networks may block nearby devices. Pair again.'), 30000);
  }
}
