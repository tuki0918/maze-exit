import * as THREE from 'three';
import { DIRS, cellXYZ, neighbor, type Maze } from '../maze';

export type Style = 'glass' | 'frost' | 'xray';

/** マス中心のローカル座標（迷路の中心が原点、1 マス = 1 unit） */
export function cellPos(m: Maze, cell: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = (m.n - 1) / 2;
  const [x, y, z] = cellXYZ(m.n, cell);
  return out.set(x - c, y - c, z - c);
}

function faceCorners(p: THREE.Vector3, d: number, scale = 1): number[][] {
  const axis = d >> 1;
  const u = [0, 0, 0];
  const v = [0, 0, 0];
  u[(axis + 1) % 3] = 0.5 * scale;
  v[(axis + 2) % 3] = 0.5 * scale;
  const c = [p.x + DIRS[d][0] * 0.5, p.y + DIRS[d][1] * 0.5, p.z + DIRS[d][2] * 0.5];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b]);
}

function pushFace(arr: number[], p: THREE.Vector3, d: number): void {
  const c = faceCorners(p, d);
  for (const i of [0, 1, 2, 0, 2, 3]) arr.push(c[i][0], c[i][1], c[i][2]);
}

function geom(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

const STYLES: Record<Style, { shell: number; shellColor: number; edge: number; wallBase: number; wallBoost: number; skeleton: number }> = {
  // 半透明ガラス: 内壁がうっすら見える
  glass: { shell: 0.13, shellColor: 0xffffff, edge: 0.95, wallBase: 0.05, wallBoost: 0.3, skeleton: 0 },
  // すりガラス（白）: 内部構造は液体の近くしか見えない
  frost: { shell: 0.5, shellColor: 0xffffff, edge: 1, wallBase: 0, wallBoost: 0.2, skeleton: 0 },
  // 透明: 通路の骨格が線で見える（やさしい）
  xray: { shell: 0.05, shellColor: 0xffffff, edge: 0.7, wallBase: 0, wallBoost: 0.24, skeleton: 0.6 },
};

export class MazeView {
  readonly group = new THREE.Group();
  private shellMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  private skelMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  private wallMat: THREE.ShaderMaterial;
  private exitMat = new THREE.MeshBasicMaterial({
    color: 0xffd60a,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  private exitLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false });
  private skeleton: THREE.LineSegments;
  private disposables: { dispose(): void }[] = [];
  readonly exitPos = new THREE.Vector3();

  constructor(maze: Maze, style: Style) {
    const shellPos: number[] = [];
    const wallPos: number[] = [];
    const skelPos: number[] = [];
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();

    for (let cell = 0; cell < maze.mask.length; cell++) {
      if (!maze.mask[cell]) continue;
      cellPos(maze, cell, p);
      for (let d = 0; d < 6; d++) {
        const nb = neighbor(maze, cell, d);
        if (nb < 0) {
          if (!(cell === maze.exitCell && d === maze.exitDir)) pushFace(shellPos, p, d);
        } else if (d % 2 === 0) {
          if (maze.open[cell] & (1 << d)) {
            cellPos(maze, nb, q);
            skelPos.push(p.x, p.y, p.z, q.x, q.y, q.z);
          } else {
            pushFace(wallPos, p, d);
          }
        }
      }
    }

    const shellGeo = geom(shellPos);
    const shell = new THREE.Mesh(shellGeo, this.shellMat);
    shell.renderOrder = 3;
    const edgeGeo = new THREE.EdgesGeometry(shellGeo, 1);
    const edges = new THREE.LineSegments(edgeGeo, this.edgeMat);
    edges.renderOrder = 4;

    this.wallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uLiquid: { value: new THREE.Vector3() },
        uBase: { value: 0.03 },
        uBoost: { value: 0.3 },
        uColor: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLiquid;
        uniform float uBase;
        uniform float uBoost;
        uniform vec3 uColor;
        varying vec3 vPos;
        void main() {
          // 液体の近くの壁だけ濃く見せる（手探り感を残しつつ操作しやすく）
          float k = 1.0 - smoothstep(0.7, 2.4, distance(vPos, uLiquid));
          gl_FragColor = vec4(uColor, uBase + uBoost * k);
        }`,
    });
    const wallGeo = geom(wallPos);
    const walls = new THREE.Mesh(wallGeo, this.wallMat);
    walls.renderOrder = 1;

    const skelGeo = geom(skelPos);
    this.skeleton = new THREE.LineSegments(skelGeo, this.skelMat);
    this.skeleton.renderOrder = 2;

    // 出口マーカー
    cellPos(maze, maze.exitCell, p);
    const dir = DIRS[maze.exitDir];
    this.exitPos.set(p.x + dir[0] * 0.5, p.y + dir[1] * 0.5, p.z + dir[2] * 0.5);
    const quadPos: number[] = [];
    pushFace(quadPos, p, maze.exitDir);
    const quadGeo = geom(quadPos);
    const quad = new THREE.Mesh(quadGeo, this.exitMat);
    quad.renderOrder = 6;
    const framePts: number[] = [];
    for (const s of [1, 0.72]) {
      const c = faceCorners(p, maze.exitDir, s);
      for (let i = 0; i < 4; i++) framePts.push(...c[i], ...c[(i + 1) % 4]);
    }
    const frameGeo = geom(framePts);
    const frame = new THREE.LineSegments(frameGeo, this.exitLineMat);
    frame.renderOrder = 7;

    // 開始マーカー
    const startGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.96, 0.96));
    const startMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const startBox = new THREE.LineSegments(startGeo, startMat);
    cellPos(maze, maze.start, startBox.position);

    this.group.add(walls, this.skeleton, shell, edges, quad, frame, startBox);
    this.disposables.push(shellGeo, edgeGeo, wallGeo, skelGeo, quadGeo, frameGeo, startGeo, startMat);
    this.disposables.push(this.shellMat, this.edgeMat, this.skelMat, this.wallMat, this.exitMat, this.exitLineMat);
    this.setStyle(style);
  }

  setStyle(style: Style): void {
    const s = STYLES[style];
    this.shellMat.opacity = s.shell;
    this.shellMat.color.setHex(s.shellColor);
    this.edgeMat.opacity = s.edge;
    this.wallMat.uniforms.uBase.value = s.wallBase;
    this.wallMat.uniforms.uBoost.value = s.wallBoost;
    this.skelMat.opacity = s.skeleton;
    this.skeleton.visible = s.skeleton > 0;
  }

  update(time: number, liquidPos: THREE.Vector3, flash: number): void {
    (this.wallMat.uniforms.uLiquid.value as THREE.Vector3).copy(liquidPos);
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    this.exitMat.opacity = Math.min(1, 0.55 + 0.3 * pulse + flash);
    this.exitLineMat.opacity = 0.7 + 0.3 * pulse;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
