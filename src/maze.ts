import { RNG } from './rng';

export type Shape = 'cube' | 'sphere' | 'diamond';

/** 方向 d の反対は d ^ 1 */
export const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** 生成アルゴリズムを変えたら上げる（同じシードでも迷路が変わるため） */
export const MAZE_VERSION = 1;

export interface Maze {
  seed: string;
  n: number;
  shape: Shape;
  /** 1 = 迷路に含まれるマス */
  mask: Uint8Array;
  /** マスごとの通路ビットマスク（bit d = 方向 d に通れる） */
  open: Uint8Array;
  cellCount: number;
  start: number;
  exitCell: number;
  /** exitCell から外へ出る方向 */
  exitDir: number;
  /** start からの距離（マス数） */
  dist: Int32Array;
  /** 最短手数（出口から外に出る 1 手を含む） */
  solutionMoves: number;
}

export function cellXYZ(n: number, cell: number): [number, number, number] {
  return [cell % n, Math.floor(cell / n) % n, Math.floor(cell / (n * n))];
}

/** 方向 d の隣マス。範囲外・形状外なら -1 */
export function neighbor(m: { n: number; mask: Uint8Array }, cell: number, d: number): number {
  const n = m.n;
  const [x, y, z] = cellXYZ(n, cell);
  const nx = x + DIRS[d][0];
  const ny = y + DIRS[d][1];
  const nz = z + DIRS[d][2];
  if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) return -1;
  const i = nx + ny * n + nz * n * n;
  return m.mask[i] ? i : -1;
}

function buildMask(n: number, shape: Shape): Uint8Array {
  const mask = new Uint8Array(n * n * n);
  const c = (n - 1) / 2;
  for (let i = 0; i < mask.length; i++) {
    const [x, y, z] = cellXYZ(n, i);
    const dx = Math.abs(x - c);
    const dy = Math.abs(y - c);
    const dz = Math.abs(z - c);
    let inside = true;
    if (shape === 'sphere') inside = dx * dx + dy * dy + dz * dz <= (c + 0.35) * (c + 0.35);
    else if (shape === 'diamond') inside = dx + dy + dz <= Math.floor(c * 1.5);
    mask[i] = inside ? 1 : 0;
  }
  return mask;
}

/**
 * Growing Tree 法による 3D 完全迷路（閉路なし＝分岐した一本道の集合）。
 *  - 掘り進めるマスは 82% で「最新」(深さ優先 → 長い通路)、18% で「ランダム」(分岐を増やす)
 *  - 直進方向の重みを下げ、曲がり・ねじれを多くする
 */
export function generateMaze(seed: string, size: number, shape: Shape): Maze {
  const n = Math.max(3, size | 1); // 中央マスが存在するよう奇数に
  const rng = new RNG(`v${MAZE_VERSION}|${shape}|${n}|${seed}`);
  const mask = buildMask(n, shape);
  const total = n * n * n;
  const open = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const entry = new Int8Array(total).fill(-1);
  const c = (n - 1) / 2;
  const start = c + c * n + c * n * n;
  const m = { n, mask };

  const NEWEST = 0.82;
  const STRAIGHT_WEIGHT = 0.3;

  const active: number[] = [start];
  visited[start] = 1;
  const cand: number[] = [];
  const weight: number[] = [];

  while (active.length > 0) {
    const ai = rng.next() < NEWEST ? active.length - 1 : rng.int(active.length);
    const cell = active[ai];
    cand.length = 0;
    weight.length = 0;
    let sum = 0;
    for (let d = 0; d < 6; d++) {
      const nb = neighbor(m, cell, d);
      if (nb < 0 || visited[nb]) continue;
      const w = d === entry[cell] ? STRAIGHT_WEIGHT : 1;
      cand.push(d);
      weight.push(w);
      sum += w;
    }
    if (cand.length === 0) {
      active[ai] = active[active.length - 1];
      active.pop();
      continue;
    }
    let r = rng.next() * sum;
    let pick = cand.length - 1;
    for (let i = 0; i < cand.length; i++) {
      r -= weight[i];
      if (r < 0) {
        pick = i;
        break;
      }
    }
    const d = cand[pick];
    const nb = neighbor(m, cell, d);
    open[cell] |= 1 << d;
    open[nb] |= 1 << (d ^ 1);
    visited[nb] = 1;
    entry[nb] = d;
    active.push(nb);
  }

  // start からの距離 (BFS)
  const dist = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  let cellCount = 0;
  while (head < tail) {
    const cell = queue[head++];
    cellCount++;
    for (let d = 0; d < 6; d++) {
      if (!(open[cell] & (1 << d))) continue;
      const nb = neighbor(m, cell, d);
      if (dist[nb] >= 0) continue;
      dist[nb] = dist[cell] + 1;
      queue[tail++] = nb;
    }
  }

  // 出口: 外壁に面したマスのうち、中央から最も遠いもの
  let exitCell = start;
  let best = -1;
  for (let i = 0; i < total; i++) {
    if (!mask[i] || dist[i] <= best) continue;
    let onSurface = false;
    for (let d = 0; d < 6; d++) if (neighbor(m, i, d) < 0) onSurface = true;
    if (onSurface) {
      best = dist[i];
      exitCell = i;
    }
  }
  const exits: number[] = [];
  for (let d = 0; d < 6; d++) if (neighbor(m, exitCell, d) < 0) exits.push(d);
  const exitDir = exits[rng.int(exits.length)];

  return {
    seed,
    n,
    shape,
    mask,
    open,
    cellCount,
    start,
    exitCell,
    exitDir,
    dist,
    solutionMoves: dist[exitCell] + 1,
  };
}
