// Sound identity of each vehicle: what the engine is (family in audio.js ENGINES), how the car around it
// shapes it (exhaust, cabin isolation, intake, mechanical noise), how it revs and shifts, its turbo,
// tyres, wind, horn, siren, start and the odd extra (hydraulics, doors, compressor).
// The engine layers (idle / low / mid / high, on and off throttle) are made by the synthesis in
// engine-worklet.js from rpm and load; these numbers steer it per vehicle.
//
//   eng        engine family (audio.js ENGINES)
//   rev, revDn how fast the revs rise / fall (1/s): light cars snap, trucks take their time
//   shift      gear change: t (s of torque cut), clunk (gearbox event level), f (its pitch), blip (rev
//              blip on a downshift), auto (automatic: soft, kick-down)
//   exhaust    exhaust level (1 = normal), cabin: how muffled the engine is inside (0 open .. 1 sealed)
//   intake     intake roar, mech: mechanical noise (valvetrain, injectors, wear), whine: gear whine
//   ebrake     off-throttle rumble (engine braking / retarder)
//   turbo      null or { spool: 1/s, whistle: Hz, level }
//   tyre       { f: pitch, g: level, rough: coarse texture }, wind: level
//   horn       'small' | 'car' | 'firm' | 'deep' | 'truck' | 'bus' | 'air'
//   siren      true: the siren key works (wail / yelp / phaser), with an air horn if horn is 'air'
//   start      { f: starter pitch, t: cranking time, heavy }
//   extra      'garbage' (compactor), 'bus' (doors, air compressor)
const small = { f: 1.1, g: 0.9, rough: 0 }, car = { f: 1, g: 1, rough: 0 }, suv = { f: 0.8, g: 1.15, rough: 0.2 };
const rough = { f: 0.75, g: 1.25, rough: 0.8 }, heavy = { f: 0.6, g: 1.35, rough: 0.35 };
const START = { small: { f: 190, t: 0.45 }, car: { f: 170, t: 0.6 }, v8: { f: 150, t: 0.7 }, diesel: { f: 120, t: 1.1, heavy: true }, truck: { f: 95, t: 1.5, heavy: true } };

export const VEHICLE_AUDIO = {
  // small modern four: light, busy up top, muffled exhaust, quiet mechanics
  g_compact: { eng: 'i4small', rev: 14, revDn: 9, shift: { t: 0.16, clunk: 0.2, f: 900, blip: 0 }, exhaust: 0.8, cabin: 0.35, intake: 0.8, mech: 0.15, whine: 0.1, ebrake: 0.3, turbo: null, tyre: small, wind: 1, horn: 'small', start: START.small },
  // a fuller four with more intake and a small turbo
  g_hatchback: { eng: 'i4sr', rev: 13, revDn: 8, shift: { t: 0.15, clunk: 0.25, f: 850, blip: 0.2 }, exhaust: 0.95, cabin: 0.3, intake: 1.2, mech: 0.15, whine: 0.1, ebrake: 0.35, turbo: { spool: 3, whistle: 2600, level: 0.6 }, tyre: small, wind: 1, horn: 'small', start: START.small },
  // refined four, automatic, isolated
  g_sedan: { eng: 'i4sedan', rev: 10, revDn: 7, shift: { t: 0.22, clunk: 0.05, f: 700, blip: 0, auto: true }, exhaust: 0.75, cabin: 0.55, intake: 0.6, mech: 0.08, whine: 0.05, ebrake: 0.3, turbo: null, tyre: car, wind: 0.9, horn: 'car', start: START.car },
  // like the sedan, a bigger body: more resonance, a more muffled exhaust, a medium turbo
  g_wagon: { eng: 'i4turbo', rev: 9, revDn: 6, shift: { t: 0.22, clunk: 0.05, f: 650, blip: 0, auto: true }, exhaust: 0.7, cabin: 0.5, intake: 0.7, mech: 0.1, whine: 0.05, ebrake: 0.35, turbo: { spool: 1.8, whistle: 2100, level: 0.5 }, tyre: car, wind: 1.1, horn: 'car', start: START.car, body: 1.3 },
  // modern production V6 coupe: more exhaust, quick revs, a rev blip on downshifts
  g_coupe: { eng: 'v6coupe', rev: 16, revDn: 11, shift: { t: 0.12, clunk: 0.3, f: 800, blip: 0.6 }, exhaust: 1.3, cabin: 0.2, intake: 1.2, mech: 0.15, whine: 0.1, ebrake: 0.5, turbo: null, tyre: car, wind: 1, horn: 'firm', start: START.car },
  // the most aggressive light car: open exhaust, snappy revs, loud quick shifts
  g_sport: { eng: 'v10', rev: 22, revDn: 14, shift: { t: 0.07, clunk: 0.45, f: 1000, blip: 0.9 }, exhaust: 1.6, cabin: 0.1, intake: 1.6, mech: 0.2, whine: 0.2, ebrake: 0.6, turbo: null, tyre: car, wind: 1, horn: 'firm', start: START.v8 },
  // quiet family V6, very isolated, automatic, heavier tyres
  g_minivan: { eng: 'v6', rev: 8, revDn: 6, shift: { t: 0.25, clunk: 0.05, f: 600, blip: 0, auto: true }, exhaust: 0.6, cabin: 0.7, intake: 0.5, mech: 0.08, whine: 0.05, ebrake: 0.3, turbo: null, tyre: { f: 0.9, g: 1.15, rough: 0.1 }, wind: 1.25, horn: 'car', start: START.car },
  // big crossplane V8 SUV: solid low end, mass, tyres and body present
  g_suv: { eng: 'v8', rev: 9, revDn: 6, shift: { t: 0.24, clunk: 0.1, f: 500, blip: 0, auto: true }, exhaust: 1.1, cabin: 0.45, intake: 0.9, mech: 0.12, whine: 0.08, ebrake: 0.5, turbo: null, tyre: suv, wind: 1.2, horn: 'deep', start: START.v8, body: 1.2 },
  // rugged 4x4: torque down low, mechanical, drivetrain whine, coarse tyres
  g_offroad: { eng: 'v6truck', rev: 8, revDn: 6, shift: { t: 0.26, clunk: 0.35, f: 420, blip: 0.1 }, exhaust: 1.1, cabin: 0.25, intake: 1, mech: 0.4, whine: 0.35, ebrake: 0.7, turbo: null, tyre: rough, wind: 1.2, horn: 'deep', start: START.v8 },
  // gasoline V8 pickup: heavy, torquey, big tyres, a gearbox you hear
  g_pickup: { eng: 'v8big', rev: 8, revDn: 6, shift: { t: 0.25, clunk: 0.25, f: 450, blip: 0.1, auto: true }, exhaust: 1.25, cabin: 0.3, intake: 1, mech: 0.2, whine: 0.15, ebrake: 0.6, turbo: null, tyre: suv, wind: 1.2, horn: 'deep', start: START.v8 },
  // the sedan, worked all day: a little worn, a gearbox and tyres you hear
  g_taxi: { eng: 'i4sedan', rev: 10, revDn: 7, shift: { t: 0.24, clunk: 0.2, f: 650, blip: 0, auto: true }, exhaust: 0.85, cabin: 0.45, intake: 0.7, mech: 0.35, whine: 0.15, ebrake: 0.35, turbo: null, tyre: { f: 1, g: 1.2, rough: 0.1 }, wind: 0.9, horn: 'car', start: START.car, worn: true },
  // small/medium delivery diesel: rattle, progressive turbo, slow shifts, big body in the wind
  g_postvan: { eng: 'diesel4', rev: 5.5, revDn: 4.5, shift: { t: 0.35, clunk: 0.3, f: 380, blip: 0 }, exhaust: 0.8, cabin: 0.4, intake: 0.8, mech: 0.5, whine: 0.2, ebrake: 0.8, turbo: { spool: 1.2, whistle: 1600, level: 0.9 }, tyre: suv, wind: 1.5, horn: 'deep', start: START.diesel },
  // heavy V8 diesel work truck: slow revs, strong turbo, clunky gearbox, strong engine brake
  g_servicetruck: { eng: 'diesel8', rev: 4.5, revDn: 4, shift: { t: 0.4, clunk: 0.45, f: 320, blip: 0 }, exhaust: 1.1, cabin: 0.3, intake: 0.9, mech: 0.55, whine: 0.3, ebrake: 1, turbo: { spool: 1, whistle: 1400, level: 1.1 }, tyre: heavy, wind: 1.4, horn: 'truck', start: START.diesel },
  // pursuit V8 sedan: quick, aggressive up top, fast shifts, a strong downshift blip; siren
  g_police: { eng: 'v8mod', rev: 15, revDn: 10, shift: { t: 0.1, clunk: 0.2, f: 700, blip: 0.8, auto: true }, exhaust: 1.3, cabin: 0.3, intake: 1.2, mech: 0.15, whine: 0.1, ebrake: 0.55, turbo: null, tyre: car, wind: 1, horn: 'car', siren: true, start: START.v8 },
  // diesel emergency van: muffled, heavy, progressive turbo; siren and an air horn
  g_ambulance: { eng: 'diesel8', rev: 5, revDn: 4.5, shift: { t: 0.35, clunk: 0.2, f: 360, blip: 0, auto: true }, exhaust: 0.8, cabin: 0.55, intake: 0.8, mech: 0.4, whine: 0.2, ebrake: 0.8, turbo: { spool: 1.1, whistle: 1450, level: 0.9 }, tyre: heavy, wind: 1.4, horn: 'air', siren: true, start: START.diesel },
  // the heaviest: a big six diesel, slow revs, huge turbo, clear shifts, strong engine brake;
  // a deep mechanical siren and a powerful air horn
  g_firetruck: { eng: 'diesel6big', rev: 3, revDn: 3, shift: { t: 0.55, clunk: 0.6, f: 250, blip: 0 }, exhaust: 1.2, cabin: 0.2, intake: 1, mech: 0.7, whine: 0.35, ebrake: 1.2, turbo: { spool: 0.7, whistle: 1150, level: 1.3 }, tyre: heavy, wind: 1.6, horn: 'air', siren: true, sirenLow: true, start: START.truck, body: 1.3 },
  // medium/heavy diesel wrecker: torque, heavy clunky shifts, strong engine brake
  g_towtruck: { eng: 'diesel6', rev: 3.8, revDn: 3.5, shift: { t: 0.5, clunk: 0.55, f: 280, blip: 0 }, exhaust: 1.1, cabin: 0.25, intake: 0.9, mech: 0.6, whine: 0.35, ebrake: 1.1, turbo: { spool: 0.8, whistle: 1250, level: 1.1 }, tyre: heavy, wind: 1.4, horn: 'truck', start: START.truck },
  // refuse truck: big diesel, slow and laboured; hydraulics and the compactor now and then when stopped
  g_garbagetruck: { eng: 'diesel6big', rev: 3, revDn: 3, shift: { t: 0.55, clunk: 0.55, f: 260, blip: 0 }, exhaust: 1.05, cabin: 0.25, intake: 0.8, mech: 0.7, whine: 0.3, ebrake: 1.1, turbo: { spool: 0.7, whistle: 1200, level: 1 }, tyre: heavy, wind: 1.5, horn: 'truck', start: START.truck, extra: 'garbage', body: 1.2 },
  // city bus: rear diesel, low revs, muffled, big resonant body, retarder, doors and compressor
  g_citybus: { eng: 'diesel6', rev: 3.2, revDn: 3, shift: { t: 0.45, clunk: 0.3, f: 300, blip: 0, auto: true }, exhaust: 0.85, cabin: 0.5, intake: 0.7, mech: 0.45, whine: 0.3, ebrake: 1.2, turbo: { spool: 0.8, whistle: 1300, level: 0.9 }, tyre: heavy, wind: 1.7, horn: 'bus', start: START.truck, extra: 'bus', body: 1.6 },
  // school bus: rawer than the city bus, front engine, exhaust you hear, a rattly body
  g_schoolbus: { eng: 'diesel6', rev: 3.2, revDn: 3, shift: { t: 0.5, clunk: 0.45, f: 290, blip: 0, auto: true }, exhaust: 1.2, cabin: 0.2, intake: 0.9, mech: 0.65, whine: 0.35, ebrake: 1, turbo: { spool: 0.8, whistle: 1250, level: 1 }, tyre: heavy, wind: 1.6, horn: 'bus', start: START.truck, extra: 'bus', body: 1.5 },
};
// anything not listed: an ordinary car
export const DEFAULT_AUDIO = VEHICLE_AUDIO.g_sedan;
