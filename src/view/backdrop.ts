import * as THREE from 'three';
import { RNG } from '../rng';

const COLS = 12;
const ROWS = 16;
const MESH_Z = -520;
const EXTENT = 1.25; // 画面端より少し外まで張る
const DARK = new THREE.Color(0x149fda);
const LIGHT = new THREE.Color(0x8fe9fd);

/**
 * 背景。カメラに固定して使う（迷路を回しても動かない）。
 *  - 面: 三角形で分割した板。頂点がゆっくり波打ち、面ごとの明るさが変わる
 *  - 結晶: 画面の縁に寄せた白いローポリ。奥ほど小さく薄い 3 層
 * 配置は固定シードの乱数なので毎回同じ。
 */
export class Backdrop {
  readonly group = new THREE.Group();
  private tan: number;
  private aspect = 1;
  // 面
  private grid: Float32Array; // 頂点ごとの x, y（-EXTENT..EXTENT）と位相
  private tris: Uint16Array; // 三角形ごとの頂点番号 ×3
  private tint: Float32Array; // 三角形ごとの明るさのばらつき
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  private z: Float32Array;
  // 結晶
  private crystals: THREE.Group[] = [];
  private c = new THREE.Color();

  constructor(fovDeg: number) {
    this.tan = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
    const rng = new RNG('backdrop');

    // --- 三角形分割した面 ---
    const vx = COLS + 1;
    const vy = ROWS + 1;
    this.grid = new Float32Array(vx * vy * 3);
    this.z = new Float32Array(vx * vy);
    for (let j = 0; j < vy; j++)
      for (let i = 0; i < vx; i++) {
        const edge = i === 0 || j === 0 || i === COLS || j === ROWS;
        const jx = edge ? 0 : (rng.next() - 0.5) * 0.7;
        const jy = edge ? 0 : (rng.next() - 0.5) * 0.7;
        const k = (i + j * vx) * 3;
        this.grid[k] = ((i + jx) / COLS - 0.5) * 2 * EXTENT;
        this.grid[k + 1] = ((j + jy) / ROWS - 0.5) * 2 * EXTENT;
        this.grid[k + 2] = rng.next() * Math.PI * 2;
      }
    const tris: number[] = [];
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++) {
        const a = i + j * vx;
        const b = a + 1;
        const c = a + vx;
        const d = c + 1;
        if ((i + j) % 2) tris.push(a, b, d, a, d, c);
        else tris.push(a, b, c, b, d, c);
      }
    this.tris = new Uint16Array(tris);
    const count = tris.length / 3;
    this.tint = new Float32Array(count);
    for (let t = 0; t < count; t++) this.tint[t] = (rng.next() - 0.5) * 0.09;
    this.pos = new Float32Array(count * 9);
    this.col = new Float32Array(count * 9);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const plane = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false }));
    plane.frustumCulled = false;
    plane.renderOrder = -10;
    this.group.add(plane);

    // --- 結晶 ---
    const stretch = (g: THREE.BufferGeometry, y: number) => g.scale(1, y, 1);
    const geos = [
      stretch(new THREE.OctahedronGeometry(1), 1.5),
      new THREE.IcosahedronGeometry(1, 0),
      stretch(new THREE.TetrahedronGeometry(1), 1.2),
      new THREE.DodecahedronGeometry(1, 0),
    ];
    const edges = geos.map((g) => new THREE.EdgesGeometry(g, 1));
    const layers = [
      { z: -300, n: 5, size: [0.085, 0.13], face: 0.5, edge: 0.7 },
      { z: -380, n: 6, size: [0.055, 0.085], face: 0.34, edge: 0.45 },
      { z: -460, n: 7, size: [0.03, 0.055], face: 0.22, edge: 0.28 },
    ];
    for (const L of layers) {
      const face = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: L.face });
      const line = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: L.edge });
      for (let n = 0; n < L.n; n++) {
        // 中央（迷路）と、上下中央（時間・手数の文字）を避けて置く
        let x = 0;
        let y = 0;
        for (let tries = 0; tries < 40; tries++) {
          x = (rng.next() * 2 - 1) * 1.02;
          y = (rng.next() * 2 - 1) * 1.02;
          const centre = Math.hypot(x, y) < 0.5;
          const text = Math.abs(x) < 0.55 && Math.abs(y) > 0.62;
          const crowded = this.crystals.some((o) => Math.hypot(o.userData.x - x, o.userData.y - y) < 0.3);
          if (!centre && !text && !crowded) break;
        }
        const gi = rng.int(geos.length);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(geos[gi], face), new THREE.LineSegments(edges[gi], line));
        const hh = this.tan * -L.z;
        g.scale.setScalar(hh * (L.size[0] + rng.next() * (L.size[1] - L.size[0])));
        g.rotation.set(rng.next() * 6.28, rng.next() * 6.28, rng.next() * 6.28);
        g.userData = {
          x,
          y,
          z: L.z,
          phase: rng.next() * 6.28,
          spin: new THREE.Vector3(rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5).multiplyScalar(0.25),
        };
        this.crystals.push(g);
        this.group.add(g);
      }
    }
    this.resize(1);
    this.update(0, 0);
  }

  resize(aspect: number): void {
    this.aspect = aspect;
  }

  update(time: number, dt: number): void {
    // 面: 頂点の高さを波打たせ、面の傾きから明るさを決める
    const hh = this.tan * -MESH_Z;
    const hw = hh * this.aspect;
    const g = this.grid;
    for (let v = 0; v < this.z.length; v++) {
      const k = v * 3;
      this.z[v] = Math.sin(g[k] * 2.6 + time * 0.22 + g[k + 2]) + Math.cos(g[k + 1] * 3.1 - time * 0.17 + g[k + 2] * 0.5);
    }
    const p = this.pos;
    const c = this.col;
    for (let t = 0; t < this.tint.length; t++) {
      const i0 = this.tris[t * 3];
      const i1 = this.tris[t * 3 + 1];
      const i2 = this.tris[t * 3 + 2];
      const ax = g[i0 * 3];
      const ay = g[i0 * 3 + 1];
      const bx = g[i1 * 3];
      const by = g[i1 * 3 + 1];
      const cx = g[i2 * 3];
      const cy = g[i2 * 3 + 1];
      // 面の傾き（高さの差）を光の向きに当てる
      const slope = (this.z[i1] - this.z[i0]) * 0.55 + (this.z[i2] - this.z[i0]) * 0.35;
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      const glow = Math.max(0, 1 - Math.hypot(mx, my) / 1.15);
      const k = Math.min(1, Math.max(0, 0.24 + slope * 0.09 + this.tint[t] + glow * 0.6));
      this.c.copy(DARK).lerp(LIGHT, k);
      const o = t * 9;
      p[o] = ax * hw;
      p[o + 1] = ay * hh;
      p[o + 2] = MESH_Z;
      p[o + 3] = bx * hw;
      p[o + 4] = by * hh;
      p[o + 5] = MESH_Z;
      p[o + 6] = cx * hw;
      p[o + 7] = cy * hh;
      p[o + 8] = MESH_Z;
      for (let n = 0; n < 3; n++) {
        c[o + n * 3] = this.c.r;
        c[o + n * 3 + 1] = this.c.g;
        c[o + n * 3 + 2] = this.c.b;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;

    // 結晶: ゆっくり回りながら上下に漂う
    for (const o of this.crystals) {
      const u = o.userData;
      const h = this.tan * -u.z;
      o.position.set(u.x * h * this.aspect, (u.y + Math.sin(time * 0.35 + u.phase) * 0.025) * h, u.z);
      o.rotation.x += u.spin.x * dt;
      o.rotation.y += u.spin.y * dt;
      o.rotation.z += u.spin.z * dt;
    }
  }
}
