// Menu music: plays on the title and car-select screens, fades out when a drive starts and back in on
// the way back to the menus. A plain <audio> element (streamed, not decoded in memory), loaded only
// when it first plays. Browsers let a page start sound only after the player interacts with it, so
// the first click / key press starts it (unlock()).
import { clamp } from './util.js';
import { MUSIC_REV } from './version.js';

export const MUSIC_CREDIT = {
  title: 'Warriyo - Mortals (feat. Laura Brehm) [NCS Release]',
  by: 'Music provided by NoCopyrightSounds',
  url: 'http://ncs.io/mortals',
  watch: 'http://youtu.be/yJg-Y5byMMw',
};

export class MenuMusic {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'none';
    this.el.loop = true;
    this.el.volume = 0;
    this.src = 'music/mortals.mp3?v=' + MUSIC_REV;
    this.want = false; // the screen shown wants music
    this.vol = 0.5; // target volume (settings: master x music)
    this.cur = 0;
    this.blocked = false; // play() was refused: waiting for a click / key
  }
  setVolume(v) { this.vol = clamp(v, 0, 1); }
  unlock() { if (this.want && this.el.paused && this.vol > 0) this._play(); }
  _play() {
    if (!this.el.src) this.el.src = this.src;
    const p = this.el.play();
    if (p && p.then) p.then(() => { this.blocked = false; }, () => { this.blocked = true; });
  }
  // every frame: fade toward the wanted volume (1.5 s in, 0.8 s out); pause once silent.
  // Timed on the real clock: the game's dt is capped per frame, which would drag the fade on a slow PC.
  update(want) {
    const now = performance.now(), dt = Math.min(2, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    this.want = want && !document.hidden;
    const target = this.want ? this.vol : 0;
    if (this.want && this.vol > 0 && this.el.paused && !this.blocked) this._play();
    const rate = target > this.cur ? dt / 1.5 : dt / 0.8;
    this.cur = target > this.cur ? Math.min(target, this.cur + rate) : Math.max(target, this.cur - rate);
    // (perceived loudness: a squared curve makes the fade even to the ear)
    this.el.volume = clamp(this.cur * this.cur, 0, 1);
    if (target <= 0 && this.cur <= 0 && !this.el.paused) this.el.pause();
  }
}
