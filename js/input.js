// Keyboard + gamepad input with edge detection and key remapping.
import { clamp } from './util.js';

export const ACTION_LABELS = {
  accel: 'Acelerar', brake: 'Frear / Ré', left: 'Esquerda', right: 'Direita', horn: 'Buzina',
  lights: 'Faróis', lookLeft: 'Olhar à esquerda', lookRight: 'Olhar à direita', camera: 'Câmera',
  lookback: 'Olhar para trás', reset: 'Reposicionar', map: 'Mapa', pause: 'Pausa',
};
// standard-mapping button names
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guia'];
// the fixed controls (not remappable): driving on the triggers, the left stick and the d-pad's sides
export const PAD_FIXED_LABELS = { accel: 'RT', brake: 'LT', left: 'Analógico / D-pad ←', right: 'Analógico / D-pad →' };
export const padName = b => PAD_NAMES[b] || `Botão ${b}`;

export function keyName(code) {
  if (!code) return '—';
  const map = { Space: 'Espaço', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl', ControlRight: 'Ctrl dir.', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor(bindings, padBindings) {
    this.bindings = bindings;
    this.padBindings = padBindings; // action -> [button index] (settings.js DEFAULT_PAD)
    this.padCapture = null; // callback(button) while remapping a controller button
    this.down = new Set();
    this.edges = new Set();
    this.padPrev = [];
    this.pad = null;
    this.capture = null; // callback for remapping
    this.enabled = true;
    this.state = { throttle: 0, brake: 0, steer: 0, horn: false, lookback: false, lookSide: 0, analogSteer: false };
    this.lastDevice = 'keyboard';
    window.addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); e.stopImmediatePropagation(); const cb = this.capture; this.capture = null; cb(e.code); return; }
      if (this.padCapture) { e.preventDefault(); e.stopImmediatePropagation(); const cb = this.padCapture; this.padCapture = null; cb(e.code === 'Delete' || e.code === 'Backspace' ? 'remove' : null); return; }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && this.enabled) e.preventDefault();
      if (!this.down.has(e.code)) this.edges.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', e => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }
  isDown(action) { return (this.bindings[action] || []).some(c => this.down.has(c)); }
  keyPressed(action) { return (this.bindings[action] || []).some(c => this.edges.has(c)); }
  pressed(action) { return this.keyPressed(action) || this.padActionPressed(action); }
  padActionPressed(action) { return (this.padBindings[action] || []).some(b => this._padEdge(b)); }
  _padDown(action) { const p = this.pad; return !!p && (this.padBindings[action] || []).some(b => p.buttons[b] && p.buttons[b].pressed); }
  _padEdge(b) {
    const p = this.pad;
    if (!p || !p.buttons[b]) return false;
    return p.buttons[b].pressed && !this.padPrev[b];
  }
  padPressed(b) { return this._padEdge(b); }
  poll() {
    let pad = null;
    try {
      // only standard-mapped controllers: wheels and odd devices often report buttons as held
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    } catch (e) { pad = null; }
    // a newly seen pad starts with its current button state, so held buttons are not "presses"
    if (pad && (!this.pad || this.pad.index !== pad.index)) this.padPrev = pad.buttons.map(b => b.pressed);
    this.pad = pad;
    // remapping: the next button pressed (not one of the fixed driving controls) is the answer
    if (this.padCapture && pad) {
      const b = pad.buttons.findIndex((x, i) => x.pressed && !this.padPrev[i] && ![6, 7, 14, 15].includes(i));
      if (b >= 0) { const cb = this.padCapture; this.padCapture = null; cb(b); }
    }
    const st = this.state;
    let thr = this.isDown('accel') ? 1 : 0;
    let brk = this.isDown('brake') ? 1 : 0;
    let steer = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let horn = this.isDown('horn');
    let look = this.isDown('lookback');
    let side = (this.isDown('lookRight') ? 1 : 0) - (this.isDown('lookLeft') ? 1 : 0);
    st.analogSteer = false;
    if (pad) {
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      let ax = pad.axes[0] || 0;
      const dz = 0.12;
      ax = Math.abs(ax) < dz ? 0 : (ax - Math.sign(ax) * dz) / (1 - dz);
      ax = Math.sign(ax) * Math.pow(Math.abs(ax), 1.5);
      if (rt > 0.05 || lt > 0.05 || Math.abs(ax) > 0.01 || pad.buttons.some(b => b.pressed)) this.lastDevice = 'gamepad';
      thr = Math.max(thr, rt);
      brk = Math.max(brk, lt);
      if (Math.abs(ax) > 0.01) { steer = ax; st.analogSteer = true; }
      if (pad.buttons[14] && pad.buttons[14].pressed) steer = -1;
      if (pad.buttons[15] && pad.buttons[15].pressed) steer = 1;
      horn = horn || this._padDown('horn');
      look = look || this._padDown('lookback');
      if (this._padDown('lookLeft')) side = -1;
      if (this._padDown('lookRight')) side = 1;
    }
    st.throttle = clamp(thr, 0, 1);
    st.brake = clamp(brk, 0, 1);
    st.steer = clamp(steer, -1, 1);
    st.horn = horn;
    st.lookback = look;
    st.lookSide = side;
    return st;
  }
  endFrame() {
    this.edges.clear();
    const p = this.pad;
    this.padPrev = p ? p.buttons.map(b => b.pressed) : [];
  }
  rumble(strong, weak, ms) {
    const p = this.pad;
    if (!p || !p.vibrationActuator) return;
    try { p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }); } catch (e) { /* unsupported */ }
  }
  get hasPad() { return !!this.pad; }
}
