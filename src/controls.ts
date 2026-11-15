import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const DRAG = 0.0065; // rad / px
const KEY_SPEED = 1.9; // rad / s

/**
 * 迷路を全方向に回す操作。
 *  - ドラッグ: 画面の X / Y 軸まわりに回転
 *  - Shift+ドラッグ / 右ドラッグ / 2 本指ひねり / Q・E: 画面奥行き軸まわりにロール
 *  - ホイール / ピンチ: ズーム
 *  - 矢印キー・WASD でも回転
 * 離した後は短い慣性で止まる。
 */
export class Controls {
  zoom = 1;
  /** 一度でも操作されたか（タイマー開始の合図） */
  touched = false;
  private acc = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private pts = new Map<number, { x: number; y: number }>();
  private keys = new Set<string>();
  private roll = false;
  private q = new THREE.Quaternion();

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.roll = e.shiftKey || e.button === 2;
      this.touched = true;
    });
    el.addEventListener('pointermove', (e) => this.onMove(e));
    const up = (e: PointerEvent) => this.pts.delete(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom * Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'q', 'e'].includes(k)) {
        this.keys.add(k);
        this.touched = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pts.clear();
    });
  }

  get dragging(): boolean {
    return this.pts.size > 0 || this.keys.size > 0;
  }

  reset(): void {
    this.acc.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.touched = false;
  }

  private setZoom(z: number): void {
    this.zoom = Math.min(2, Math.max(0.55, z));
  }

  private onMove(e: PointerEvent): void {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const nx = e.clientX;
    const ny = e.clientY;
    if (this.pts.size >= 2) {
      // 2 本指: ひねりでロール、ピンチでズーム
      let other: { x: number; y: number } | undefined;
      for (const [id, o] of this.pts) if (id !== e.pointerId) other = o;
      if (other) {
        const a0 = Math.atan2(p.y - other.y, p.x - other.x);
        const a1 = Math.atan2(ny - other.y, nx - other.x);
        this.acc.z -= wrap(a1 - a0);
        const d0 = Math.hypot(p.x - other.x, p.y - other.y);
        const d1 = Math.hypot(nx - other.x, ny - other.y);
        if (d0 > 1 && d1 > 1) this.setZoom((this.zoom * d0) / d1);
      }
    } else if (this.roll) {
      const r = this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      this.acc.z -= wrap(Math.atan2(ny - cy, nx - cx) - Math.atan2(p.y - cy, p.x - cx));
    } else {
      this.acc.y += (nx - p.x) * DRAG;
      this.acc.x += (ny - p.y) * DRAG;
    }
    p.x = nx;
    p.y = ny;
  }

  update(dt: number, target: THREE.Object3D): void {
    const k = this.keys;
    const s = KEY_SPEED * dt;
    if (k.has('arrowleft') || k.has('a')) this.acc.y -= s;
    if (k.has('arrowright') || k.has('d')) this.acc.y += s;
    if (k.has('arrowup') || k.has('w')) this.acc.x -= s;
    if (k.has('arrowdown') || k.has('s')) this.acc.x += s;
    if (k.has('q')) this.acc.z += s;
    if (k.has('e')) this.acc.z -= s;

    if (this.dragging) {
      if (dt > 0) this.vel.lerp(this.acc.clone().divideScalar(dt), 0.45);
    } else {
      this.acc.copy(this.vel).multiplyScalar(dt);
      this.vel.multiplyScalar(Math.exp(-7 * dt));
    }
    const t = target.quaternion;
    if (this.acc.x) t.premultiply(this.q.setFromAxisAngle(X, this.acc.x));
    if (this.acc.y) t.premultiply(this.q.setFromAxisAngle(Y, this.acc.y));
    if (this.acc.z) t.premultiply(this.q.setFromAxisAngle(Z, this.acc.z));
    t.normalize();
    this.acc.set(0, 0, 0);
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
