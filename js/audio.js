// Web Audio: physically-inspired engines (per-cylinder pulses in an AudioWorklet), gearbox,
// turbo/supercharger, exhaust pops, tires, wind, horn, tunnel reverb and city ambience.
import { clamp, lerp } from './util.js';
import { VEHICLE_AUDIO, DEFAULT_AUDIO } from './vehicleaudio.js';

// Engine families. cyl = cylinders, uneven = firing irregularity (crossplane V8 burble),
// res = exhaust/intake resonances (Hz), idle/red = rpm, lp = muffler brightness.
export const ENGINES = {
  v8:        { cyl: 8,  uneven: 0.38, res: [92, 360],   rad: [0.993, 0.976], mix: [1, 0.45], noise: 0.32, decay: 0.0036, diesel: 0,   drive: 1.8, idle: 720,  red: 6800,  lp: 2400, gear: 5 },
  v8big:     { cyl: 8,  uneven: 0.45, res: [78, 300],   rad: [0.994, 0.978], mix: [1, 0.4],  noise: 0.34, decay: 0.0042, diesel: 0,   drive: 2.0, idle: 680,  red: 6200,  lp: 2000, gear: 5 },
  i4turbo:   { cyl: 4,  uneven: 0.05, res: [185, 780],  rad: [0.99, 0.972],  mix: [1, 0.65], noise: 0.36, decay: 0.0026, diesel: 0,   drive: 1.5, idle: 900,  red: 6800,  lp: 4200, gear: 6 },
  i4rally:   { cyl: 4,  uneven: 0.08, res: [165, 690],  rad: [0.991, 0.972], mix: [1, 0.7],  noise: 0.42, decay: 0.0028, diesel: 0,   drive: 1.9, idle: 1000, red: 7200,  lp: 3800, gear: 6 },
  boxer:     { cyl: 4,  uneven: 0.32, res: [140, 560],  rad: [0.992, 0.974], mix: [1, 0.55], noise: 0.4,  decay: 0.0032, diesel: 0,   drive: 1.7, idle: 850,  red: 7200,  lp: 3000, gear: 5 },
  v6:        { cyl: 6,  uneven: 0.12, res: [128, 520],  rad: [0.992, 0.974], mix: [1, 0.5],  noise: 0.3,  decay: 0.003,  diesel: 0,   drive: 1.5, idle: 750,  red: 6500,  lp: 3200, gear: 6 },
  flat6:     { cyl: 6,  uneven: 0.06, res: [240, 980],  rad: [0.99, 0.97],   mix: [1, 0.75], noise: 0.28, decay: 0.0022, diesel: 0,   drive: 1.6, idle: 950,  red: 7600,  lp: 5200, gear: 6 },
  // big inline-six diesel (buses, garbage truck, fire engine; e.g. an 8.9 l Cummins): deep clatter,
  // torque at 1000 rpm, governed near 2400
  diesel6:   { cyl: 6,  uneven: 0.05, res: [60, 240],   rad: [0.994, 0.98],  mix: [1, 0.55], noise: 0.5,  decay: 0.005,  diesel: 0.8, drive: 1.4, idle: 600,  red: 2400,  lp: 1400, gear: 8 },
  v10:       { cyl: 10, uneven: 0.02, res: [420, 1700], rad: [0.988, 0.965], mix: [1, 0.85], noise: 0.18, decay: 0.0017, diesel: 0,   drive: 1.3, idle: 1300, red: 8600, lp: 7500, gear: 7 },
  // premium pack engines
  // Nissan RB26DETT (R34): smooth straight six with a raspy, metallic top end, revs to 8000
  // (less combustion noise and a lower ceiling than before: the top end hissed)
  i6rb:      { cyl: 6,  uneven: 0.02, res: [160, 660],  rad: [0.991, 0.972], mix: [1, 0.66], noise: 0.2,  decay: 0.0024, diesel: 0,   drive: 1.7, idle: 900,  red: 8000,  lp: 3700, gear: 6 },
  // Toyota 2JZ-GTE (Supras): deeper, fuller straight six, big turbo, about 7000 rpm
  i6jz:      { cyl: 6,  uneven: 0.03, res: [118, 510],  rad: [0.992, 0.975], mix: [1, 0.6],  noise: 0.3,  decay: 0.0028, diesel: 0,   drive: 1.85, idle: 750, red: 7000,  lp: 3600, gear: 6 },
  // Mazda 13B twin rotor (RX-7): two rotors fire once per shaft turn each (the rate of a four-stroke
  // four), with sharp exhaust pulses: a bright, buzzing rasp, lumpy idle, 9000 rpm
  rotary:    { cyl: 4,  uneven: 0.22, res: [230, 960],  rad: [0.989, 0.968], mix: [1, 0.85], noise: 0.5,  decay: 0.0016, diesel: 0,   drive: 2.2, idle: 1000, red: 8200,  lp: 5800, gear: 5 },
  // Honda F20C (S2000): naturally aspirated four that screams to 9000
  i4vtec:    { cyl: 4,  uneven: 0.04, res: [205, 860],  rad: [0.99, 0.97],   mix: [1, 0.75], noise: 0.3,  decay: 0.0022, diesel: 0,   drive: 1.7, idle: 950,  red: 7800,  lp: 5600, gear: 6 },
  // Nissan SR20DET (S15): raspy turbo four
  // generic packs, by what each vehicle would really carry:
  // small city four (Compact): thin, buzzy, revs out early
  i4small:   { cyl: 4,  uneven: 0.03, res: [215, 880],  rad: [0.99, 0.972],  mix: [1, 0.6],  noise: 0.28, decay: 0.0024, diesel: 0,   drive: 1.4, idle: 850,  red: 6800,  lp: 4000, gear: 5 },
  // Ford 4.6 Modular V8 (Crown Victoria: Taxi, Police): a smooth, deep baritone, mild burble, 6000 rpm
  v8mod:     { cyl: 8,  uneven: 0.28, res: [100, 420],  rad: [0.993, 0.976], mix: [1, 0.5],  noise: 0.28, decay: 0.0034, diesel: 0,   drive: 1.7, idle: 650,  red: 6000,  lp: 2600, gear: 5 },
  // pushrod muscle V8 (Coupe): crossplane "potato-potato" lope, loud and low
  v8muscle:  { cyl: 8,  uneven: 0.48, res: [82, 320],   rad: [0.994, 0.978], mix: [1, 0.42], noise: 0.32, decay: 0.004,  diesel: 0,   drive: 2.0, idle: 700,  red: 6300,  lp: 2200, gear: 5 },
  // V8 turbo-diesel (Ambulance, Service Truck): diesel clatter over a V8 rumble, 3800 rpm
  diesel8:   { cyl: 8,  uneven: 0.3,  res: [70, 280],   rad: [0.994, 0.979], mix: [1, 0.5],  noise: 0.45, decay: 0.0045, diesel: 0.6, drive: 1.5, idle: 650,  red: 3800,  lp: 1800, gear: 6 },
  // small four-cylinder truck diesel (Tow Truck): rattly, busy, 3200 rpm
  diesel4:   { cyl: 4,  uneven: 0.06, res: [88, 350],   rad: [0.994, 0.979], mix: [1, 0.55], noise: 0.5,  decay: 0.005,  diesel: 0.8, drive: 1.4, idle: 700,  red: 3200,  lp: 1600, gear: 6 },
  // refined four for a mid-size sedan (and the taxi): smooth, isolated, 6500
  i4sedan:   { cyl: 4,  uneven: 0.03, res: [180, 740],  rad: [0.991, 0.973], mix: [1, 0.55], noise: 0.24, decay: 0.0026, diesel: 0,   drive: 1.4, idle: 750,  red: 6500,  lp: 3600, gear: 6 },
  // modern production V6 coupe: an even, rasping note that opens up top, 7400
  v6coupe:   { cyl: 6,  uneven: 0.08, res: [140, 600],  rad: [0.992, 0.973], mix: [1, 0.62], noise: 0.28, decay: 0.0028, diesel: 0,   drive: 1.7, idle: 800,  red: 7400,  lp: 4200, gear: 6 },
  // truck-style V6 of a 4x4: low, rough, 6000
  v6truck:   { cyl: 6,  uneven: 0.16, res: [110, 460],  rad: [0.993, 0.975], mix: [1, 0.48], noise: 0.33, decay: 0.0032, diesel: 0,   drive: 1.6, idle: 700,  red: 6000,  lp: 2800, gear: 6 },
  // the biggest six diesel (fire engine, refuse truck): very low, heavy clatter, governed near 2200
  diesel6big:{ cyl: 6,  uneven: 0.06, res: [52, 210],   rad: [0.995, 0.981], mix: [1, 0.5],  noise: 0.52, decay: 0.0055, diesel: 0.9, drive: 1.45, idle: 560, red: 2200,  lp: 1250, gear: 8 },
  i4sr:      { cyl: 4,  uneven: 0.06, res: [175, 740],  rad: [0.99, 0.972],  mix: [1, 0.68], noise: 0.4,  decay: 0.0025, diesel: 0,   drive: 1.7, idle: 850,  red: 6900,  lp: 4400, gear: 6 },
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
    this.prof = DEFAULT_AUDIO;
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
    this.eFilter2 = ctx.createBiquadFilter();
    this.eFilter2.type = 'lowpass';
    this.eFilter2.Q.value = 0.5;
    this.eFilter.connect(this.eFilter2).connect(this.eBody).connect(this.eOut).connect(this.engineBus);
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
    // (pink noise: white noise here hissed at full boost)
    this.whoosh = this._loop(this.pink, 0.9);
    this.whooshF = ctx.createBiquadFilter(); this.whooshF.type = 'bandpass'; this.whooshF.frequency.value = 700; this.whooshF.Q.value = 1.6;
    this.whooshG = ctx.createGain(); this.whooshG.gain.value = 0;
    this.whoosh.connect(this.whooshF).connect(this.whooshG).connect(this.engineBus);
    // transmission: gear whine (a narrow tone that follows the road speed through the gearbox)
    this.whine = ctx.createOscillator(); this.whine.type = 'triangle';
    this.whineF = ctx.createBiquadFilter(); this.whineF.type = 'bandpass'; this.whineF.Q.value = 6;
    this.whineG = ctx.createGain(); this.whineG.gain.value = 0;
    this.whine.connect(this.whineF).connect(this.whineG).connect(this.engineBus);
    this.whine.start();
    // off throttle: engine braking / retarder rumble (low, dark flow noise in the exhaust)
    this.overrun = this._loop(this.brown, 0.8);
    this.overrunF = ctx.createBiquadFilter(); this.overrunF.type = 'lowpass'; this.overrunF.frequency.value = 220; this.overrunF.Q.value = 0.8;
    this.overrunG = ctx.createGain(); this.overrunG.gain.value = 0;
    this.overrun.connect(this.overrunF).connect(this.overrunG).connect(this.engineBus);
    // siren (police, ambulance, fire engine): two detuned voices, a speaker-horn band, its own level
    this.siren = [ctx.createOscillator(), ctx.createOscillator()];
    this.siren[0].type = 'sawtooth'; this.siren[1].type = 'square';
    this.sirenS = ctx.createWaveShaper();
    { const c = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = (i / 511) * 2 - 1; c[i] = Math.tanh(x * 2.2); } this.sirenS.curve = c; }
    this.sirenF = ctx.createBiquadFilter(); this.sirenF.type = 'bandpass'; this.sirenF.frequency.value = 1300; this.sirenF.Q.value = 0.8;
    this.sirenG = ctx.createGain(); this.sirenG.gain.value = 0;
    for (const o of this.siren) { o.connect(this.sirenS); o.frequency.value = 800; o.start(); }
    this.sirenS.connect(this.sirenF).connect(this.sirenG).connect(this.sfxBus);
    this.sirenMode = 0; this.sirenT = 0;
    // starter motor: a geared whine chopped by the compression strokes
    this.starter = ctx.createOscillator(); this.starter.type = 'sawtooth';
    this.starterF = ctx.createBiquadFilter(); this.starterF.type = 'lowpass'; this.starterF.frequency.value = 900;
    this.starterG = ctx.createGain(); this.starterG.gain.value = 0;
    this.starter.connect(this.starterF).connect(this.starterG).connect(this.engineBus);
    this.starter.start();
    this.startT = 0;
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
      // (far away the highs go first: distance darkens the sound, it does not only turn it down)
      const near = clamp(1 - c.dist / 70, 0, 1);
      v.lp.frequency.setTargetAtTime(((heavy ? 260 : 420) + push * 500 + kmh * 2) * (0.45 + 0.55 * near), t, 0.1);
      v.rf.frequency.setTargetAtTime((260 + kmh * 3.2) * doppler * (0.5 + 0.5 * near), t, 0.1);
      v.eng.gain.setTargetAtTime((heavy ? 0.1 : 0.06) * (0.55 + 0.45 * push), t, 0.1);
      v.rg.gain.setTargetAtTime(Math.pow(clamp(kmh / 110, 0, 1.2), 1.5) * (heavy ? 0.16 : 0.11), t, 0.1);
      v.level = att * 0.36;
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
    this.wEngine.port.postMessage({ cyl: e.cyl, uneven: e.uneven, res: e.res, rad: e.rad, mix: e.mix, noise: e.noise, decay: e.decay, diesel: e.diesel, drive: e.drive, red: e.red, mech: (this.prof && this.prof.mech) || 0.1 });
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
    // wind: pink noise, low-passed (white noise read as a hiss at high speed, the R34's top end most)
    this.wind = mk(this.pink, 'lowpass', 700, 0.4, this.ambBus);
    this.windHi = mk(this.pink, 'bandpass', 1400, 0.7, this.ambBus);
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
    // the vehicle's sound identity (vehicleaudio.js); its engine family wins over the spec's
    this.prof = VEHICLE_AUDIO[this.car.id] || DEFAULT_AUDIO;
    this.eng = ENGINES[this.prof.eng] || ENGINES[this.car.type] || ENGINES.v8;
    this.diesel = /^diesel/.test(this.prof.eng || this.car.type);
    this.boost = 0;
    this.setSiren(0);
    this.gear = 0;
    this.rpm = this.eng.idle;
    if (!this.ctx) return;
    const e = this.eng, diesel = this.diesel, P = this.prof;
    this.eFilter.frequency.value = Math.min(3000, e.lp * 0.6);
    this.eFilter2.frequency.value = Math.min(3900, e.lp * 0.8);
    // (bigger bodies resonate more: vans, buses)
    this.eBody.gain.value = (e.cyl >= 8 ? 7 : diesel ? 8 : 5) + ((P.body || 1) - 1) * 6;
    // horns: trucks get an air horn chord, small cars a thin beep
    const horn = P.horn || this.car.horn || (diesel ? 'truck' : e.cyl <= 4 ? 'small' : 'car');
    // two notes and the horn's band: small cars high and short, trucks low, the air horn lowest
    const H = { small: [520, 660, 1400], car: [415, 523, 1000], firm: [392, 494, 950], deep: [330, 415, 800], truck: [220, 277, 650], bus: [196, 247, 600], air: [150, 185, 520] }[horn] || [415, 523, 1000];
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
          g++; this.shiftT = this.prof.shift.t; this.gearHold = 0.6; this._gearEvent(true);
        } else if (g > 0 && rpmIn(g - 1) < e.red * down) { g--; this.shiftT = this.prof.shift.t * 0.6; this.gearHold = 0.45; this._gearEvent(false); }
      }
      this.gear = g;
      target = Math.max(e.idle, rpmIn(g));
      // clutch slip at launch
      if (kmh < 18 && g === 0) target = Math.max(target, e.idle + p.throttle * e.red * 0.45);
      target = Math.min(target, e.red * 1.02);
    }
    if (this.shiftT > 0) this.shiftT -= dt;
    const shifting = this.shiftT > 0;
    // starting: the starter turns the engine over, then it catches and flares above idle
    if (this.startT > 0) {
      this.startT -= dt;
      target = this.startT > 0 ? e.idle * 0.25 : e.idle * 1.5;
      if (this.startT <= 0) { this.starterG.gain.setTargetAtTime(0, ctx.currentTime, 0.04); this.rpm = e.idle * 1.5; }
    }
    // a downshift blip: the revs jump before the gear takes hold
    if (this.blipT > 0) { this.blipT -= dt; target = Math.max(target, this.rpm + e.red * 0.12 * this.prof.shift.blip); }
    const rate = shifting ? 16 : target > this.rpm ? this.prof.rev : this.prof.revDn;
    this.rpm = lerp(this.rpm, target, 1 - Math.exp(-dt * rate));
    const load = shifting ? 0.05 : clamp(p.throttle, 0, 1);
    this.throttleLP = lerp(this.throttleLP, load, 1 - Math.exp(-dt * 12));
    const rn = this.rpm / e.red;
    const tunnelBoost = 1 + this.inTunnel * 0.3;
    if (this.wEngine) {
      const P = this.wEngine.parameters;
      P.get('rpm').setTargetAtTime(this.rpm, t, 0.015);
      P.get('load').setTargetAtTime(this.throttleLP, t, 0.03);
      P.get('gain').setTargetAtTime((0.6 + rn * 0.7) * tunnelBoost, t, 0.04);
    } else {
      const fire = (this.rpm / 60) * (e.cyl / 2);
      for (const [o, mul] of this.fb) o.frequency.setTargetAtTime(fire * mul * 0.5, t, 0.02);
    }
    const P = this.prof;
    // (the engine is not just louder on throttle: load reshapes it in the worklet; this is the exhaust)
    const starting = this.startT > 0 ? 0 : 1;
    this.eOut.gain.setTargetAtTime((0.22 + this.throttleLP * 0.14) * P.exhaust * starting, t, 0.05);
    // (capped: above ~3 kHz the synthetic pulses only add a whine)
    // (a sealed cabin muffles the engine: the minivan and the ambulance more than the sports car)
    const lpf = Math.min(3000, e.lp * 0.6) * (0.5 + 0.35 * this.throttleLP + 0.3 * rn) * (1 - 0.4 * P.cabin);
    this.eFilter.frequency.setTargetAtTime(lpf, t, 0.05);
    this.eFilter2.frequency.setTargetAtTime(lpf * 1.3, t, 0.05);
    // intake roar rises with rpm and load
    this.roarF.frequency.setTargetAtTime(200 + this.rpm * 0.12, t, 0.05);
    this.roarG.gain.setTargetAtTime((0.006 + this.throttleLP * 0.03) * (0.3 + rn) * P.intake, t, 0.06);
    // gear whine: follows the road speed, louder under load and on the overrun of trucks
    this.whine.frequency.setTargetAtTime(90 + kmh * 7 * (this.diesel ? 0.6 : 1), t, 0.05);
    this.whineF.frequency.setTargetAtTime(90 + kmh * 7 * (this.diesel ? 0.6 : 1), t, 0.05);
    this.whineG.gain.setTargetAtTime(P.whine * 0.012 * clamp(kmh / 40, 0, 1) * (0.4 + 0.6 * Math.abs(this.throttleLP - 0.3)), t, 0.1);
    // engine braking: off throttle at speed, the exhaust rumbles (a retarder's hum on buses)
    const over = kmh > 12 && !p.reverse ? clamp(1 - this.throttleLP * 2, 0, 1) * clamp(rn * 1.4, 0, 1) : 0;
    this.overrunF.frequency.setTargetAtTime((this.diesel ? 140 : 200) + rn * 260, t, 0.1);
    this.overrunG.gain.setTargetAtTime(over * P.ebrake * 0.05, t, 0.12);
    // forced induction
    const TB = P.turbo;
    if (TB) {
      // boost builds with load and revs at the turbo's own pace (small: quick; diesel: slow and strong)
      const want = clamp(this.throttleLP * (rn * 1.5 - 0.25), 0, 1);
      this.boost = lerp(this.boost, want, 1 - Math.exp(-dt * (want > this.boost ? TB.spool : 6)));
      const b = this.boost;
      // (the spool is felt more than heard: a lower, softer band, or at full boost it reads as a hiss)
      this.whooshF.frequency.setTargetAtTime((/^diesel/.test(car.type) ? 450 : 550) + b * 750, t, 0.12);
      this.whooshG.gain.setTargetAtTime(b * b * 0.02 * TB.level, t, 0.1);
      const f = TB.whistle * (0.45 + 0.55 * b);
      this.turbo.frequency.setTargetAtTime(f, t, 0.12);
      this.turbo2.frequency.setTargetAtTime(f * 1.5, t, 0.12);
      this.turboG.gain.setTargetAtTime(b * b * 0.004 * TB.level, t, 0.1);
      // (no blow-off hiss: it read as an exhaust crack)
    } else if (car.blower) {
      this.turbo.frequency.setTargetAtTime(this.rpm * 0.3, t, 0.05);
      this.turbo2.frequency.setTargetAtTime(this.rpm * 0.45, t, 0.05);
      this.turboG.gain.setTargetAtTime(0.002 + rn * 0.006 * (0.4 + this.throttleLP), t, 0.08);
      this.whooshG.gain.setTargetAtTime(0, t, 0.1);
    } else { this.turboG.gain.setTargetAtTime(0, t, 0.1); this.whooshG.gain.setTargetAtTime(0, t, 0.1); }
    // lift-off crackle (V8s, rally, hot hatches)
    const pops = car.pops !== undefined ? car.pops : e.cyl >= 8 ? 0.8 : car.type === 'i4rally' ? 1.4 : /^diesel/.test(car.type) ? 0 : 0.5;
    if (pops > 0 && this.lastThrottle > 0.6 && p.throttle < 0.1 && rn > 0.55) this.popT = 0.6 + pops * 0.3;
    // (no exhaust crackle: the pops read as clicks)
    void pops;
    // diesel air brake when coming to a stop
    if (this.diesel && this.lastSpeed > 3 && kmh <= 3 && p.brake > 0.2) { this._airBrake(); if (P.extra === 'bus') this.doorT = 1.2; }
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
    this.roll.g.gain.setTargetAtTime(clamp(kmh / 250, 0, 0.3), t, 0.1);
    this.roll.fl.frequency.setTargetAtTime(110 + kmh * 1.1, t, 0.1);
    // tyre roar on the asphalt: rises with speed, its band moves up; a slow random wobble stands for
    // the changing surface
    this.treadWob = clamp(this.treadWob + (Math.random() - 0.5) * dt * 1.2, 0.85, 1.15);
    const tr = Math.pow(clamp(kmh / 160, 0, 1.4), 1.3);
    const TY = P.tyre;
    this.tread.g.gain.setTargetAtTime(tr * 0.12 * TY.g * this.treadWob * (1 + this.inTunnel * 0.3), t, 0.08);
    this.tread.fl.frequency.setTargetAtTime(Math.min(1300, 380 + kmh * 3.5) * TY.f, t, 0.1);
    // (coarse tyres: more of the texture band)
    this.treadHi.g.gain.setTargetAtTime(tr * (0.01 + TY.rough * 0.02), t, 0.1);
    this.roll.fl.frequency.setTargetAtTime((110 + kmh * 1.1) * TY.f, t, 0.1);
    // expansion joints of the elevated road: a soft double thump (front, then rear axle) every 40 m
    if (kmh > 25 && !p.reverse) {
      this.jointD += (kmh / 3.6) * dt;
      if (this.jointD > 40) {
        this.jointD = 0;
        const g = clamp(kmh / 140, 0.25, 1) * 0.07;
        // (no thump: it sounded like a crack from the exhaust)
        void g;
      }
    }
    // wind
    const v = kmh / 100;
    // (a low rush that stays low: above ~250 km/h the old curve opened up into a loud hiss)
    // (pink noise is quieter up top than white: the gains are a little higher for the same body)
    this.wind.g.gain.setTargetAtTime(clamp(v * v * 0.09 * P.wind, 0, 0.3) * (1 - this.inTunnel * 0.4), t, 0.1);
    this.wind.fl.frequency.setTargetAtTime(Math.min(900, 300 + kmh * 2.6), t, 0.1);
    this.windHi.g.gain.setTargetAtTime(clamp((v - 1.2) * 0.01, 0, 0.015), t, 0.2);
    // ambience
    this.city.g.gain.setTargetAtTime(0.14 * (1 - this.inTunnel * 0.7), t, 0.4);
    this.traffic.g.gain.setTargetAtTime(clamp(p.trafficNear * 0.008, 0, 0.03), t, 0.4);
    this.inTunnel = lerp(this.inTunnel, p.tunnel ? 1 : 0, 1 - Math.exp(-dt * 3));
    this.revSend.gain.setTargetAtTime(this.inTunnel * 0.55, t, 0.1);
    this.tunnelHum.g.gain.setTargetAtTime(this.inTunnel * 0.08, t, 0.3);
    // horn
    this.horn.gain.setTargetAtTime(p.horn ? (P.horn === 'air' ? 0.2 : 0.14) : 0, t, p.horn ? 0.008 : 0.04);
    this._updateSiren(dt, t);
    this._updateExtras(dt, kmh, p);
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
    // backfire: a low thump plus a sharp crack (and the game shows the flame: onPop)
    if (this.onPop) this.onPop();
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
  // a gear change you hear: the torque cuts (shiftT), the gearbox makes its sound, the revs fall and
  // the engine takes the load again. Automatics barely register; trucks clunk; a downshift can blip.
  _gearEvent(up) {
    const S = this.prof.shift;
    if (S.clunk > 0.02) {
      const g = S.clunk * (S.auto ? 0.4 : 1) * (up ? 1 : 0.8);
      this._burst(0.06 + (this.diesel ? 0.08 : 0), 'bandpass', S.f, 1.6, g * 0.08, this.engineBus);
      if (this.diesel) setTimeout(() => { if (this.ready) this._burst(0.12, 'lowpass', S.f * 0.5, 0.9, g * 0.06, this.engineBus); }, 90);
    }
    if (!up && S.blip > 0 && this.throttleLP > 0.2) this.blipT = 0.12;
  }
  // start the engine: starter whine chopped by compressions, then it catches (drive start)
  engineStart() {
    if (!this.ready) return;
    const st = this.prof.start || { f: 170, t: 0.6 };
    const ctx = this.ctx, t = ctx.currentTime;
    this.startT = st.t;
    this.rpm = 0;
    this.starter.frequency.setValueAtTime(st.f, t);
    this.starterF.frequency.setValueAtTime(st.heavy ? 600 : 1100, t);
    // cranking: the level pulses with each compression (faster as it spins up)
    const g = this.starterG.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    const lvl = st.heavy ? 0.07 : 0.05;
    let x = t;
    for (let k = 0; x < t + st.t; k++) { const per = (st.heavy ? 0.16 : 0.11) * (1 - k * 0.03); g.linearRampToValueAtTime(lvl, x + per * 0.3); g.linearRampToValueAtTime(lvl * 0.35, x + per); x += per; }
    g.linearRampToValueAtTime(0, t + st.t + 0.05);
  }
  // siren: 0 off, 1 wail (slow sweep), 2 yelp (fast sweep), 3 phaser (very fast warble)
  setSiren(mode) {
    this.sirenMode = this.prof && this.prof.siren ? mode % 4 : 0;
    if (this.ctx) this.sirenG.gain.setTargetAtTime(this.sirenMode ? 0.075 : 0, this.ctx.currentTime, 0.05);
    return this.sirenMode;
  }
  cycleSiren() { return this.setSiren((this.sirenMode || 0) + 1); }
  _updateSiren(dt, t) {
    if (!this.sirenMode) return;
    this.sirenT += dt;
    const low = this.prof.sirenLow ? 0.72 : 1;
    let f;
    if (this.sirenMode === 1) { const u = 0.5 - 0.5 * Math.cos(this.sirenT * 2 * Math.PI / 4.4); f = 620 + 780 * u; }
    else if (this.sirenMode === 2) { const u = 0.5 - 0.5 * Math.cos(this.sirenT * 2 * Math.PI / 0.32); f = 650 + 750 * u; }
    else { const u = (Math.sin(this.sirenT * 2 * Math.PI * 11) > 0 ? 1 : 0) * 0.7 + 0.3 * Math.random(); f = 1150 + 500 * u; }
    f *= low;
    this.siren[0].frequency.setTargetAtTime(f, t, 0.012);
    this.siren[1].frequency.setTargetAtTime(f * 1.006, t, 0.012);
    this.sirenF.frequency.setTargetAtTime(f * 1.4, t, 0.02);
  }
  // vehicle extras: the refuse truck's compactor when stopped, the bus's doors and air compressor
  _updateExtras(dt, kmh, p) {
    const X = this.prof.extra;
    if (!X) return;
    this.stillT = kmh < 2 ? (this.stillT || 0) + dt : 0;
    if (this.doorT > 0) { this.doorT -= dt; if (this.doorT <= 0) this._burst(0.5, 'bandpass', 1800, 0.9, 0.05, this.sfxBus, 900, 0.01); }
    this.extraT = (this.extraT || 0) - dt;
    if (this.extraT > 0) return;
    if (X === 'garbage' && this.stillT > 3) {
      // hydraulic pump rising, then the compactor blade's thud
      this.extraT = 18 + Math.random() * 14;
      const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(115, t + 2.4);
      f.type = 'lowpass'; f.frequency.value = 500;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.4); g.gain.setValueAtTime(0.05, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      o.connect(f).connect(g).connect(this.sfxBus); o.start(t); o.stop(t + 2.9);
      setTimeout(() => { if (this.ready) this._burst(0.25, 'lowpass', 160, 0.8, 0.12); }, 2700);
    } else if (X === 'bus' && this.stillT > 2) {
      // the air compressor topping up: a few low chugs
      this.extraT = 12 + Math.random() * 10;
      for (let k = 0; k < 6; k++) setTimeout(() => { if (this.ready) this._burst(0.09, 'lowpass', 180, 0.9, 0.035); }, k * 190);
    } else this.extraT = 1;
    void p;
  }
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
