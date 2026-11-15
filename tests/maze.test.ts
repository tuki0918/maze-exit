import { describe, expect, it } from 'vitest';
import { generateMaze, neighbor, type Shape } from '../src/maze';

const shapes: Shape[] = ['cube', 'sphere', 'diamond'];

describe('generateMaze', () => {
  it('同じシードなら同じ迷路になる', () => {
    const a = generateMaze('hello', 9, 'cube');
    const b = generateMaze('hello', 9, 'cube');
    expect(Array.from(a.open)).toEqual(Array.from(b.open));
    expect(a.exitCell).toBe(b.exitCell);
    expect(a.exitDir).toBe(b.exitDir);
  });

  it('シードが違えば迷路も違う', () => {
    const a = generateMaze('hello', 9, 'cube');
    const b = generateMaze('world', 9, 'cube');
    expect(Array.from(a.open)).not.toEqual(Array.from(b.open));
  });

  it('シードの値が固定されている（環境間の再現性チェック用）', () => {
    const m = generateMaze('liquid', 7, 'cube');
    expect([m.exitCell, m.exitDir, m.solutionMoves]).toMatchSnapshot();
  });

  for (const shape of shapes) {
    for (const n of [5, 7, 9, 13]) {
      it(`${shape} ${n}: 全マス到達可能な完全迷路で、出口は外壁にある`, () => {
        const m = generateMaze(`s-${n}`, n, shape);
        const cells = m.mask.reduce((a, b) => a + b, 0);
        expect(m.cellCount).toBe(cells);
        let edges = 0;
        for (let i = 0; i < m.open.length; i++) {
          for (let d = 0; d < 6; d++) {
            if (!(m.open[i] & (1 << d))) continue;
            edges++;
            const nb = neighbor(m, i, d);
            expect(nb).toBeGreaterThanOrEqual(0);
            expect(m.open[nb] & (1 << (d ^ 1))).toBeTruthy();
          }
        }
        expect(edges / 2).toBe(cells - 1); // 木構造 = 閉路なし
        expect(neighbor(m, m.exitCell, m.exitDir)).toBe(-1);
        expect(m.dist[m.start]).toBe(0);
        expect(m.solutionMoves).toBeGreaterThan(n);
      });
    }
  }
});
