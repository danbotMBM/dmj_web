/* ════════════════════════════════════════════════════════════
   AUDIO  — two independent voices (sources A & B), each with its
   own song + direct + permeate chains. A single echo processor
   taps the COMBINED dry signal of both voices.
   ════════════════════════════════════════════════════════════ */
export const Audio = (() => {
  let ctx = null;
  let master = null;      // overall output gain
  let drySum = null;      // scaled direct outputs of both voices sum here → echo send
  let started = false;
  const PLACE_R = 2.2;    // metres from listener for spatial placement

  // ── two distinct songs (semitone offsets from A3=220Hz), null = rest ──
  const A3 = 220;
  const SONGS = {
    a: {
      // gentle major-ish phrase, triangle lead
      notes: [
        0, 3, 7, 10,  7, 3,  5, null,
        0, 3, 7, 12,  10, 7,  3, null,
        -2, 3, 5, 7,  5, 3,  0, null,
        -5, 0, 3, 7,  3, 0,  -2, null,
      ],
      bpm: 96, wave: 'triangle', tonic: 0,
    },
    b: {
      // darker, sparser minor-pentatonic riff at a different tempo, square wave
      notes: [
        -5, null, -2, 0,  null, 3, -2, null,
        -7, null, -5, -2,  0, null, -2, null,
        2, null, 0, -2,  -5, null, -7, null,
        -10, null, -7, -5,  null, -2, -5, null,
      ],
      bpm: 72, wave: 'sawtooth', tonic: -5,
    },
  };

  function midiHz(semis) { return A3 * Math.pow(2, semis / 12); }

  // ── per-voice graph + scheduler ──
  function makeVoice(key) {
    const song = SONGS[key];
    const step = 60 / song.bpm / 2;          // eighth notes
    const v = {
      key, song, step,
      noteBus: null, directGain: null, panner: null,
      permeateGain: null, permeateLP: null, permeatePanner: null,
      nextNoteTime: 0, idx: 0,
    };

    v.build = () => {
      v.noteBus = ctx.createGain(); v.noteBus.gain.value = 1.0;

      // direct chain
      v.directGain = ctx.createGain(); v.directGain.gain.value = 0.0;
      v.panner = mkPanner();
      v.noteBus.connect(v.directGain);
      v.directGain.connect(v.panner);
      v.panner.connect(master);

      // permeate chain (separate muffled stream)
      v.permeateGain = ctx.createGain(); v.permeateGain.gain.value = 0.0;
      v.permeateLP = ctx.createBiquadFilter();
      v.permeateLP.type = 'lowpass'; v.permeateLP.frequency.value = 20000; v.permeateLP.Q.value = 0.7;
      v.permeatePanner = mkPanner();
      v.noteBus.connect(v.permeateGain);
      v.permeateGain.connect(v.permeateLP);
      v.permeateLP.connect(v.permeatePanner);
      v.permeatePanner.connect(master);

      // feed the echo bus from the SCALED directional output, so each source
      // contributes to the echo in proportion to how loudly it actually
      // reaches the player (quiet/distant source → quiet echo).
      v.directGain.connect(drySum);
    };

    v.scheduleNote = (semis, time) => {
      if (semis == null) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = song.wave;
      osc.frequency.value = midiHz(semis);
      const peak = 0.2, dur = v.step * 1.6;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(peak, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      const sub = ctx.createOscillator();
      sub.type = 'sine'; sub.frequency.value = midiHz(semis - 12);
      const subG = ctx.createGain(); subG.gain.value = 0.45;
      sub.connect(subG); subG.connect(g);
      osc.connect(g); g.connect(v.noteBus);
      osc.start(time); sub.start(time);
      osc.stop(time + dur + 0.05); sub.stop(time + dur + 0.05);
    };

    v.pump = () => {
      const AHEAD = 0.12;
      while (v.nextNoteTime < ctx.currentTime + AHEAD) {
        v.scheduleNote(song.notes[v.idx % song.notes.length], v.nextNoteTime);
        v.nextNoteTime += v.step;
        v.idx++;
      }
    };

    v.start = () => { v.nextNoteTime = ctx.currentTime + 0.05; v.idx = 0; };

    // apply direct ray result for this voice
    v.applyDirect = (r) => {
      if (!v.directGain) return;
      const t = ctx.currentTime;
      v.directGain.gain.setTargetAtTime(r.volume, t, 0.04);
      place(v.panner, r.dir, t);
    };
    v.silenceDirect = () => v.directGain && v.directGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);

    // apply permeate ray result for this voice
    v.applyPermeate = (r) => {
      if (!v.permeateGain) return;
      const t = ctx.currentTime;
      v.permeateGain.gain.setTargetAtTime(r.through * 0.85, t, 0.06);
      const fc = 18000 * Math.pow(350 / 18000, r.muffle);
      v.permeateLP.frequency.setTargetAtTime(fc, t, 0.06);
      place(v.permeatePanner, r.dir, t);
    };
    v.silencePermeate = () => v.permeateGain && v.permeateGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);

    return v;
  }

  function mkPanner() {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 1; p.maxDistance = 30; p.rolloffFactor = 1;
    return p;
  }
  function place(p, dir, t) {
    const px = dir.x * PLACE_R, pz = dir.y * PLACE_R;
    if (p.positionX) {
      p.positionX.setTargetAtTime(px, t, 0.05);
      p.positionY.setTargetAtTime(0, t, 0.05);
      p.positionZ.setTargetAtTime(pz, t, 0.05);
    } else { p.setPosition(px, 0, pz); }
  }

  const voices = {};

  // ── single echo processor on the COMBINED dry signal ──
  let echoDelay = null, echoFeedback = null, echoGain = null, echoPanner = null;
  let _echoDelayTarget = 0.18;
  const ECHO_STEP = 0.04, ECHO_DEADBAND = 0.05;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.85;
      drySum = ctx.createGain(); drySum.gain.value = 1.0;

      voices.a = makeVoice('a'); voices.a.build();
      voices.b = makeVoice('b'); voices.b.build();

      // echo taps the combined dry sum
      echoDelay = ctx.createDelay(2.0); echoDelay.delayTime.value = 0.18;
      echoFeedback = ctx.createGain(); echoFeedback.gain.value = 0.0;
      echoGain = ctx.createGain(); echoGain.gain.value = 0.0;
      echoPanner = mkPanner();
      drySum.connect(echoDelay);
      echoDelay.connect(echoFeedback); echoFeedback.connect(echoDelay);
      echoDelay.connect(echoGain);
      echoGain.connect(echoPanner);
      echoPanner.connect(master);

      master.connect(ctx.destination);

      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0;
        L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
        L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
      } else {
        L.setPosition(0, 0, 0); L.setOrientation(0, 0, -1, 0, 1, 0);
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  let schedTimer = null;
  function play() {
    ensure();
    if (started) return;
    started = true;
    voices.a.start(); voices.b.start();
    schedTimer = setInterval(() => { voices.a.pump(); voices.b.pump(); }, 25);
  }
  function stop() {
    started = false;
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  }
  function isPlaying() { return started; }

  // per-voice direct/permeate dispatch
  function applyDirect(key, r)    { voices[key] && voices[key].applyDirect(r); }
  function silenceDirect(key)     { voices[key] && voices[key].silenceDirect(); }
  function applyPermeate(key, r)  { voices[key] && voices[key].applyPermeate(r); }
  function silencePermeate(key)   { voices[key] && voices[key].silencePermeate(); }

  // echo on combined signal
  function applyEcho(r) {
    if (!echoGain) return;
    const t = ctx.currentTime;
    const wanted = Math.max(0.06, Math.min(0.9, r.delay));
    const snapped = Math.round(wanted / ECHO_STEP) * ECHO_STEP;
    if (Math.abs(snapped - _echoDelayTarget) > ECHO_DEADBAND) {
      _echoDelayTarget = snapped;
      echoGain.gain.setTargetAtTime(0.0001, t, 0.02);
      echoDelay.delayTime.setValueAtTime(_echoDelayTarget, t + 0.04);
      echoGain.gain.setTargetAtTime(r.magnitude * 0.5, t + 0.07, 0.08);
    } else {
      echoGain.gain.setTargetAtTime(r.magnitude * 0.5, t, 0.1);
    }
    echoFeedback.gain.setTargetAtTime(Math.min(0.42, r.magnitude * 0.5), t, 0.12);
    place(echoPanner, r.dir, t);
  }
  function silenceEcho() {
    if (!echoGain) return;
    const t = ctx.currentTime;
    echoGain.gain.setTargetAtTime(0, t, 0.1);
    echoFeedback.gain.setTargetAtTime(0, t, 0.1);
  }

  return {
    ensure, play, stop, isPlaying,
    applyDirect, silenceDirect, applyPermeate, silencePermeate,
    applyEcho, silenceEcho,
  };
})();
