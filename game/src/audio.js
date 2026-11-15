// All sound is synthesized with WebAudio — no audio files. One shared noise buffer,
// short envelopes, and a master gain kept modest. Every call is safe before the first
// user gesture: the context resumes lazily and failures are swallowed.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(dur, filterFreq, gainPeak, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gainPeak, type = 'square', slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      // Layered crack + body; heavier weapons get a lower thump.
      const heavy = kind === 'rifle' || kind === 'dmr';
      noise(heavy ? 0.16 : 0.1, heavy ? 2600 : 3600, heavy ? 0.5 : 0.32, 'lowpass');
      tone(heavy ? 120 : 160, 0.09, 0.28, 'triangle', 45);
    },
    botShot(dist) {
      const vol = Math.max(0.03, 0.3 - dist * 0.006);
      noise(0.12, 1500, vol, 'lowpass');
    },
    emptyClick() { tone(1400, 0.03, 0.08, 'square'); },
    reloadStart() { noise(0.06, 3000, 0.15, 'bandpass'); tone(500, 0.05, 0.06, 'square'); },
    reloadEnd() { noise(0.05, 3800, 0.18, 'bandpass', 0); tone(760, 0.05, 0.07, 'square'); },
    hitmarker(kill) {
      tone(kill ? 1560 : 1180, 0.06, 0.16, 'square');
      if (kill) tone(1560, 0.09, 0.14, 'square', null, 0.05);
    },
    hurt() { tone(140, 0.14, 0.3, 'sawtooth', 70); noise(0.1, 700, 0.2); },
    step(run) { noise(0.05, run ? 500 : 380, 0.05); },
    grenadeThrow() { noise(0.12, 900, 0.08, 'bandpass'); },
    explosion() {
      noise(0.7, 300, 0.9, 'lowpass');
      tone(70, 0.55, 0.5, 'sine', 30);
    },
    plantBeep(final) {
      tone(final ? 1320 : 880, final ? 0.22 : 0.08, 0.14, 'square');
    },
    defuseTick() { tone(1040, 0.05, 0.1, 'square'); },
    buy() { tone(920, 0.06, 0.12, 'square'); tone(1380, 0.08, 0.12, 'square', null, 0.06); },
    denied() { tone(220, 0.12, 0.14, 'square', 160); },
    roundWin() { tone(660, 0.12, 0.14, 'triangle'); tone(880, 0.16, 0.14, 'triangle', null, 0.11); },
    roundLose() { tone(392, 0.14, 0.14, 'triangle'); tone(311, 0.2, 0.14, 'triangle', null, 0.12); },
    matchEnd(win) {
      if (win) { tone(660, 0.15, 0.14, 'triangle'); tone(880, 0.15, 0.14, 'triangle', null, 0.14); tone(1100, 0.3, 0.16, 'triangle', null, 0.28); }
      else { tone(392, 0.18, 0.14, 'triangle'); tone(330, 0.18, 0.14, 'triangle', null, 0.16); tone(262, 0.34, 0.16, 'triangle', null, 0.32); }
    },
  };
}
