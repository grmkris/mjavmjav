export class CameraCall {
  constructor({ root, prepare, openExternal, standalone = false }) {
    this.root = root; this.prepare = prepare; this.openExternal = openExternal; this.standalone = standalone;
    this.epoch = 0; this.active = standalone; this.busy = false; this.running = false; this.peerId = null;
    this.remoteAudio = new Audio(); this.remoteAudio.autoplay = true; this.remoteAudio.muted = true;
    this.$ = (id) => root.querySelector(`[data-camera="${id}"]`);
    this.$('preview').onclick = () => this.preview();
    this.$('share').onclick = () => this.share();
    this.$('stop').onclick = () => this.stop('Camera off. The loaf has left the frame.');
    this.$('mic').onclick = () => this.microphone();
    this.$('sound').onclick = async () => {
      const audio = this.remoteAudio; audio.muted = !audio.muted;
      try { await audio.play(); } catch { audio.muted = true; }
      this.render();
    };
    this.$('external').onclick = () => this.external();
    this.$('external').hidden = standalone || !openExternal;
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop('Camera paused while this page is hidden. Preview again when you return.'); });
    window.addEventListener('pagehide', () => this.stop('Camera off.'));
    this.render();
  }
  message(text) { this.$('status').textContent = text; }
  setMatch(state) {
    const active = state?.status === 'active';
    if (this.matchId && (this.matchId !== state?.match?.id || !active)) this.stop('That connection ended. Camera and microphone are off.');
    this.matchId = state?.match?.id; this.active = active; this.render();
  }
  hostPermissions(capabilities) {
    const permissions = capabilities?.sandbox?.permissions;
    if (permissions && !permissions.camera) this.message('This host has not granted camera access. Try Preview camera, or open it in your browser after a pawshake.');
  }
  render() {
    this.$('preview').hidden = Boolean(this.stream);
    this.$('preview').disabled = this.busy;
    this.$('share').hidden = this.running || !this.stream;
    this.$('share').disabled = this.busy || !this.active;
    this.$('stop').hidden = !this.stream && !this.busy && !this.running;
    this.$('mic').hidden = !this.running;
    this.$('mic').disabled = this.busy;
    const mic = this.stream?.getAudioTracks().some((t) => t.enabled && t.readyState === 'live');
    this.$('mic').textContent = mic ? 'mute mic' : 'enable mic';
    this.$('mic').setAttribute('aria-pressed', String(Boolean(mic)));
    this.$('sound').hidden = !this.running;
    this.$('sound').textContent = this.remoteAudio.muted ? 'turn sound on' : 'mute sound';
    this.$('sound').setAttribute('aria-pressed', String(!this.remoteAudio.muted));
    this.$('external').disabled = this.busy || !this.active || this.running;
    this.$('local-empty').hidden = Boolean(this.stream);
    this.$('local-label').textContent = this.running ? 'you · sharing' : this.stream ? 'you · preview only' : 'you · camera off';
    this.$('remote-empty').hidden = Boolean(this.$('remote').srcObject);
  }
  async preview() {
    if (this.busy || this.stream) return;
    const epoch = this.epoch; this.busy = true; this.render();
    this.message('Allow camera access to see a private preview. Microphone stays off.');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable here. Open this camera in your browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 24 }, facingMode: 'user' }, audio: false });
      if (epoch !== this.epoch) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream; this.$('local').srcObject = stream;
      stream.getVideoTracks()[0].onended = () => this.stop('Camera disconnected. Preview again to reconnect.');
      await this.$('local').play();
      if (epoch === this.epoch) this.message(this.active ? 'Looking very loaf. This preview is only yours. Tap Share camera when ready.' : 'Camera works here. Shake paws with another cat before sharing.');
    } catch (error) {
      if (epoch === this.epoch) {
        this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.$('local').srcObject = null;
        this.message(error.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser, or use Open camera in browser after a pawshake.' : error.name === 'NotFoundError' ? 'No camera found. Connect one and try again.' : error.name === 'SecurityError' || /security origin/i.test(error.message) ? 'This embedded host cannot open a camera. Use Open camera in browser after a pawshake.' : error.message);
      }
    } finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  async request(action, extra = {}, grant = this.grant, keepalive = false) {
    const response = await fetch(grant.endpoint, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }),
      ...(keepalive ? { keepalive: true } : { signal: AbortSignal.timeout(9000) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Camera connection interrupted.');
    return result;
  }
  async share() {
    if (this.busy || this.running || !this.stream || !this.active) return;
    const epoch = this.epoch; this.busy = true; this.render(); this.message('Connecting your camera…');
    let grant;
    try {
      grant = await this.prepare(crypto.randomUUID());
      if (epoch !== this.epoch) return;
      this.grant = grant; this.config = await this.request('config');
      if (epoch !== this.epoch) return;
      const state = await this.request('open');
      if (epoch !== this.epoch) { this.request('close', {}, grant, true).catch(() => {}); return; }
      this.running = true; this.lastSuccess = Date.now();
      this.expiryTimer = setTimeout(() => this.stop('This camera connection expired.'), Math.max(0, grant.expires - Date.now()));
      this.watchdog = setInterval(() => { if (Date.now() - this.lastSuccess > 15_000) this.stop('Camera stopped because the connection was lost. Preview again to reconnect.'); }, 1000);
      await this.consume(state, epoch);
      this.schedule(epoch);
    } catch (error) { if (epoch === this.epoch) this.stop(error.message); }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  schedule(epoch) {
    if (!this.running || epoch !== this.epoch) return;
    this.timer = setTimeout(async () => {
      try {
        const state = await this.request('poll');
        if (epoch !== this.epoch) return;
        this.lastSuccess = Date.now(); await this.consume(state, epoch);
      } catch (error) { if (epoch === this.epoch) { this.stop(error.message); return; } }
      this.schedule(epoch);
    }, this.pc?.connectionState === 'connected' ? 2000 : 800);
  }
  closePeer() {
    this.pc?.close(); this.pc = null; this.peerId = null;
    this.audioSender = null; this.videoSender = null;
    this.$('remote').srcObject = null; this.$('remote').muted = true;
    this.remoteAudio.pause(); this.remoteAudio.srcObject = null; this.remoteAudio.muted = true;
    this.$('remote-label').textContent = 'other cat · camera off';
  }
  async consume(state, epoch) {
    if (epoch !== this.epoch || !this.running) return;
    if (this.peerId !== state.peer?.sessionId) this.closePeer();
    if (!state.peer) { this.message('Camera ready. Waiting for the other cat to share theirs.'); this.render(); return; }
    if (!this.pc) {
      this.peerId = state.peer.sessionId;
      const pc = this.pc = new RTCPeerConnection({ iceServers: this.config.iceServers, iceTransportPolicy: this.config.iceTransportPolicy });
      pc.ontrack = ({ track }) => {
        if (pc !== this.pc) return;
        // An audio transceiver with no sending microphone must not stall the video clock.
        const remote = track.kind === 'audio' ? this.remoteAudio : this.$('remote');
        remote.srcObject = new MediaStream([track]);
        remote.play().catch(() => { remote.muted = true; this.render(); }); this.render();
      };
      pc.onconnectionstatechange = () => {
        if (pc !== this.pc) return;
        if (pc.connectionState === 'connected') { this.message('Two cats. One extremely important video call.'); this.$('remote-label').textContent = `${state.peer.name} · live`; }
        if (pc.connectionState === 'failed') this.stop('Could not connect the cameras. Preview again to retry.');
        if (pc.connectionState === 'disconnected') this.message('Camera connection interrupted. Reconnecting…');
      };
      this.message('The other cat is here. Connecting cameras…');
      if (state.initiator) {
        this.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
        if (this.stream.getAudioTracks()[0]) await this.audioSender.replaceTrack(this.stream.getAudioTracks()[0]);
        this.videoSender = pc.addTransceiver(this.stream.getVideoTracks()[0], { direction: 'sendrecv', streams: [this.stream], sendEncodings: [{ maxBitrate: 600_000, maxFramerate: 24 }] }).sender;
        await this.describe(await pc.createOffer(), pc, epoch);
      }
    }
    const pc = this.pc;
    if (epoch !== this.epoch || !pc) return;
    if (state.description && !pc.remoteDescription) {
      await pc.setRemoteDescription(state.description);
      if (!state.initiator) {
        const audio = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
        const video = pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
        this.audioSender = audio?.sender;
        if (audio) { audio.direction = 'sendrecv'; if (this.stream.getAudioTracks()[0]) await audio.sender.replaceTrack(this.stream.getAudioTracks()[0]); }
        if (video) { this.videoSender = video.sender; await video.sender.replaceTrack(this.stream.getVideoTracks()[0]); video.direction = 'sendrecv'; }
        await this.describe(await pc.createAnswer(), pc, epoch);
        if (epoch === this.epoch && this.videoSender) {
          const parameters = this.videoSender.getParameters();
          for (const encoding of parameters.encodings || []) { encoding.maxBitrate = 600_000; encoding.maxFramerate = 24; }
          await this.videoSender.setParameters(parameters);
        }
      }
    }
    this.render();
  }
  async describe(description, pc, epoch) {
    await pc.setLocalDescription(description);
    if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('The camera relay took too long. Preview again to retry.')); }, 8000);
      const check = () => { if (pc.iceGatheringState === 'complete' || pc.signalingState === 'closed') { cleanup(); resolve(); } };
      const cleanup = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('signalingstatechange', check); };
      pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('signalingstatechange', check); check();
    });
    if (epoch !== this.epoch || pc !== this.pc) return;
    await this.request('signal', { peerSession: this.peerId, description: pc.localDescription.toJSON() });
  }
  async microphone() {
    if (this.busy || !this.running) return;
    const existing = this.stream.getAudioTracks()[0];
    if (existing) {
      existing.stop(); this.stream.removeTrack(existing); this.render();
      try { await this.audioSender?.replaceTrack(null); } catch { /* The connection may have closed while muting. */ }
      return;
    }
    const epoch = this.epoch; this.busy = true; this.render();
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (epoch !== this.epoch) { audio.getTracks().forEach((t) => t.stop()); return; }
      const track = audio.getAudioTracks()[0]; this.stream.addTrack(track);
      track.onended = () => { this.stream?.removeTrack(track); this.render(); };
      await this.audioSender?.replaceTrack(track);
    } catch { if (epoch === this.epoch) this.message('Microphone is unavailable or blocked. Your camera still works.'); }
    finally { if (epoch === this.epoch) { this.busy = false; this.render(); } }
  }
  stop(message) {
    this.epoch++; clearTimeout(this.timer); clearTimeout(this.expiryTimer); clearInterval(this.watchdog);
    const grant = this.grant; this.grant = null; this.running = false; this.busy = false;
    this.closePeer(); this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.$('local').srcObject = null;
    if (grant) this.request('close', {}, grant, true).catch(() => {});
    this.message(message); this.render();
  }
  async external() {
    if (this.busy || !this.active || this.running) return;
    const epoch = this.epoch; this.busy = true; this.render();
    try {
      const grant = await this.prepare(crypto.randomUUID());
      if (epoch !== this.epoch) return;
      const url = new URL('/roulette-camera', grant.endpoint);
      url.hash = new URLSearchParams({ token: grant.token, session: grant.sessionId, match: grant.matchId, expires: String(grant.expires) }).toString();
      // The fragment is never sent in an HTTP request or referrer.
      this.stop('Camera moved to your browser. Keep playing here.');
      await this.openExternal(url.href);
    } catch (error) { this.message(error.message); }
    finally { this.busy = false; this.render(); }
  }
}
