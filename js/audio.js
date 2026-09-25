// Web Audio: physically-inspired engines (per-cylinder pulses in an AudioWorklet), gearbox,
// turbo/supercharger, exhaust pops, tires, wind, horn, tunnel reverb and city ambience.
import { clamp, lerp } from './util.js';

// Engine families. cyl = cylinders, uneven = firing irregularity (crossplane V8 burble),
// res = exhaust/intake resonances (Hz), idle/red = rpm, lp = muffler brightness.
export const ENGINES = {
  v8:        { cyl: 8,  uneven: 0.38, res: [92, 360],   rad: [0.993, 0.976], mix: [1, 0.45], noise: 0.32, decay: 0.0036, diesel: 0,   drive: 1.8, idle: 720,  red: 6800,  lp: 2400, gear: 5 },
  v8big:     { cyl: 8,  uneven: 0.45, res: [78, 300],   rad: [0.994, 0.978], mix: [1, 0.4],  noise: 0.34, decay: 0.0042, diesel: 0,   drive: 2.0, idle: 680,  red: 6200,  lp: 2000, gear: 5 },
  i4turbo:   { cyl: 4,  uneven: 0.05, res: [185, 780],  rad: [0.99, 0.972],  mix: [1, 0.65], noise: 0.36, decay: 0.0026, diesel: 0,   drive: 1.5, idle: 900,  red: 7600,  lp: 4200, gear: 6 },
  i4rally:   { cyl: 4,  uneven: 0.08, res: [165, 690],  rad: [0.991, 0.972], mix: [1, 0.7],  noise: 0.42, decay: 0.0028, diesel: 0,   drive: 1.9, idle: 1000, red: 8000,  lp: 3800, gear: 6 },
  boxer:     { cyl: 4,  uneven: 0.32, res: [140, 560],  rad: [0.992, 0.974], mix: [1, 0.55], noise: 0.4,  decay: 0.0032, diesel: 0,   drive: 1.7, idle: 850,  red: 7200,  lp: 3000, gear: 5 },
  v6:        { cyl: 6,  uneven: 0.12, res: [128, 520],  rad: [0.992, 0.974], mix: [1, 0.5],  noise: 0.3,  decay: 0.003,  diesel: 0,   drive: 1.5, idle: 750,  red: 6500,  lp: 3200, gear: 6 },
  flat6:     { cyl: 6,  uneven: 0.06, res: [240, 980],  rad: [0.99, 0.97],   mix: [1, 0.75], noise: 0.28, decay: 0.0022, diesel: 0,   drive: 1.6, idle: 950,  red: 8800,  lp: 5200, gear: 6 },
  diesel6:   { cyl: 6,  uneven: 0.05, res: [62, 250],   rad: [0.994, 0.98],  mix: [1, 0.55], noise: 0.5,  decay: 0.005,  diesel: 0.7, drive: 1.4, idle: 620,  red: 3000,  lp: 1500, gear: 8 },
  v10:       { cyl: 10, uneven: 0.02, res: [420, 1700], rad: [0.988, 0.965], mix: [1, 0.85], noise: 0.18, decay: 0.0017, diesel: 0,   drive: 1.3, idle: 1300, red: 12800, lp: 7500, gear: 7 },
};
const GEAR_TOPS = { 5: [0.3, 0.46, 0.63, 0.81, 1.0], 6: [0.26, 0.4, 0.54, 0.68, 0.84, 1.0], 7: [0.24, 0.35, 0.47, 0.58, 0.7, 0.84, 1.0], 8: [0.14, 0.22, 0.31, 0.41, 0.52, 0.65, 0.8, 1.0] };

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = { master: 0.8, engine: 0.8, sfx: 0.8, ambient: 0.6 };
    // the game's sound (engine, road, traffic, city) is off until driving starts; menu clicks have
    // their own bus and always play
    this.muted = true;
    this.gear = 0;
    this.rpm = 900;
    this.shiftT = 0;
    this.throttleLP = 0;
    this.boost = 0;
    this.lastThrottle = 0;
    this.popT = 0;
    this.inTunnel = 0;
    this.blinkState = false;
    this.car = { type: 'v8' };
    this.eng = ENGINES.v8;
    this.lastSpeed = 0;
    this.otherType = null;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol.master;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.ratio.value = 3.5;
    this.master.connect(this.comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    for (const b of [this.engineBus, this.sfxBus, this.ambBus]) b.connect(this.master);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.2);
    this.revSend.connect(this.reverb).connect(this.master);
    this.engineBus.connect(this.revSend);
    this.sfxBus.connect(this.revSend);
    this.noise = this._noiseBuffer(2);
    this.brown = this._brownBuffer(4);
    this.pink = this._pinkBuffer(3);
    this._buildEngineChain();
    this._buildLoops();
    this._buildTrafficVoices();
    this.setVolumes(this.vol);
    this.ready = true;
    // the worklet engine replaces the fallback oscillators once loaded
    if (ctx.audioWorklet) {
      const url = new URL('./engine-worklet.js', import.meta.url);
      url.search = new URL(import.meta.url).search; // same cache key (?v=) as this module
      ctx.audioWorklet.addModule(url).then(() => this._attachWorklet()).catch(() => { this.fallback = true; });
    } else this.fallback = true;
  }
  _noiseBuffer(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // pink noise (-3 dB/octave, Paul Kellet's filter): the natural colour of tyre and road roar,
  // without white noise's hiss
  _pinkBuffer(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return b;
  }
  _brownBuffer(sec) {
    const ctx = this.ctx, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return b;
  }
  _impulse(sec) {
    const ctx = this.ctx, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4) * (i < 800 ? i / 800 : 1);
    }
    return b;
  }
  _loop(buffer, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }
  _buildEngineChain() {
    const ctx = this.ctx;
    // muffler: lowpass + a gentle low-shelf body
    this.eFilter = ctx.createBiquadFilter();
    this.eFilter.type = 'lowpass';
    this.eFilter.Q.value = 0.7;
    this.eBody = ctx.createBiquadFilter();
    this.eBody.type = 'lowshelf';
    this.eBody.frequency.value = 180;
    this.eBody.gain.value = 5;
    this.eOut = ctx.createGain();
    this.eOut.gain.value = 0;
    this.eFilter.connect(this.eBody).connect(this.eOut).connect(this.engineBus);
    // fallback engine (used until / unless the worklet loads)
    this.fb = [];
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2); }
    shaper.curve = curve;
    this.fbGain = ctx.createGain();
    this.fbGain.gain.value = 0.6;
    for (const [type, mul, g] of [['sawtooth', 1, 0.3], ['square', 0.5, 0.15], ['sine', 0.25, 0.45]]) {
      const o = ctx.createOscillator(), gg = ctx.createGain();
      o.type = type; gg.gain.value = g;
      o.connect(gg).connect(shaper);
      o.start();
      this.fb.push([o, mul]);
    }
    shaper.connect(this.fbGain).connect(this.eFilter);
    // intake roar
    this.roar = this._loop(this.noise);
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.Q.value = 1.1;
    this.roarG = ctx.createGain(); this.roarG.gain.value = 0;
    this.roar.connect(this.roarF).connect(this.roarG).connect(this.engineBus);
    // forced induction. Turbo: mostly an airy spool 'whoosh' (band-passed noise) with a faint, low,
    // muffled whistle underneath; the old pure high tones sounded like a blender. Supercharger: soft whine.
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
    this.turbo2 = ctx.createOscillator(); this.turbo2.type = 'sine';
    this.turboLP = ctx.createBiquadFilter(); this.turboLP.type = 'lowpass'; this.turboLP.frequency.value = 1800; this.turboLP.Q.value = 0.5;
    this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
    this.turbo.connect(this.turboLP); this.turbo2.connect(this.turboLP);
    this.turboLP.connect(this.turboG).connect(this.engineBus);
    this.turbo.start(); this.turbo2.start();
    this.whoosh = this._loop(this.noise, 0.9);
    this.whooshF = ctx.createBiquadFilter(); this.whooshF.type = 'bandpass'; this.whooshF.frequency.value = 700; this.whooshF.Q.value = 1.6;
    this.whooshG = ctx.createGain(); this.whooshG.gain.value = 0;
    this.whoosh.connect(this.whooshF).connect(this.whooshG).connect(this.engineBus);
  }
  _attachWorklet() {
    const ctx = this.ctx;
    this.wEngine = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.wEngine.connect(this.eFilter);
    this.fbGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    this._sendProfile();
    // other car (nearest cruiser) gets its own engine voice
    this.oEngine = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.oFilter = ctx.createBiquadFilter(); this.oFilter.type = 'lowpass'; this.oFilter.frequency.value = 1800;
    this.oPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    this.oEngine.connect(this.oFilter).connect(this.oPan).connect(this.engineBus);
  }
  // Ordinary traffic: four cheap voices (engine hum + tyre roar), panned and doppler-shifted,
  // each following one of the nearest cars.
  _buildTrafficVoices() {
    const ctx = this.ctx;
    this.tVoices = [];
    for (let i = 0; i < 4; i++) {
      const out = ctx.createGain(); out.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      out.connect(pan).connect(this.engineBus);
      const eng = ctx.createGain(); eng.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 0.9;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'sine';
      const g2 = ctx.createGain(); g2.gain.value = 0.9;
      o1.connect(lp); o2.connect(g2).connect(lp);
      lp.connect(eng).connect(out);
      o1.start(); o2.start();
      // tyre roar: pink noise, low-passed (a soft rumble that brightens a little with speed, not a hiss)
      const roar = this._loop(this.pink, 0.9 + i * 0.05);
      const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 400; rf.Q.value = 0.5;
      const rg = ctx.createGain(); rg.gain.value = 0;
      roar.connect(rf).connect(rg).connect(out);
      this.tVoices.push({ key: null, out, pan, eng, lp, o1, o2, rf, rg, level: 0 });
    }
  }
  _updateTrafficVoices(list, t) {
    if (!this.tVoices) return;
    list = list || [];
    for (const v of this.tVoices) v.seen = false;
    for (const c of list) {
      let v = this.tVoices.find(x => x.key === c.key);
      // a new car takes a voice that is silent (or has lost its car), so nothing jumps audibly
      if (!v) v = this.tVoices.find(x => !x.seen && x.level < 0.004 && !list.some(q => q.key === x.key));
      if (!v) continue;
      const fresh = v.key !== c.key;
      v.key = c.key; v.seen = true;
      const kmh = c.speed * 3.6;
      const heavy = !!c.heavy;
      const push = clamp(c.acc / 1.5, 0, 1);
      const rpm = heavy ? clamp(650 + kmh * 11 + push * 250, 650, 1900) : clamp(850 + kmh * 19 + push * 450, 850, 3300);
      const doppler = clamp(1 + c.closing / 340, 0.8, 1.25);
      const fire = (rpm / 60) * (heavy ? 3 : 2) * doppler;
      const att = Math.pow(clamp(1 - c.dist / 70, 0, 1), 2);
      const k = fresh ? 0.001 : 0.06;
      v.o1.frequency.setTargetAtTime(fire, t, k);
      v.o2.frequency.setTargetAtTime(fire * 0.5, t, k);
      v.lp.frequency.setTargetAtTime((heavy ? 260 : 420) + push * 500 + kmh * 2, t, 0.1);
      v.rf.frequency.setTargetAtTime((260 + kmh * 3.2) * doppler, t, 0.1);
      v.eng.gain.setTargetAtTime((heavy ? 0.1 : 0.06) * (0.55 + 0.45 * push), t, 0.1);
      v.rg.gain.setTargetAtTime(Math.pow(clamp(kmh / 110, 0, 1.2), 1.5) * (heavy ? 0.16 : 0.11), t, 0.1);
      v.level = att * 0.45;
      v.out.gain.setTargetAtTime(v.level, t, fresh ? 0.08 : 0.06);
      if (v.pan.pan) v.pan.pan.setTargetAtTime(clamp(c.pan, -1, 1), t, 0.05);
    }
    for (const v of this.tVoices) if (!v.seen) {
      v.level *= 0.9;
      v.out.gain.setTargetAtTime(0, t, 0.15);
      if (v.level < 0.004) v.key = null;
    }
  }  _sendProfile() {
    if (!this.wEngine) return;
    const e = this.eng;
    this.wEngine.port.postMessage({ cyl: e.cyl, uneven: e.uneven, res: e.res, rad: e.rad, mix: e.mix, noise: e.noise, decay: e.decay, diesel: e.diesel, drive: e.drive });
  }
  _buildLoops() {
    const ctx = this.ctx;
    const mk = (buf, type, f, q, bus, rate = 1) => {
      const src = this._loop(buf, rate), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
      src.connect(fl).connect(g).connect(bus);
      return { src, fl, g };
    };
    // tire squeal: narrow band noise + two detuned tones with wobble
    this.tire = mk(this.noise, 'bandpass', 1300, 6, this.sfxBus);
    this.sq = [];
    this.sqG = ctx.createGain(); this.sqG.gain.value = 0;
    this.sqF = ctx.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.frequency.value = 900; this.sqF.Q.value = 3;
    for (const d of [0, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 820 + d; o.connect(this.sqF); o.start(); this.sq.push(o);
    }
    this.sqF.connect(this.sqG).connect(this.sfxBus);
    this.roll = mk(this.brown, 'lowpass', 160, 0.8, this.sfxBus);
    this.wind = mk(this.noise, 'lowpass', 700, 0.4, this.ambBus);
    this.windHi = mk(this.noise, 'bandpass', 2400, 0.8, this.ambBus);
    this.city = mk(this.brown, 'lowpass', 320, 0.5, this.ambBus);
    // traffic around: a distant low rumble (was band-passed white noise: a hiss)
    this.traffic = mk(this.brown, 'lowpass', 200, 0.5, this.ambBus);
    // tyres on asphalt: pink noise around the tread's roar band, plus a hint of the coarse texture
    this.tread = mk(this.pink, 'bandpass', 500, 0.6, this.sfxBus);
    this.treadHi = mk(this.pink, 'highpass', 1800, 0.5, this.sfxBus);
    this.treadWob = 1; this.jointD = 0;
    this.tunnelHum = mk(this.brown, 'bandpass', 110, 1.5, this.ambBus);
    // horn: two detuned squares through a horn-like band
    this.horn = ctx.createGain(); this.horn.gain.value = 0;
    this.hornF = ctx.createBiquadFilter(); this.hornF.type = 'bandpass'; this.hornF.frequency.value = 900; this.hornF.Q.value = 0.9;
    this.hornS = ctx.createWaveShaper();
    const hc = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; hc[i] = Math.tanh(x * 3); }
    this.hornS.curve = hc;
    this.h1 = ctx.createOscillator(); this.h1.type = 'square';
    this.h2 = ctx.createOscillator(); this.h2.type = 'square';
    this.h1.connect(this.hornS); this.h2.connect(this.hornS);
    this.hornS.connect(this.hornF).connect(this.horn).connect(this.sfxBus);
    this.h1.start(); this.h2.start();
    // fallback other-car voice
    this.oOsc = ctx.createOscillator(); this.oOsc.type = 'sawtooth';
    this.oOscF = ctx.createBiquadFilter(); this.oOscF.type = 'lowpass'; this.oOscF.frequency.value = 700;
    this.oOscG = ctx.createGain(); this.oOscG.gain.value = 0;
    this.oOsc.connect(this.oOscF).connect(this.oOscG).connect(this.engineBus);
    this.oOsc.start();
  }
  setVolumes(v) {
    this.vol = { ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : v.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(v.engine * 0.95, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(v.ambient, t, 0.05);
  }
  setCar(sound) {
    this.car = sound || { type: 'v8' };
    this.eng = ENGINES[this.car.type] || ENGINES.v8;
    this.gear = 0;
    this.rpm = this.eng.idle;
    if (!this.ctx) return;
    const e = this.eng, diesel = this.car.type === 'diesel6';
    this.eFilter.frequency.value = e.lp;
    this.eBody.gain.value = e.cyl >= 8 ? 6 : diesel ? 7 : 3;
    // horns: trucks get an air horn chord, small cars a thin beep
    const horn = this.car.horn || (diesel ? 'air' : e.cyl <= 4 ? 'small' : 'car');
    const H = { air: [185, 233, 900], car: [415, 523, 1000], small: [520, 660, 1400] }[horn];
    this.h1.frequency.value = H[0]; this.h2.frequency.value = H[1]; this.hornF.frequency.value = H[2];
    this._sendProfile();
  }
  // another car honking at the player: one or two short blasts, panned and distance-attenuated
  honkAt(pan, dist, heavy, angry) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = heavy ? 650 : 1100; f.Q.value = 0.9;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = clamp(pan, -1, 1);
    f.connect(g).connect(p).connect(this.sfxBus);
    const base = heavy ? 200 : 380 + Math.random() * 120;
    const oscs = [base, base * 1.26].map(fr => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t0); o.stop(t0 + 1.2); return o; });
    const vol = 0.12 * clamp(1 - dist / 90, 0.08, 1);
    const blasts = angry ? [[0, 0.16], [0.24, 0.5]] : [[0, 0.22]];
    for (const [s, e] of blasts) { g.gain.setValueAtTime(0, t0 + s); g.gain.linearRampToValueAtTime(vol, t0 + s + 0.01); g.gain.setValueAtTime(vol, t0 + e - 0.02); g.gain.linearRampToValueAtTime(0, t0 + e); }
    void oscs;
  }
  suspend(on) { if (this.ctx) { if (on) this.ctx.suspend(); else this.ctx.resume(); } }
  mute(on) {
    this.muted = !!on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0 : this.vol.master, this.ctx.currentTime, 0.08);
  }

  // --------------------------------------------------------------- per frame
  update(dt, p) {
    if (!this.ready || !Number.isFinite(p.speed) || !Number.isFinite(dt)) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const e = this.eng, car = this.car;
    const kmh = Math.abs(p.speed) * 3.6;
    const top = car.top || 240;
    const tops = GEAR_TOPS[e.gear] || GEAR_TOPS[6];
    // gearbox
    const gRatio = g => (top * tops[g]) / (e.red * 0.97);
    let target;
    if (p.reverse) { target = e.idle + (kmh / 30) * e.red * 0.55; this.gear = 0; }
    else {
      const rpmIn = g => (kmh / gRatio(g));
      let g = this.gear;
      // Shift points (fraction of redline) with hysteresis: for any load the upshift point sits well
      // above the downshift point, so a gear change never immediately triggers the opposite one.
      // Gentle driving short-shifts and cruises at low revs; flooring it holds gears and kicks down.
      // The load is the smoothed throttle, so a quick lift does not force an upshift.
      const load = this.throttleLP;
      const up = load > 0.6 ? 0.93 : load > 0.15 ? 0.52 : 0.62;
      const down = p.brake > 0.3 ? 0.45 : load > 0.6 ? 0.48 : 0.28;
      this.gearHold = Math.max(0, (this.gearHold || 0) - dt);
      if (this.shiftT <= 0 && this.gearHold <= 0) {
        if (g < tops.length - 1 && p.brake < 0.3 && rpmIn(g) > e.red * up) {
          g++; this.shiftT = e.cyl >= 10 ? 0.06 : car.type === 'diesel6' ? 0.35 : 0.14; this.gearHold = 0.6;
          if (p.throttle > 0.5) this._shiftPop();
        } else if (g > 0 && rpmIn(g - 1) < e.red * down) { g--; this.shiftT = 0.1; this.gearHold = 0.45; }
      }
      this.gear = g;
      target = Math.max(e.idle, rpmIn(g));
      // clutch slip at launch
      if (kmh < 18 && g === 0) target = Math.max(target, e.idle + p.throttle * e.red * 0.45);
      target = Math.min(target, e.red * 1.02);
    }
    if (this.shiftT > 0) this.shiftT -= dt;
    const shifting = this.shiftT > 0;
    this.rpm = lerp(this.rpm, target, 1 - Math.exp(-dt * (shifting ? 18 : 10)));
    const load = shifting ? 0.05 : clamp(p.throttle, 0, 1);
    this.throttleLP = lerp(this.throttleLP, load, 1 - Math.exp(-dt * 12));
    const rn = this.rpm / e.red;
    const tunnelBoost = 1 + this.inTunnel * 0.3;
    if (this.wEngine) {
      const P = this.wEngine.parameters;
      P.get('rpm').setTargetAtTime(this.rpm, t, 0.015);
      P.get('load').setTargetAtTime(this.throttleLP, t, 0.03);
      P.get('gain').setTargetAtTime((0.45 + rn * 1.4) * tunnelBoost, t, 0.04);
    } else {
      const fire = (this.rpm / 60) * (e.cyl / 2);
      for (const [o, mul] of this.fb) o.frequency.setTargetAtTime(fire * mul * 0.5, t, 0.02);
    }
    this.eOut.gain.setTargetAtTime(0.22 + this.throttleLP * 0.18, t, 0.05);
    this.eFilter.frequency.setTargetAtTime(e.lp * (0.55 + 0.45 * this.throttleLP + 0.25 * rn), t, 0.05);
    // intake roar rises with rpm and load
    this.roarF.frequency.setTargetAtTime(200 + this.rpm * 0.12, t, 0.05);
    this.roarG.gain.setTargetAtTime((0.01 + this.throttleLP * 0.06) * (0.3 + rn), t, 0.06);
    // forced induction
    if (car.turbo) {
      const want = clamp(this.throttleLP * (rn * 1.5 - 0.25), 0, 1);
      this.boost = lerp(this.boost, want, 1 - Math.exp(-dt * (want > this.boost ? 1.8 : 7)));
      const b = this.boost;
      this.whooshF.frequency.setTargetAtTime((car.type === 'diesel6' ? 450 : 600) + b * 1300, t, 0.12);
      this.whooshG.gain.setTargetAtTime(b * b * 0.035, t, 0.1);
      const f = (car.type === 'diesel6' ? 700 : 950) + b * 1100;
      this.turbo.frequency.setTargetAtTime(f, t, 0.12);
      this.turbo2.frequency.setTargetAtTime(f * 1.5, t, 0.12);
      this.turboG.gain.setTargetAtTime(b * b * 0.0035, t, 0.1);
      if (this.lastThrottle > 0.7 && p.throttle < 0.15 && this.boost > 0.4) this._blowOff(car.type === 'diesel6');
    } else if (car.blower) {
      this.turbo.frequency.setTargetAtTime(this.rpm * 0.3, t, 0.05);
      this.turbo2.frequency.setTargetAtTime(this.rpm * 0.45, t, 0.05);
      this.turboG.gain.setTargetAtTime(0.002 + rn * 0.006 * (0.4 + this.throttleLP), t, 0.08);
      this.whooshG.gain.setTargetAtTime(0, t, 0.1);
    } else { this.turboG.gain.setTargetAtTime(0, t, 0.1); this.whooshG.gain.setTargetAtTime(0, t, 0.1); }
    // lift-off crackle (V8s, rally, hot hatches)
    const pops = car.pops !== undefined ? car.pops : e.cyl >= 8 ? 0.8 : car.type === 'i4rally' ? 1.4 : car.type === 'diesel6' ? 0 : 0.5;
    if (pops > 0 && this.lastThrottle > 0.6 && p.throttle < 0.1 && rn > 0.55) this.popT = 0.6 + pops * 0.3;
    if (this.popT > 0) { this.popT -= dt; if (Math.random() < dt * 20 * pops) this._pop(e); }
    // diesel air brake when coming to a stop
    if (car.type === 'diesel6' && this.lastSpeed > 3 && kmh <= 3 && p.brake > 0.2) this._airBrake();
    this.lastSpeed = kmh;
    this.lastThrottle = p.throttle;
    // tires
    const slip = clamp(p.slip, 0, 1);
    const sq = Math.max(0, slip - 0.18) / 0.82;
    this.tire.g.gain.setTargetAtTime(sq * sq * 0.16, t, 0.05);
    this.sqG.gain.setTargetAtTime(sq * sq * 0.045, t, 0.05);
    const wob = Math.sin(t * 11) * 25 + Math.sin(t * 29) * 12;
    this.sq[0].frequency.setTargetAtTime(760 + sq * 220 + wob, t, 0.03);
    this.sq[1].frequency.setTargetAtTime(772 + sq * 230 - wob, t, 0.03);
    this.roll.g.gain.setTargetAtTime(clamp(kmh / 200, 0, 0.42), t, 0.1);
    this.roll.fl.frequency.setTargetAtTime(110 + kmh * 1.1, t, 0.1);
    // tyre roar on the asphalt: rises with speed, its band moves up; a slow random wobble stands for
    // the changing surface
    this.treadWob = clamp(this.treadWob + (Math.random() - 0.5) * dt * 1.2, 0.85, 1.15);
    const tr = Math.pow(clamp(kmh / 160, 0, 1.4), 1.3);
    this.tread.g.gain.setTargetAtTime(tr * 0.22 * this.treadWob * (1 + this.inTunnel * 0.3), t, 0.08);
    this.tread.fl.frequency.setTargetAtTime(Math.min(1300, 380 + kmh * 3.5), t, 0.1);
    this.treadHi.g.gain.setTargetAtTime(tr * 0.025, t, 0.1);
    // expansion joints of the elevated road: a soft double thump (front, then rear axle) every 40 m
    if (kmh > 25 && !p.reverse) {
      this.jointD += (kmh / 3.6) * dt;
      if (this.jointD > 40) {
        this.jointD = 0;
        const g = clamp(kmh / 140, 0.25, 1) * 0.07;
        this._burst(0.07, 'lowpass', 150, 0.9, g);
        setTimeout(() => { if (this.ready) this._burst(0.07, 'lowpass', 140, 0.9, g * 0.8); }, clamp(2700 / (kmh / 3.6), 15, 200));
      }
    }
    // wind
    const v = kmh / 100;
    this.wind.g.gain.setTargetAtTime(clamp(v * v * 0.09, 0, 0.32) * (1 - this.inTunnel * 0.4), t, 0.1);
    this.wind.fl.frequency.setTargetAtTime(350 + kmh * 5, t, 0.1);
    this.windHi.g.gain.setTargetAtTime(clamp((v - 1) * 0.03, 0, 0.05), t, 0.2);
    // ambience
    this.city.g.gain.setTargetAtTime(0.14 * (1 - this.inTunnel * 0.7), t, 0.4);
    this.traffic.g.gain.setTargetAtTime(clamp(p.trafficNear * 0.012, 0, 0.045), t, 0.4);
    this.inTunnel = lerp(this.inTunnel, p.tunnel ? 1 : 0, 1 - Math.exp(-dt * 3));
    this.revSend.gain.setTargetAtTime(this.inTunnel * 0.55, t, 0.1);
    this.tunnelHum.g.gain.setTargetAtTime(this.inTunnel * 0.08, t, 0.3);
    // horn
    this.horn.gain.setTargetAtTime(p.horn ? 0.14 : 0, t, p.horn ? 0.008 : 0.04);
    // blinker relay click
    if (p.blinkOn !== this.blinkState) { this.blinkState = p.blinkOn; if (p.blinkActive) this._tick(p.blinkOn); }
    // nearest cruiser's engine, with doppler
    const o = p.other;
    if (o) {
      const oe = ENGINES[(o.sound && o.sound.type) || 'v8'] || ENGINES.v8;
      const doppler = clamp(1 + o.closing / 340, 0.7, 1.4);
      const orpm = clamp(oe.idle + (o.speed || 20) / 70 * oe.red * 0.9, oe.idle, oe.red * 0.9);
      const og = clamp(1 - o.dist / 70, 0, 1);
      if (this.oEngine) {
        const type = (o.sound && o.sound.type) || 'v8';
        if (type !== this.otherType) {
          this.otherType = type;
          this.oEngine.port.postMessage({ cyl: oe.cyl, uneven: oe.uneven, res: oe.res, rad: oe.rad, mix: oe.mix, noise: oe.noise, decay: oe.decay, diesel: oe.diesel, drive: oe.drive });
          this.oFilter.frequency.value = oe.lp * 0.7;
        }
        const P = this.oEngine.parameters;
        P.get('rpm').setTargetAtTime(orpm * doppler, t, 0.05);
        P.get('load').setTargetAtTime(0.6, t, 0.1);
        P.get('gain').setTargetAtTime(og * og * 0.5, t, 0.08);
        if (this.oPan.pan) this.oPan.pan.setTargetAtTime(clamp(o.pan, -1, 1), t, 0.05);
      } else {
        this.oOsc.frequency.setTargetAtTime((orpm / 60) * (oe.cyl / 4) * doppler, t, 0.05);
        this.oOscG.gain.setTargetAtTime(og * og * 0.05, t, 0.08);
      }
    } else {
      if (this.oEngine) this.oEngine.parameters.get('gain').setTargetAtTime(0, t, 0.3);
      this.oOscG.gain.setTargetAtTime(0, t, 0.2);
    }
    this._updateTrafficVoices(p.traffic, t);
  }

  _burst(dur, type, f, q, gain, bus = this.sfxBus, sweepTo = null, attack = 0.002, buffer = this.noise) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    const fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(bus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  _pop(e) {
    // backfire: a low thump plus a sharp crack
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(e.res[0] * 1.2, t);
    o.frequency.exponentialRampToValueAtTime(e.res[0] * 0.6, t + 0.06);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.engineBus);
    o.start(t); o.stop(t + 0.08);
    this._burst(0.04 + Math.random() * 0.04, 'bandpass', 700 + Math.random() * 900, 1.1, 0.3, this.engineBus);
  }
  _shiftPop() { this._burst(0.07, 'lowpass', 800, 0.8, 0.1, this.engineBus); }
  // blow-off: a short, soft 'pssh' (band-passed, falling) instead of a bright hiss
  _blowOff(diesel) { this._burst(diesel ? 0.5 : 0.35, 'bandpass', diesel ? 1100 : 1600, 0.9, 0.05, this.engineBus, diesel ? 500 : 700, 0.01); this.boost = 0; }
  _airBrake() { this._burst(0.9, 'highpass', 3000, 0.5, 0.12, this.sfxBus, 1800, 0.01); }
  _tick(on) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'square';
    o.frequency.value = on ? 1900 : 1500;
    f.type = 'bandpass'; f.frequency.value = on ? 3200 : 2600; f.Q.value = 4;
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.03);
  }
  impact(strength) {
    if (!this.ready) return;
    const s = clamp(strength, 0, 1);
    this._burst(0.25 + s * 0.35, 'lowpass', 700 + s * 1800, 0.7, 0.2 + s * 0.6);
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    g.gain.setValueAtTime(0.45 * s + 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.35);
    if (s > 0.3) { this._burst(0.6, 'highpass', 4500, 0.5, 0.07 * s); this._burst(0.35, 'bandpass', 2600, 3, 0.05 * s); }
  }
  scrape(amount) {
    if (!this.ready || amount < 0.05) return;
    this._burst(0.14, 'bandpass', 2200 + Math.random() * 1500, 3, 0.06 * amount);
  }
  passBy(intensity, pan) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) { p.pan.value = clamp(pan, -1, 1); p.pan.linearRampToValueAtTime(clamp(-pan, -1, 1), ctx.currentTime + 0.8); }
    p.connect(this.ambBus);
    this._burst(0.9, 'bandpass', 650, 0.6, 0.035 * intensity, p, 280, 0.2, this.pink);
    this._burst(0.9, 'lowpass', 240, 0.8, 0.08 * intensity, p, 110, 0.25, this.pink);
  }
  // standard menu tick: a short, soft sine note (C6) with a quiet octave on top, quick attack and decay.
  // The same sound everywhere, a hair higher when moving forward.
  uiTick(up = true) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (ctx.state === 'suspended') ctx.resume();
    // one tick per action: a mouse press already played it, the click handler that follows must not repeat it
    if (this.holdTick || t - (this._lastTick || -1) < 0.04) return;
    this._lastTick = t;
    const f = up ? 1046.5 : 987.8;
    // own bus past the master gain: the pause menu mutes the game, not its clicks
    if (!this.uiBus) { this.uiBus = ctx.createGain(); this.uiBus.connect(this.comp); }
    this.uiBus.gain.value = this.vol && this.vol.master !== undefined ? this.vol.master : 1;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
    lp.connect(this.uiBus);
    for (const [mul, g, dec] of [[1, 0.07, 0.09], [2, 0.012, 0.035]]) {
      const o = ctx.createOscillator(), e = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f * mul;
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(g, t + 0.003);
      e.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(e).connect(lp);
      o.start(t); o.stop(t + dec + 0.02);
    }
  }
  menuBlip(up = true) { this.uiTick(up); }
  selectChime(index, up = true) { void index; this.uiTick(up); }

  // idle engine for the showroom
  idle(on) {
    if (!this.ready) return;
    // menus are silent: just fade the engine out (no revving from zero when a menu opens)
    if (!on) { this.eOut.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); return; }
    this.update(1 / 60, { speed: 0, throttle: this.revT > 0 ? 0.8 : 0, slip: 0, tunnel: false, horn: false, trafficNear: 0, brake: 0 });
    if (this.revT > 0) this.revT -= 1 / 60;
    this.eOut.gain.setTargetAtTime(on ? 0.28 : 0, this.ctx.currentTime, 0.2);
  }
  rev() { this.revT = 0.45; }
}
