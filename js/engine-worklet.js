// Engine sound generator: per-cylinder combustion pulses driven by crank angle, shaped by two
// exhaust/intake resonators. The layers of a recorded engine (idle, low, mid, high; on and off
// throttle) come from how rpm and load reshape it, not from level alone:
//   low rpm  - spaced, deep pulses; the firing-rate tone (body) strong
//   mid/high - denser pulses, the resonators move up and the upper one opens (more mids / highs)
//   load     - on throttle: full, hard pulses; off throttle (overrun): weak combustion, more exhaust
//              flow noise, the firing tone thin (the engine is being turned by the car)
//   mech     - valvetrain / injector ticking with the firings (worn engines, diesels, trucks)
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
    this.p = { cyl: 8, uneven: 0.3, res: [95, 380], rad: [0.992, 0.975], mix: [1, 0.45], noise: 0.3, decay: 0.0035, diesel: 0, drive: 1.6, red: 6500, mech: 0.1 };
    this.phase = 0;
    this.fi = 0;
    this.env = 0;
    this.envS = 0; // the pulse, rounded (an instant jump buzzed like a drill)
    this.envN = 0;
    this.envM = 0; // mechanical ticks
    this.fund = 0; // phase of the firing-rate tone
    this.y = [0, 0, 0, 0];
    this.seed = 12345;
    this.hp = 0; this.hpx = 0;
    this.lastShift = -1;
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
    this.decayK = Math.exp(-1 / (p.decay * 1.6 * sampleRate));
    this.attK = 1 - Math.exp(-1 / (0.0012 * sampleRate));
    this.mechK = Math.exp(-1 / (0.0007 * sampleRate));
    this.lastShift = -1;
  }
  // the resonators follow the revs a little (the exhaust note rises with rpm): recomputed per block
  coefs(shift) {
    const p = this.p;
    return p.res.map((f0, k) => {
      const f = f0 * shift, r = p.rad[k], w = (2 * Math.PI * f) / sampleRate;
      const a1 = 2 * r * Math.cos(w), a2 = -r * r;
      const re = 1 - a1 * Math.cos(w) - a2 * Math.cos(2 * w), im = a1 * Math.sin(w) + a2 * Math.sin(2 * w);
      return { a1, a2, g: Math.hypot(re, im) };
    });
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = params.rpm[0], load = params.load[0], gain = params.gain[0];
    const p = this.p, fire = this.fire, y = this.y;
    const rn = Math.min(1.1, rpm / (p.red || 6500));
    const shift = 0.82 + 0.4 * rn;
    if (Math.abs(shift - this.lastShift) > 0.004) { this.c = this.coefs(shift); this.lastShift = shift; }
    const c = this.c;
    const dphi = rpm / 120 / sampleRate; // one 4-stroke cycle = 2 crank revolutions
    // on throttle: strong pulses; off throttle: weak ones (overrun)
    const lvl = 0.12 + 0.88 * load;
    const drive = p.drive * (0.65 + 0.6 * load);
    // the upper resonator opens with revs and load (mids / highs), the body tone fades up top
    const mix1 = p.mix[1] * (0.3 + 0.9 * rn) * (0.6 + 0.4 * load);
    const bodyAmt = 0.4 * (1 - 0.55 * rn) * (0.5 + 0.5 * load);
    // exhaust flow noise: more when off throttle and up the revs
    const noise = p.noise * (0.3 + 0.25 * (1 - load) + 0.2 * rn);
    const mech = p.mech * (0.5 + 0.5 * rn);
    for (let n = 0; n < out.length; n++) {
      this.phase += dphi;
      if (this.phase >= 1) { this.phase -= 1; this.fi = 0; }
      while (this.fi < fire.length && this.phase >= fire[this.fi].a) {
        const f = fire[this.fi++];
        // cycle-to-cycle variation makes it breathe like a real engine (more ragged off throttle)
        this.env = f.amp * lvl * (0.85 + (0.3 + 0.3 * (1 - load)) * this.rand());
        this.envN = this.env;
        this.envM = 1;
      }
      const nz = this.rand() * 2 - 1;
      this.envS += (this.env - this.envS) * this.attK;
      const x = this.envS * (1 - noise + noise * nz) + p.diesel * this.envN * nz * 0.5;
      this.env *= this.decayK;
      this.envN *= this.decayK * 0.9;
      this.envM *= this.mechK;
      const y0 = c[0].g * x + c[0].a1 * y[0] + c[0].a2 * y[1];
      y[1] = y[0]; y[0] = y0;
      const y1 = c[1].g * x + c[1].a1 * y[2] + c[1].a2 * y[3];
      y[3] = y[2]; y[2] = y1;
      // the firing rate itself as a soft tone: the engine's body, felt more than heard
      this.fund += (rpm / 120) * p.cyl / sampleRate;
      if (this.fund >= 1) this.fund -= 1;
      const body = Math.sin(this.fund * 2 * Math.PI) * lvl * bodyAmt;
      // mechanical ticking: short noise clicks with every firing (valves, injectors)
      const tick = this.envM * nz * mech * 0.35;
      let s = p.mix[0] * y0 + mix1 * y1 * 0.7 + x * 0.05 + body + tick;
      // DC blocker
      this.hp = s - this.hpx + 0.995 * this.hp; this.hpx = s; s = this.hp;
      // (soft saturation: hard clipping added the fizz)
      out[n] = Math.tanh(s * drive * 0.7) * gain;
    }
    return true;
  }
}
registerProcessor('engine', EngineProcessor);
