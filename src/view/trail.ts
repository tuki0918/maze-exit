import * as THREE from 'three';

const MAX = 20000;
const THICK = 0.2;

/**
 * 液体が通った経路。1 手 = 1 本のバー。
 * 深度テストなし + 加算合成なので、迷路の壁越しでも透けて見え、
 * 何度も通った場所ほど明るくなる。直近 `recent` 手は強調色。
 */
export class Trail {
  readonly mesh: THREE.InstancedMesh;
  /** 記録済みの手数 */
  total = 0;
  /** 表示中の手数（リプレイで巻き戻すと total より小さくなる） */
  head = 0;
  recent = 8;
  mode: 'play' | 'replay' = 'play';
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private base = new THREE.Color();
  private hot = new THREE.Color(1.0, 0.22, 0.5);
  private hottest = new THREE.Color(1.0, 0.78, 0.45);

  constructor() {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.setColorAt(0, this.c.setRGB(0, 0, 0));
  }

  reset(): void {
    this.total = 0;
    this.head = 0;
    this.mesh.count = 0;
  }

  add(a: THREE.Vector3, b: THREE.Vector3): void {
    if (this.total >= MAX) return;
    const sx = Math.abs(b.x - a.x) + THICK;
    const sy = Math.abs(b.y - a.y) + THICK;
    const sz = Math.abs(b.z - a.z) + THICK;
    this.m.makeScale(sx, sy, sz).setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.mesh.setMatrixAt(this.total, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.total++;
    this.setHead(this.total);
  }

  setHead(k: number): void {
    const prev = this.head;
    this.head = Math.max(0, Math.min(this.total, k));
    this.mesh.count = this.head;
    this.recolor(Math.max(0, Math.min(prev, this.head) - this.recent - 1), this.head);
  }

  recolorAll(): void {
    this.recolor(0, this.head);
  }

  private recolor(from: number, to: number): void {
    for (let i = from; i < to; i++) {
      if (this.mode === 'replay') {
        this.base.setHSL(0.52 + 0.4 * (i / Math.max(1, this.total - 1)), 0.9, 0.3);
      } else {
        this.base.setRGB(0.05, 0.2, 0.42);
      }
      const age = this.head - 1 - i;
      if (age < this.recent) {
        const t = age / this.recent;
        this.c.copy(this.hottest).lerp(this.hot, Math.min(1, t * 2.5)).lerp(this.base, t * t);
      } else {
        this.c.copy(this.base);
      }
      this.mesh.setColorAt(i, this.c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
