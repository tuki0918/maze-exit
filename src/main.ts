import '@fontsource-variable/outfit';
import * as THREE from 'three';
import { Sfx } from './audio';
import { Controls } from './controls';
import { DIRS, generateMaze, type Maze, type Shape } from './maze';
import { Guide } from './view/guide';
import { Liquid } from './view/liquid';
import { Locator } from './view/locator';
import { MazeView, cellPos, type Style } from './view/mazeView';
import { Particles } from './view/particles';
import { Trail, type TrailStyle } from './view/trail';

type Gfx = 'dot' | 'standard';
type Difficulty = 'easy' | 'normal';
type State = 'ready' | 'playing' | 'won' | 'replay';
interface Config {
  seed: string;
  size: number;
  shape: Shape;
}
interface Settings {
  style: Style;
  gfx: Gfx;
  trail: TrailStyle;
  difficulty: Difficulty;
  recent: number;
  sound: boolean;
}

// ---- 液体の動きの調整値 -------------------------------------------------
const REST_THRESHOLD = 0.45; // 静止中に流れ出すのに必要な傾き（重力との内積）
const FLOW_THRESHOLD = 0.3; // 流れている最中に次のマスへ進み続ける傾き
let V0 = 2.5; // 流れ始めの速度 (マス/秒)
let ACCEL = 18;
let VMAX = 9;
let JUNCTION_PAUSE = 0; // 分岐マスで一旦止まる秒数（Easy のみ）
const REPLAY_RATE = 10; // リプレイ ×1 の手/秒

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 設定の読み書き -----------------------------------------------------
const SHAPES: Shape[] = ['cube', 'sphere', 'diamond'];
const SIZES = [3, 5, 7, 9, 11, 13];

function randomSeed(): string {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function loadSettings(): Settings {
  const def: Settings = { style: 'glass', gfx: 'standard', trail: 'slide', difficulty: 'easy', recent: 8, sound: true };
  try {
    const s: Settings = { ...def, ...JSON.parse(localStorage.getItem('ll:settings') ?? '{}') };
    if (s.gfx !== 'dot') s.gfx = 'standard';
    if (s.trail !== 'line') s.trail = 'slide';
    if (s.difficulty !== 'normal') s.difficulty = 'easy';
    return s;
  } catch {
    return def;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem('ll:settings', JSON.stringify(settings));
  } catch {
    /* プライベートブラウズ等では保存しない */
  }
}

function configFromUrl(): Config {
  const q = new URLSearchParams(location.search);
  const size = Number(q.get('size'));
  const shape = q.get('shape') as Shape;
  return {
    seed: (q.get('seed') ?? '').slice(0, 32) || randomSeed(),
    size: SIZES.includes(size) ? size : 5,
    shape: SHAPES.includes(shape) ? shape : 'cube',
  };
}

function shareUrl(): string {
  const q = new URLSearchParams({ seed: cfg.seed, size: String(cfg.size), shape: cfg.shape });
  return `${location.origin}${location.pathname}?${q}`;
}

const settings = loadSettings();
let cfg = configFromUrl();

// ---- シーン -------------------------------------------------------------
const canvas = $<HTMLCanvasElement>('c');
// 背景は CSS のグラデーション。キャンバスは透過させて重ねる
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 800);

const rig = new THREE.Group(); // これを回す = 迷路を回す
scene.add(rig);
const liquid = new Liquid();
const trail = new Trail();
const guide = new Guide();
const locator = new Locator();
rig.add(liquid.group, trail.group, guide.mesh, locator.group);
const particles = new Particles();
scene.add(particles.points);

// 背景に浮かぶ白いローポリ（迷路より奥に置く）
const decor = new THREE.Group();
scene.add(decor);
scene.add(new THREE.HemisphereLight(0xffffff, 0x4fd0f5, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(1, 2, 3);
scene.add(sun);
{
  const geos = [new THREE.TetrahedronGeometry(1), new THREE.OctahedronGeometry(1), new THREE.IcosahedronGeometry(1, 0)];
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.6 });
  for (let i = 0; i < 30; i++) {
    const mesh = new THREE.Mesh(geos[i % geos.length], mat);
    const a = Math.random() * Math.PI * 2;
    const r = 0.35 + Math.random() * 0.65;
    mesh.position.set(Math.cos(a) * r, Math.sin(a) * r, -0.4 - Math.random());
    mesh.scale.setScalar(0.03 + Math.random() * 0.07);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    mesh.userData.spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    decor.add(mesh);
  }
}

const controls = new Controls(canvas);
const sfx = new Sfx();
sfx.enabled = settings.sound;
canvas.addEventListener('pointerdown', () => sfx.unlock());
window.addEventListener('keydown', () => sfx.unlock());

// ---- ゲーム状態 ---------------------------------------------------------
let maze!: Maze;
let view: MazeView | undefined;
let state: State = 'ready';
let cell = 0;
let moving = false;
let exiting = false;
let moveDir = 0;
let progress = 0;
let speed = V0;
let streak = 0;
let elapsed = 0;
let moves = 0;
let wobble = 0.3;
let stretch = 0;
let flash = 0;
let wonAt = 0;
let time = 0;
let repHead = 0;
let repPlaying = false;
let pause = 0;
/** 各マスから出口へ向かう方向 */
let toExit = new Int8Array(0);
let baseDist = 30;
/** 通過点（ローカル座標）。points[i] → points[i+1] が i 手目 */
let points: THREE.Vector3[] = [];

const pos = new THREE.Vector3();
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const gLocal = new THREE.Vector3();
const dirLocal = new THREE.Vector3(1, 0, 0);
const qInv = new THREE.Quaternion();
const world = new THREE.Vector3();
const tmp = new THREE.Vector3();
const WHITE = new THREE.Color(0xffffff);
const CONFETTI = [0xff3d8b, 0xffd60a, 0xffffff, 0x0b4fd6].map((h) => new THREE.Color(h));

function bestKey(): string {
  return `ll:best:${settings.difficulty}:${cfg.shape}:${cfg.size}:${cfg.seed}`;
}

function startGame(next: Config): void {
  cfg = next;
  if (view) {
    rig.remove(view.group);
    view.dispose();
  }
  maze = generateMaze(cfg.seed, cfg.size, cfg.shape);
  view = new MazeView(maze, settings.style);
  rig.add(view.group);
  rig.quaternion.setFromEuler(new THREE.Euler(0.5, -0.65, 0));
  controls.reset();
  gLocal.set(0, -1, 0).applyQuaternion(qInv.copy(rig.quaternion).invert());

  const easy = settings.difficulty === 'easy';
  V0 = easy ? 1.8 : 2.5;
  ACCEL = easy ? 6 : 18;
  VMAX = easy ? 4 : 9;
  JUNCTION_PAUSE = easy ? 0.35 : 0;
  pause = 0;

  // 出口からの BFS で「出口へ向かう方向」を全マスぶん求める（ガイド用）
  toExit = new Int8Array(maze.mask.length).fill(-1);
  toExit[maze.exitCell] = maze.exitDir;
  const queue = [maze.exitCell];
  for (let i = 0; i < queue.length; i++) {
    for (let d = 0; d < 6; d++) {
      if (!(maze.open[queue[i]] & (1 << d))) continue;
      const nb = queue[i] + stepOf(d);
      if (toExit[nb] >= 0) continue;
      toExit[nb] = d ^ 1;
      queue.push(nb);
    }
  }

  cell = maze.start;
  cellPos(maze, cell, pos);
  points = [pos.clone()];
  trail.mode = 'play';
  trail.reset();
  trail.addVisit(pos, null, slideWall());
  moving = false;
  exiting = false;
  speed = V0;
  streak = 0;
  elapsed = 0;
  moves = 0;
  wobble = 0.3;
  stretch = 0;
  state = 'ready';
  repPlaying = false;
  liquid.group.visible = true;
  liquid.group.scale.setScalar(1);

  history.replaceState(null, '', shareUrl());
  $('info').textContent = `${easy ? 'Easy' : 'Normal'} · ${maze.n}×${maze.n}×${maze.n} · seed ${cfg.seed}`;
  $<HTMLInputElement>('seed').value = cfg.seed;
  setSeg('size', String(cfg.size));
  setSeg('shape', cfg.shape);
  setSeg('difficulty', settings.difficulty);
  $('result').hidden = true;
  $('replay').hidden = true;
  $('hint').classList.remove('off');
  fitCamera();
  refreshAids(cell);
}

function stepOf(d: number): number {
  const n = maze.n;
  return DIRS[d][0] + DIRS[d][1] * n + DIRS[d][2] * n * n;
}

function passable(c: number, d: number): boolean {
  return (maze.open[c] & (1 << d)) !== 0 || (c === maze.exitCell && d === maze.exitDir);
}

/** 今いるマスで液体がもたれている壁（重力に最も沿った閉じた面）。軌跡はここに残す */
function slideWall(): number[] {
  let best = -1;
  let bestDot = 0.05;
  for (let d = 0; d < 6; d++) {
    if (passable(cell, d)) continue;
    const dot = gLocal.x * DIRS[d][0] + gLocal.y * DIRS[d][1] + gLocal.z * DIRS[d][2];
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best < 0 ? [] : [best];
}

/** マス c の壁と通路の表示、Easy なら出口までのガイドを更新 */
function refreshAids(c: number): void {
  const opens: number[] = [];
  for (let d = 0; d < 6; d++) if (passable(c, d)) opens.push(d);
  locator.set(cellPos(maze, c, tmp), opens);
  const pts: THREE.Vector3[] = [];
  if (settings.difficulty === 'easy') {
    let k = c;
    while (k !== maze.exitCell && pts.length < 600) {
      k += stepOf(toExit[k]);
      pts.push(cellPos(maze, k, new THREE.Vector3()));
    }
  }
  guide.set(pts);
}

/** 重力に最も沿った「通れる方向」。しきい値に届かなければ -1 */
function pickDir(threshold: number): number {
  let best = -1;
  let bestDot = threshold;
  for (let d = 0; d < 6; d++) {
    const passable = (maze.open[cell] & (1 << d)) !== 0 || (cell === maze.exitCell && d === maze.exitDir);
    if (!passable) continue;
    const dot = gLocal.x * DIRS[d][0] + gLocal.y * DIRS[d][1] + gLocal.z * DIRS[d][2];
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
}

function beginMove(d: number): void {
  moving = true;
  moveDir = d;
  progress = 0;
  exiting = cell === maze.exitCell && d === maze.exitDir;
  cellPos(maze, cell, from);
  to.set(from.x + DIRS[d][0], from.y + DIRS[d][1], from.z + DIRS[d][2]);
  dirLocal.set(DIRS[d][0], DIRS[d][1], DIRS[d][2]);
  // 行き先のマスを先に見せる（次にどちらへ傾けるか考えやすい）
  if (exiting) {
    locator.hide();
    guide.set([]);
  } else {
    refreshAids(cell + stepOf(d));
  }
}

function arrive(): void {
  pos.copy(to);
  const prev = points[points.length - 1];
  points.push(to.clone());
  moves++;
  streak++;
  sfx.move(streak);
  if (exiting) {
    trail.addVisit(to, prev, []);
    win();
    return;
  }
  // 行き先のマス番号（方向ベクトルから直接求める）
  cell += stepOf(moveDir);
  trail.addVisit(to, prev, slideWall());
  let next = pickDir(FLOW_THRESHOLD);
  if (JUNCTION_PAUSE > 0) {
    // Easy: 分岐マスでは必ず一旦止まり、傾け直す時間を作る
    let exits = 0;
    for (let d = 0; d < 6; d++) if (passable(cell, d)) exits++;
    if (exits >= 3) {
      next = -1;
      pause = JUNCTION_PAUSE;
    }
  }
  if (next < 0) {
    // 行き止まり or 傾き不足 → 着地
    moving = false;
    wobble = Math.min(1.4, 0.5 + speed * 0.1);
    if (streak >= 2) {
      sfx.land();
      particles.burst(liquidWorld(), 6 + Math.round(speed * 1.6), 1.2 + speed * 0.22, WHITE);
    }
    speed = V0;
    streak = 0;
  } else {
    if (next !== moveDir) {
      speed = Math.max(V0, speed * 0.55); // 曲がり角で減速
      wobble = Math.max(wobble, 0.8);
    }
    beginMove(next);
  }
}

function physics(dt: number): void {
  if (pause > 0) {
    pause -= dt;
    return;
  }
  let remaining = dt;
  for (let guard = 0; guard < 8 && remaining > 0; guard++) {
    if (!moving) {
      const d = pickDir(REST_THRESHOLD);
      if (d < 0) break;
      beginMove(d);
    }
    speed = Math.min(VMAX, speed + ACCEL * remaining);
    const need = (1 - progress) / speed;
    if (need > remaining) {
      progress += speed * remaining;
      remaining = 0;
    } else {
      remaining -= need;
      arrive();
      if (state !== 'playing') return;
    }
  }
  if (moving) pos.lerpVectors(from, to, progress);
}

function liquidWorld(): THREE.Vector3 {
  return rig.localToWorld(world.copy(pos));
}

function win(): void {
  state = 'won';
  wonAt = time;
  moving = false;
  flash = 1;
  sfx.goal();
  const w = liquidWorld();
  for (const c of CONFETTI) particles.burst(w, 60, 6.5, c, 0.3, 1.4);

  const ms = Math.round(elapsed * 1000);
  let best = Number(localStorage.getItem(bestKey())) || 0;
  const record = best === 0 || ms < best;
  if (record) {
    best = ms;
    try {
      localStorage.setItem(bestKey(), String(ms));
    } catch {
      /* 保存できなくても続行 */
    }
  }
  $('resTime').textContent = fmt(elapsed);
  $('resMoves').textContent = String(moves);
  $('resShortest').textContent = String(maze.solutionMoves);
  $('resBest').textContent = fmt(best / 1000);
  $('resMode').textContent = `${settings.difficulty === 'easy' ? 'Easy' : 'Normal'} · ${maze.n}×${maze.n}×${maze.n} ${cfg.shape}`;
  $('resSeed').textContent = cfg.seed;
  $('record').hidden = !record;
}

function enterReplay(): void {
  state = 'replay';
  trail.mode = 'replay';
  trail.recolorAll();
  $('result').hidden = true;
  $('replay').hidden = false;
  const seek = $<HTMLInputElement>('repSeek');
  seek.max = String(trail.total);
  liquid.group.visible = true;
  liquid.group.scale.setScalar(1);
  setReplayHead(0);
  repPlaying = true;
  $('repPlay').textContent = 'Pause';
}

function setReplayHead(h: number): void {
  repHead = Math.max(0, Math.min(trail.total, h));
  const i = Math.floor(repHead);
  if (i !== trail.head) trail.setHead(i);
  const a = points[i];
  const b = points[Math.min(points.length - 1, i + 1)];
  pos.lerpVectors(a, b, repHead - i);
  if (b !== a) dirLocal.subVectors(b, a).normalize();
  $<HTMLInputElement>('repSeek').value = String(i);
  $('repPos').textContent = `${i} / ${trail.total}`;
}

function exitReplay(): void {
  state = 'won';
  repPlaying = false;
  trail.setHead(trail.total);
  liquid.group.visible = false;
  $('replay').hidden = true;
  $('result').hidden = false;
}

// ---- 表示 ---------------------------------------------------------------
function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function fitCamera(): void {
  const aspect = camera.aspect;
  const radius = maze.n * (cfg.shape === 'cube' ? 0.87 : 0.62) + 0.8;
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const dist = radius / Math.sin(half) / Math.min(0.82, aspect * 0.8);
  baseDist = dist;
  camera.position.set(0, 0, dist * controls.zoom);
  camera.updateProjectionMatrix();
}

function applyGfx(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ratio = settings.gfx === 'dot' ? Math.max(0.2, 300 / Math.min(w, h)) * 0.6 : Math.min(window.devicePixelRatio, 2);
  canvas.classList.toggle('pixel', settings.gfx === 'dot');
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 背景のローポリは画面いっぱいに散らす
  decor.position.z = -120;
  const spread = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 260;
  decor.scale.set(spread * Math.max(1, w / h), spread, 60);
  liquid.setMode(settings.gfx === 'dot' ? 'dot' : 'fluid');
  if (maze) fitCamera();
}

let toastTimer = 0;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 1800);
}

async function copyShare(): Promise<void> {
  try {
    await navigator.clipboard.writeText(shareUrl());
    toast('Share link copied');
  } catch {
    toast(shareUrl());
  }
}

// ---- メインループ -------------------------------------------------------
let last = performance.now();
let shownTimer = '';
let timerSpans: HTMLSpanElement[] = [];

/** 1 文字ずつ固定幅の枠に入れて更新する（数字が変わっても全体の幅が動かない） */
function setTimer(text: string): void {
  if (timerSpans.length !== text.length) {
    const el = $('timer');
    el.textContent = '';
    timerSpans = [...text].map((ch) => {
      const s = document.createElement('span');
      if (ch === ':' || ch === '.') s.className = 'sep';
      el.append(s);
      return s;
    });
  }
  for (let i = 0; i < text.length; i++) {
    if (timerSpans[i].textContent !== text[i]) timerSpans[i].textContent = text[i];
  }
}
let shownMoves = -1;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function tick(dt: number): void {
  time += dt;

  if (state === 'replay' && !controls.dragging) rig.rotateOnWorldAxis(THREE.Object3D.DEFAULT_UP, dt * 0.25);
  controls.update(dt, rig);
  qInv.copy(rig.quaternion).invert();
  gLocal.set(0, -1, 0).applyQuaternion(qInv);

  if (state === 'ready' && controls.touched && !menuOpen) {
    state = 'playing';
    $('hint').classList.add('off');
  }
  if (state === 'playing' && !menuOpen) {
    elapsed += dt;
    physics(dt);
  } else if (state === 'won') {
    // 出口から飛び出して消える
    const t = time - wonAt;
    if (liquid.group.visible) {
      pos.addScaledVector(dirLocal, dt * 5);
      liquid.group.scale.setScalar(Math.max(0.001, 1 - t / 0.7));
      if (t > 0.7) liquid.group.visible = false;
    }
    if (t > 1.1 && $('result').hidden && $('replay').hidden) $('result').hidden = false;
  } else if (state === 'replay' && repPlaying) {
    const rate = REPLAY_RATE * Number($<HTMLSelectElement>('repSpeed').value);
    setReplayHead(repHead + dt * rate);
    if (repHead >= trail.total) {
      repPlaying = false;
      $('repPlay').textContent = 'Play';
    }
  }

  const flowing = moving || (state === 'replay' && repPlaying);
  wobble = Math.max(flowing ? 0.55 : 0.22, wobble - dt * 1.6);
  stretch += ((flowing ? Math.min(0.55, 0.12 + speed * 0.045) : 0) - stretch) * Math.min(1, dt * 14);
  flash = Math.max(0, flash - dt * 1.2);

  liquid.group.position.copy(pos);
  liquid.update(time, gLocal, dirLocal, stretch, wobble);
  view?.update(time, pos, flash);
  particles.update(dt);
  guide.update(time);
  for (const m of decor.children) {
    const spin = m.userData.spin as THREE.Vector3;
    m.rotation.x += spin.x * dt * 0.6;
    m.rotation.y += spin.y * dt * 0.6;
    m.position.y += Math.sin(time * 0.5 + m.position.x * 9) * dt * 0.01;
  }
  camera.position.z = baseDist * controls.zoom;

  const ts = fmt(elapsed);
  if (ts !== shownTimer) setTimer((shownTimer = ts));
  if (moves !== shownMoves) $('moves').textContent = `${(shownMoves = moves)} moves`;
}

// ---- UI -----------------------------------------------------------------
let menuOpen = true;
const DIFF_NOTES: Record<Difficulty, string> = {
  easy: 'Yellow dots show the way · slower flow · stops at every junction',
  normal: 'No guide · full-speed flow',
};

/** セグメント切替（ボタン群のうち 1 つが選択状態） */
function setSeg(id: string, value: string): void {
  for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
}

function getSeg(id: string): string {
  return $(id).querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.dataset.value ?? '';
}

function bindSeg(id: string, onChange?: (value: string) => void): void {
  $(id).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.dataset.value) return;
    setSeg(id, b.dataset.value);
    onChange?.(b.dataset.value);
  });
}

function readForm(): Config {
  return {
    seed: $<HTMLInputElement>('seed').value.trim().slice(0, 32) || randomSeed(),
    size: Number(getSeg('size')),
    shape: getSeg('shape') as Shape,
  };
}

function showMenu(open: boolean): void {
  menuOpen = open;
  $('menu').hidden = !open;
  $('hint').hidden = open;
  $('scrim').hidden = !open;
  if (open) $('settings').hidden = true;
}

function initUi(): void {
  // --- メニュー（迷路の選択） ---
  $('diffNote').textContent = DIFF_NOTES[settings.difficulty];
  bindSeg('difficulty', (v) => ($('diffNote').textContent = DIFF_NOTES[v as Difficulty]));
  bindSeg('size');
  bindSeg('shape');
  $('seedRandom').onclick = () => ($<HTMLInputElement>('seed').value = randomSeed());
  $('play').onclick = () => {
    settings.difficulty = getSeg('difficulty') as Difficulty;
    saveSettings();
    startGame(readForm());
    showMenu(false);
  };
  $('menuClose').onclick = () => showMenu(false);
  $('scrim').onclick = () => showMenu(false);
  $('btnMenu').onclick = () => showMenu(!menuOpen);
  $<HTMLInputElement>('seed').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('play').click();
  });

  // --- 表示設定（即時反映） ---
  const recent = $<HTMLInputElement>('recent');
  setSeg('style', settings.style);
  setSeg('trail', settings.trail);
  setSeg('gfx', settings.gfx);
  trail.setStyle(settings.trail);
  trail.recent = settings.recent;
  recent.value = String(settings.recent);
  $('recentOut').textContent = String(settings.recent);
  setSeg('sound', settings.sound ? 'on' : 'off');
  bindSeg('style', (v) => {
    settings.style = v as Style;
    view?.setStyle(settings.style);
    saveSettings();
  });
  bindSeg('trail', (v) => {
    settings.trail = v as TrailStyle;
    trail.setStyle(settings.trail);
    saveSettings();
  });
  bindSeg('gfx', (v) => {
    settings.gfx = v as Gfx;
    applyGfx();
    saveSettings();
  });
  recent.oninput = () => {
    settings.recent = Number(recent.value);
    $('recentOut').textContent = recent.value;
    trail.recent = settings.recent;
    trail.recolorAll();
    saveSettings();
  };
  bindSeg('sound', (v) => {
    settings.sound = sfx.enabled = v === 'on';
    saveSettings();
  });
  const toggleSettings = (open?: boolean) => {
    const p = $('settings');
    p.hidden = open === undefined ? !p.hidden : !open;
    if (!p.hidden) showMenu(false);
  };
  $('btnSettings').onclick = () => toggleSettings();
  $('closeSettings').onclick = () => toggleSettings(false);
  canvas.addEventListener('pointerdown', () => toggleSettings(false));

  // --- 進行 ---
  const restart = () => {
    startGame(cfg);
    showMenu(false);
  };
  const fresh = () => {
    startGame({ ...cfg, seed: randomSeed() });
    showMenu(false);
  };
  $('btnRestart').onclick = restart;
  $('btnNew').onclick = fresh;
  $('resRetry').onclick = restart;
  $('resNext').onclick = fresh;
  $('share').onclick = () => void copyShare();
  $('resShare').onclick = () => void copyShare();
  $('resReplay').onclick = enterReplay;
  $('repBack').onclick = exitReplay;
  $('repPlay').onclick = () => {
    if (!repPlaying && repHead >= trail.total) setReplayHead(0);
    repPlaying = !repPlaying;
    $('repPlay').textContent = repPlaying ? 'Pause' : 'Play';
  };
  $<HTMLInputElement>('repSeek').oninput = (e) => {
    repPlaying = false;
    $('repPlay').textContent = 'Play';
    setReplayHead(Number((e.target as HTMLInputElement).value));
  };

  if (matchMedia('(pointer: coarse)').matches) {
    $('hintKeys').textContent = 'Drag to rotate · Twist with two fingers to roll · Pinch to zoom';
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') restart();
    else if (k === 'n') fresh();
    else if (k === 'escape') {
      if (!$('settings').hidden) toggleSettings(false);
      else showMenu(!menuOpen);
    }
  });
  window.addEventListener('resize', applyGfx);
}

initUi();
showMenu(true);
applyGfx();
startGame(cfg);
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  // 動作確認用: コンソールから状態を覗けるようにする
  Object.assign(window, {
    __ll: {
      rig,
      get maze() {
        return maze;
      },
      get state() {
        return { state, cell, moves, elapsed, moving };
      },
      /** 迷路ローカルのベクトル (x,y,z) が真下になるよう回す */
      pointDown(x: number, y: number, z: number) {
        const v = new THREE.Vector3(x, y, z).normalize();
        rig.quaternion.setFromUnitVectors(v, new THREE.Vector3(0, -1, 0));
        controls.touched = true;
      },
      /** 描画フレームを待たずにゲームを dt 秒進める */
      tick,
    },
  });
}
