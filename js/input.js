// Keyboard + gamepad input with edge detection and key remapping.
import { clamp } from './util.js';

export const ACTION_LABELS = {
  accel: 'Acelerar', brake: 'Frear / Ré', left: 'Esquerda', right: 'Direita', horn: 'Buzina',
  lights: 'Faróis', lookLeft: 'Olhar à esquerda', lookRight: 'Olhar à direita', camera: 'Câmera',
  lookback: 'Olhar para trás', reset: 'Reposicionar', map: 'Mapa', pause: 'Pausa',
};
export const PAD_LABELS = {
  accel: 'RT', brake: 'LT', left: 'Analógico esq.', right: 'Analógico esq.', horn: 'B', lights: 'Y',
  lookLeft: 'LB', lookRight: 'RB', camera: 'View / Select', lookback: 'R3', reset: 'D-pad ↑', map: 'L3', pause: 'Start',
};
const PAD_BUTTON = { horn: 1, lights: 3, camera: 8, pause: 9, lookback: 11, reset: 12, map: 10 };

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
  constructor(bindings) {
    this.bindings = bindings;
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
  pressed(action) {
    if (this.keyPressed(action)) return true;
    const b = PAD_BUTTON[action];
    return b !== undefined && this._padEdge(b);
  }
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
      horn = horn || !!(pad.buttons[1] && pad.buttons[1].pressed);
      look = look || !!(pad.buttons[11] && pad.buttons[11].pressed);
      if (pad.buttons[4] && pad.buttons[4].pressed) side = -1;
      if (pad.buttons[5] && pad.buttons[5].pressed) side = 1;
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
