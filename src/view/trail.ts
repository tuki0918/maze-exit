import * as THREE from 'three';
import { DIRS } from '../maze';

export type TrailStyle = 'slide' | 'line';

const MAX_VISITS = 6000;
const MAX_TILES = MAX_VISITS * 5;
const THICK = 0.2;
const TILE = 0.84; // 壁 1 面に対するタイルの大きさ（すき間でマス目が見える）
const INSET = 0.04; // 壁から内側へ浮かせる量

/**
 * 液体が通った跡。1 回の訪問（= 1 手で着いたマス）ごとに記録する。
 *  - slide: 液体がすべった面（もたれていた壁）だけをタイル状に塗る
 *  - line:  マスの中心を結ぶバー
 * 深度テストなしなので迷路の壁越しでも見える。直近 `recent` 手は強調色。
 */
export class Trail {
  readonly group = new THREE.Group();
  /** 記録済みの訪問数（開始マスを含む） */
  visits = 0;
  /** 表示中の手数（リプレイで巻き戻すと total より小さくなる） */
  head = 0;
  recent = 8;
  mode: 'play' | 'replay' = 'play';
  private tiles: THREE.InstancedMesh;
  private bars: THREE.InstancedMesh;
  /** tileStart[v] = 訪問 v の最初のタイル番号 */
  private tileStart: number[] = [0];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(TILE, TILE, 1);
  private n = new THREE.Vector3();
  private c = new THREE.Color();
  private base = new THREE.Color();
  private playBase = new THREE.Color(0x0b4fd6);
  private hot = new THREE.Color(0xff3d8b);
  private hottest = new THREE.Color(0xffd60a);

  constructor(style: TrailStyle) {
    const tileMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), tileMat, MAX_TILES);
    const barMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    this.bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), barMat, MAX_VISITS);
    for (const mesh of [this.tiles, this.bars]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      mesh.setColorAt(0, this.c.setRGB(0, 0, 0));
      this.group.add(mesh);
    }
    this.setStyle(style);
  }

  /** 記録済みの手数 */
  get total(): number {
    return Math.max(0, this.visits - 1);
  }

  setStyle(style: TrailStyle): void {
    this.tiles.visible = style === 'slide';
    this.bars.visible = style === 'line';
  }

  reset(): void {
    this.visits = 0;
    this.head = 0;
    this.tileStart = [0];
    this.tiles.count = 0;
    this.bars.count = 0;
  }

  /**
   * @param pos   着いたマスの中心
   * @param prev  直前のマスの中心（開始マスは null）
   * @param walls そのマスの閉じている面の方向
   */
  addVisit(pos: THREE.Vector3, prev: THREE.Vector3 | null, walls: number[]): void {
    if (this.visits >= MAX_VISITS) return;
    let t = this.tileStart[this.visits];
    for (const d of walls) {
      this.n.set(DIRS[d][0], DIRS[d][1], DIRS[d][2]);
      this.q.setFromUnitVectors(Z, this.n);
      this.p.copy(pos).addScaledVector(this.n, 0.5 - INSET);
      this.tiles.setMatrixAt(t++, this.m.compose(this.p, this.q, this.s));
    }
    this.tileStart.push(t);
    this.tiles.instanceMatrix.needsUpdate = true;
    if (prev) {
      const sx = Math.abs(pos.x - prev.x) + THICK;
      const sy = Math.abs(pos.y - prev.y) + THICK;
      const sz = Math.abs(pos.z - prev.z) + THICK;
      this.m.makeScale(sx, sy, sz).setPosition((pos.x + prev.x) / 2, (pos.y + prev.y) / 2, (pos.z + prev.z) / 2);
      this.bars.setMatrixAt(this.visits - 1, this.m);
      this.bars.instanceMatrix.needsUpdate = true;
    }
    this.visits++;
    this.setHead(this.total);
  }

  setHead(k: number): void {
    const prev = this.head;
    this.head = Math.max(0, Math.min(this.total, k));
    this.tiles.count = this.visits > 0 ? this.tileStart[this.head + 1] : 0;
    this.bars.count = this.head;
    this.recolor(Math.max(0, Math.min(prev, this.head) - this.recent - 1), this.head + 1);
  }

  recolorAll(): void {
    this.recolor(0, this.head + 1);
  }

  private recolor(from: number, to: number): void {
    const end = Math.min(to, this.visits);
    for (let v = from; v < end; v++) {
      if (this.mode === 'replay') this.base.setHSL(0.55 + 0.4 * (v / Math.max(1, this.total)), 0.9, 0.5);
      else this.base.copy(this.playBase);
      const age = this.head - v;
      if (age < this.recent) {
        const t = age / this.recent;
        this.c.copy(this.hottest).lerp(this.hot, Math.min(1, t * 2.5)).lerp(this.base, t * t);
      } else {
        this.c.copy(this.base);
      }
      for (let i = this.tileStart[v]; i < this.tileStart[v + 1]; i++) this.tiles.setColorAt(i, this.c);
      if (v > 0) this.bars.setColorAt(v - 1, this.c);
    }
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true;
  }
}

const Z = new THREE.Vector3(0, 0, 1);
