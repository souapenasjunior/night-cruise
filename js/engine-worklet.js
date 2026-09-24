// Engine sound generator: per-cylinder combustion pulses driven by crank angle,
// shaped by two exhaust/intake resonators. Timbre comes from the pulse train itself.
class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.p = { cyl: 8, uneven: 0.3, res: [95, 380], rad: [0.992, 0.975], mix: [1, 0.45], noise: 0.3, decay: 0.0035, diesel: 0, drive: 1.6 };
    this.phase = 0;
    this.fi = 0;
    this.env = 0;
    this.envN = 0;
    this.y = [0, 0, 0, 0];
    this.seed = 12345;
    this.hp = 0; this.hpx = 0;
    this.port.onmessage = e => { Object.assign(this.p, e.data); this.setup(); };
    this.setup();
  }
  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  setup() {
    const p = this.p;
    const h = i => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
    this.fire = [];
    for (let i = 0; i < p.cyl; i++) {
      const a = i / p.cyl + p.uneven * (h(i) - 0.5) * (0.6 / p.cyl);
      this.fire.push({ a: (a + 1) % 1, amp: 1 - p.uneven * 0.6 * h(i + 7) });
    }
    this.fire.sort((x, y) => x.a - y.a);
    this.coef = p.res.map((f, k) => {
      const r = p.rad[k], w = (2 * Math.PI * f) / sampleRate;
      const a1 = 2 * r * Math.cos(w), a2 = -r * r;
      // normalise so the resonance peak has unity gain
      const re = 1 - a1 * Math.cos(w) - a2 * Math.cos(2 * w), im = a1 * Math.sin(w) + a2 * Math.sin(2 * w);
      return { a1, a2, g: Math.hypot(re, im) };
    });
    this.decayK = Math.exp(-1 / (p.decay * sampleRate));
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0], load = params.load[0], gain = params.gain[0];
    const p = this.p, fire = this.fire, c = this.coef, y = this.y;
    const dphi = rpm / 120 / sampleRate; // one 4-stroke cycle = 2 crank revolutions
    const lvl = 0.22 + 0.78 * load;
    const drive = p.drive * (0.7 + 0.6 * load);
    for (let n = 0; n < out.length; n++) {
      this.phase += dphi;
      if (this.phase >= 1) { this.phase -= 1; this.fi = 0; }
      while (this.fi < fire.length && this.phase >= fire[this.fi].a) {
        const f = fire[this.fi++];
        // cycle-to-cycle variation makes it breathe like a real engine
        this.env = f.amp * lvl * (0.85 + 0.3 * this.rand());
        this.envN = this.env;
      }
      const nz = this.rand() * 2 - 1;
      const x = this.env * (1 - p.noise + p.noise * nz) + p.diesel * this.envN * nz * 0.8;
      this.env *= this.decayK;
      this.envN *= this.decayK * 0.9;
      const y0 = c[0].g * x + c[0].a1 * y[0] + c[0].a2 * y[1];
      y[1] = y[0]; y[0] = y0;
      const y1 = c[1].g * x + c[1].a1 * y[2] + c[1].a2 * y[3];
      y[3] = y[2]; y[2] = y1;
      let s = p.mix[0] * y0 + p.mix[1] * y1 + x * 0.15;
      // DC blocker
      this.hp = s - this.hpx + 0.995 * this.hp; this.hpx = s; s = this.hp;
      out[n] = Math.tanh(s * drive) * gain;
    }
    return true;
  }
}
registerProcessor('engine', EngineProcessor);
