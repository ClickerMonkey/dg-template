# Audio: put music in a background worker

**Rule:** music and other continuous procedural audio are synthesized in a
**Web Worker** and streamed to the main thread as PCM chunks. The main thread
only queues finished buffers. Short one-shot sound effects may stay on the main
thread.

## Why

The tempting approach is to build every note from live Web Audio nodes
(oscillators, filters, gains) and schedule them from `setInterval` or
`requestAnimationFrame` on the main thread. On phones this breaks up:

- Game frames delay the scheduler, so notes arrive late or get skipped.
- Dozens of live nodes overload the real-time audio thread.

Dino Dasher shipped like this and its music stuttered on phones. Moving the
synth into a worker fixed it. A 170 ms chunk took about 2–13 ms to render on a
laptop, and a 90-second test run had zero gaps.

**Not AudioWorklet.** It needs a secure context (HTTPS or localhost), so it
silently fails on the `http://192.168.x.x` LAN URLs used for phone testing.
Plain Web Workers work everywhere.

## Architecture

```
src/audio/musicWorker.ts  (Web Worker)          src/audio/musicStream.ts  (main thread)
  composer ─► software synth ─► Float32 PCM ──►  AudioBufferSourceNode queue, ~2.5 s ahead
  (notes)     (oscillators, envelopes,           chunks start back-to-back on sample boundaries
               filters, reverb in JS)            mainGain / layerGain ─► your output chain
```

- **Chunks:** a fixed size (e.g. 8192 frames ≈ 0.17 s at 48 kHz). Transfer the
  arrays (`postMessage(msg, [buf.buffer])`) instead of copying them.
- **Queue:** keep about 2–3 s scheduled ahead, with up to ~4 requests in flight.
  A janky main thread then can't cause gaps.
- **Instant controls stay on the main thread:** master/music volume, pause/duck,
  and any layer that must react immediately (e.g. a danger stem). Render those as
  separate stems with their own `GainNode`. Tempo, mood and similar parameters
  are messages to the worker; their ~2 s latency is fine.
- **Render at `ctx.sampleRate`.** Mismatched rates make chunk seams click.
- **Degrade, don't drop out.** If a chunk takes more than about half its
  real-time budget, cap voices and skip low-priority notes.
- **Shared code:** the same renderer class can run synchronously for offline
  previews and audio tests, and as a main-thread fallback if `Worker` fails.
- **Lifecycle:** create and resume the `AudioContext` on every user gesture
  (iOS), suspend it when `document.hidden`, and re-align the queue after a
  resume (count an underrun).

## Skeleton (drop-in)

`src/audio/musicWorker.ts`: replace `renderInto` with your composer and synth.

```ts
let sr = 48000, pos = 0;           // stream position (frames)
let tempo = 120;
const voices: { start: number; f: number; amp: number; dur: number; ph: number }[] = [];

function compose(untilFrame: number): void {
  // schedule notes up to `untilFrame` (example: a quarter-note pulse)
  const step = Math.round((60 / tempo) * sr);
  while (nextNote < untilFrame) {
    voices.push({ start: nextNote, f: 220 * 2 ** (Math.floor(Math.random() * 5) / 12), amp: 0.15, dur: step * 0.9, ph: 0 });
    nextNote += step;
  }
}
let nextNote = 0;

function renderInto(L: Float32Array, R: Float32Array): void {
  const n = L.length;
  compose(pos + n);
  for (const v of voices) {
    for (let i = 0; i < n; i++) {
      const t = pos + i - v.start;
      if (t < 0 || t >= v.dur) continue;
      const env = Math.min(1, t / 200) * (1 - t / v.dur);
      const x = Math.sin(v.ph) * v.amp * env;
      v.ph += (2 * Math.PI * v.f) / sr;
      L[i] += x; R[i] += x;
    }
  }
  for (let i = voices.length - 1; i >= 0; i--) if (pos + n - voices[i].start >= voices[i].dur) voices.splice(i, 1);
  pos += n;
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') sr = m.sr;
  else if (m.type === 'params') tempo = m.tempo ?? tempo;
  else if (m.type === 'render') {
    const L = new Float32Array(m.frames), R = new Float32Array(m.frames);
    renderInto(L, R);
    (self as unknown as Worker).postMessage({ type: 'chunk', frames: m.frames, L, R }, [L.buffer, R.buffer]);
  }
};
```

`src/audio/musicStream.ts`: the main-thread queue.

```ts
const CHUNK = 8192, AHEAD = 2.5, MAX_INFLIGHT = 4;

export class MusicStream {
  readonly gain: GainNode;
  private worker = new Worker(new URL('./musicWorker.ts', import.meta.url), { type: 'module' });
  private next = 0;
  private inflight = 0;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.gain = ctx.createGain();
    this.gain.connect(dest);
    this.worker.onmessage = (e) => this.receive(e.data);
    this.worker.postMessage({ type: 'init', sr: ctx.sampleRate });
  }

  params(p: { tempo?: number }): void { this.worker.postMessage({ type: 'params', ...p }); }

  /** Call often (e.g. every 50–100 ms from setInterval). Cheap. */
  tick(): void {
    const c = this.ctx;
    if (c.state !== 'running') return;
    const now = c.currentTime, dur = CHUNK / c.sampleRate;
    if (this.next < now + 0.02) this.next = Math.ceil((now + 0.08) * c.sampleRate) / c.sampleRate;
    while (this.inflight < MAX_INFLIGHT && this.next + this.inflight * dur < now + AHEAD) {
      this.inflight++;
      this.worker.postMessage({ type: 'render', frames: CHUNK });
    }
  }

  private receive(m: { frames: number; L: Float32Array; R: Float32Array }): void {
    this.inflight--;
    const c = this.ctx;
    if (this.next < c.currentTime + 0.005) this.next = Math.ceil((c.currentTime + 0.03) * c.sampleRate) / c.sampleRate;
    const buf = c.createBuffer(2, m.frames, c.sampleRate);
    buf.copyToChannel(m.L as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(m.R as Float32Array<ArrayBuffer>, 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start(this.next);
    src.onended = () => src.disconnect();
    this.next += m.frames / c.sampleRate;
  }
}
```

Vite bundles the worker automatically. `new URL(..., import.meta.url)` keeps
paths relative, so it works under `/<slug>/` with `base: './'`.

## A fuller reference

Dino Dasher (`diffenderfer-games/dinodasher`) has a complete version:

- `src/audio/dsp/synth.ts`: a sample-level synth with table sine, polyBLEP saw,
  noise, Web Audio-style envelopes and automation, RBJ biquads and an FDN reverb.
- `src/audio/dsp/instruments.ts`: instruments as data.
- `src/audio/music.ts`: a DOM-free composer.
- `src/audio/musicRender.ts`: the renderer shared by the worker, the fallback
  and offline tests.
- `src/audio/musicWorker.ts` and `src/audio/musicStream.ts`: the worker and the
  main-thread queue, with a danger stem, voice shedding and underrun counting.

## Checklist

- [ ] Music/loops render in a Worker; the main thread only queues buffers.
- [ ] Volume, pause and urgent layers respond instantly on the main thread.
- [ ] The context unlocks on a gesture and suspends when hidden.
- [ ] Tested on a phone with a production build over the LAN: no gaps under load.
