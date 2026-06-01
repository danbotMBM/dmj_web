// AudioWorklet processors for the voice-chat page.
//
// Two processors run inside the AudioContext's audio-rendering thread (16 kHz,
// mono, fixed 128-sample render quanta):
//
//   vc-capture  — accumulates mic samples into 320-sample (20 ms) frames,
//                 runs a simple energy-based voice-activity gate, and posts
//                 each open-gate frame to the main thread as int16 PCM.
//   vc-playback — buffers int16 PCM frames received from the main thread and
//                 streams them to the speakers, playing silence on underrun.
//
// The AudioContext is created at 16 kHz on the main thread, so the browser
// resamples the mic to our wire rate for free and no resampling is needed here.

const FRAME = 320; // samples per 20 ms frame at 16 kHz

// Voice-activity detection: open the gate when frame RMS exceeds THRESH, and
// keep it open for HANGOVER frames afterwards so word endings aren't clipped.
const VAD_THRESH = 0.012;
const VAD_HANGOVER = 8; // ~160 ms

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(FRAME);
    this.n = 0;
    this.hold = 0;
    this.forceMuted = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "mute") this.forceMuted = !!e.data.muted;
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n < FRAME) continue;
      this.n = 0;

      // Frame RMS for the gate + the main-thread level meter.
      let sum = 0;
      for (let j = 0; j < FRAME; j++) sum += this.buf[j] * this.buf[j];
      const rms = Math.sqrt(sum / FRAME);

      let open;
      if (this.forceMuted) {
        open = false;
        this.hold = 0;
      } else if (rms > VAD_THRESH) {
        open = true;
        this.hold = VAD_HANGOVER;
      } else if (this.hold > 0) {
        open = true;
        this.hold--;
      } else {
        open = false;
      }

      if (open) {
        const pcm = new Int16Array(FRAME);
        for (let j = 0; j < FRAME; j++) {
          let v = Math.max(-1, Math.min(1, this.buf[j]));
          pcm[j] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        this.port.postMessage({ rms, speaking: true, pcm: pcm.buffer }, [pcm.buffer]);
      } else {
        this.port.postMessage({ rms, speaking: false });
      }
    }
    return true;
  }
}

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.cur = null;
    this.pos = 0;
    this.port.onmessage = (e) => {
      this.queue.push(new Int16Array(e.data));
      // Cap the buffer so a backlog can't add unbounded latency (~1 s max).
      if (this.queue.length > 50) this.queue.splice(0, this.queue.length - 50);
    };
  }

  process(_, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (!this.cur || this.pos >= this.cur.length) {
        this.cur = this.queue.shift() || null;
        this.pos = 0;
      }
      out[i] = this.cur ? this.cur[this.pos++] / 0x8000 : 0;
    }
    return true;
  }
}

registerProcessor("vc-capture", CaptureProcessor);
registerProcessor("vc-playback", PlaybackProcessor);
