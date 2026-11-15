import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Sfx } from './audio';
import { Controls } from './controls';
import { DIRS, generateMaze, type Maze, type Shape } from './maze';
import { Liquid } from './view/liquid';
import { MazeView, cellPos, type Style } from './view/mazeView';
import { Particles } from './view/particles';
import { Trail } from './view/trail';

type Gfx = 'dot' | 'standard' | 'high';
type State = 'ready' | 'playing' | 'won' | 'replay';
interface Config {
  seed: string;
  size: number;
  shape: Shape;
}
interface Settings {
  style: Style;
  gfx: Gfx;
  recent: number;
  sound: boolean;
}

// ---- 液体の動きの調整値 -------------------------------------------------
const REST_THRESHOLD = 0.45; // 静止中に流れ出すのに必要な傾き（重力との内積）
const FLOW_THRESHOLD = 0.3; // 流れている最中に次のマスへ進み続ける傾き
const V0 = 2.5; // 流れ始めの速度 (マス/秒)
const ACCEL = 18;
const VMAX = 9;
const REPLAY_RATE = 10; // リプレイ ×1 の手/秒

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- 設定の読み書き -----------------------------------------------------
const SHAPES: Shape[] = ['cube', 'sphere', 'diamond'];
const SIZES = [5, 7, 9, 11, 13];

function randomSeed(): string {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function loadSettings(): Settings {
  const def: Settings = { style: 'glass', gfx: 'standard', recent: 8, sound: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('ll:settings') ?? '{}') };
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
    size: SIZES.includes(size) ? size : 7,
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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 800);

const rig = new THREE.Group(); // これを回す = 迷路を回す
scene.add(rig);
const liquid = new Liquid();
const trail = new Trail();
rig.add(liquid.group, trail.mesh);
const particles = new Particles();
scene.add(particles.points);

{
  // 背景の星
  const pts: number[] = [];
  for (let i = 0; i < 500; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(150 + Math.random() * 150);
    pts.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x6f86b8, size: 1.1, sizeAttenuation: false })));
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

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
const CYAN = new THREE.Color(0.35, 0.85, 1);
const GOLD = new THREE.Color(1, 0.8, 0.35);

function bestKey(): string {
  return `ll:best:${cfg.shape}:${cfg.size}:${cfg.seed}`;
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

  cell = maze.start;
  cellPos(maze, cell, pos);
  points = [pos.clone()];
  trail.mode = 'play';
  trail.reset();
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
  $('info').textContent = `seed ${cfg.seed} ・ ${maze.n}³ ・ 最短 ${maze.solutionMoves} 手`;
  $<HTMLInputElement>('seed').value = cfg.seed;
  $<HTMLSelectElement>('size').value = String(cfg.size);
  $<HTMLSelectElement>('shape').value = cfg.shape;
  $('result').hidden = true;
  $('replay').hidden = true;
  $('hint').classList.remove('off');
  fitCamera();
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
}

function arrive(): void {
  pos.copy(to);
  trail.add(points[points.length - 1], to);
  points.push(to.clone());
  moves++;
  streak++;
  sfx.move(streak);
  if (exiting) {
    win();
    return;
  }
  // 行き先のマス番号（方向ベクトルから直接求める）
  const n = maze.n;
  cell += DIRS[moveDir][0] + DIRS[moveDir][1] * n + DIRS[moveDir][2] * n * n;
  const next = pickDir(FLOW_THRESHOLD);
  if (next < 0) {
    // 行き止まり or 傾き不足 → 着地
    moving = false;
    wobble = Math.min(1.4, 0.5 + speed * 0.1);
    if (streak >= 2) {
      sfx.land();
      particles.burst(liquidWorld(), 6 + Math.round(speed * 1.6), 1.2 + speed * 0.22, CYAN);
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
  particles.burst(w, 150, 6, GOLD, 0.25, 1.3);
  particles.burst(w, 90, 4, CYAN, 0.25, 1.1);

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
  $('resMoves').textContent = `${moves} 手`;
  $('resShortest').textContent = `${maze.solutionMoves} 手`;
  $('resBest').textContent = fmt(best / 1000);
  $('resSeed').textContent = `${cfg.seed} (${maze.n}³ ${cfg.shape})`;
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
  $('repPlay').textContent = '⏸';
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
  $('repPos').textContent = `${i} / ${trail.total} 手`;
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
  const dist = radius / Math.sin(half) / Math.min(1, aspect * 0.95);
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
  composer.setPixelRatio(ratio);
  composer.setSize(w, h);
  camera.aspect = w / h;
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
    toast('共有 URL をコピーしました');
  } catch {
    toast(shareUrl());
  }
}

// ---- メインループ -------------------------------------------------------
let last = performance.now();
let shownTimer = '';
let shownMoves = -1;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  if (settings.gfx === 'high') composer.render();
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function tick(dt: number): void {
  time += dt;

  if (state === 'replay' && !controls.dragging) rig.rotateOnWorldAxis(THREE.Object3D.DEFAULT_UP, dt * 0.25);
  controls.update(dt, rig);
  qInv.copy(rig.quaternion).invert();
  gLocal.set(0, -1, 0).applyQuaternion(qInv);

  if (state === 'ready' && controls.touched) {
    state = 'playing';
    $('hint').classList.add('off');
  }
  if (state === 'playing') {
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
      $('repPlay').textContent = '▶';
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
  camera.position.z = baseDist * controls.zoom;

  const ts = fmt(elapsed);
  if (ts !== shownTimer) $('timer').textContent = shownTimer = ts;
  if (moves !== shownMoves) $('moves').textContent = `${(shownMoves = moves)} 手`;
}

// ---- UI -----------------------------------------------------------------
function readForm(): Config {
  return {
    seed: $<HTMLInputElement>('seed').value.trim().slice(0, 32) || randomSeed(),
    size: Number($<HTMLSelectElement>('size').value),
    shape: $<HTMLSelectElement>('shape').value as Shape,
  };
}

function initUi(): void {
  const style = $<HTMLSelectElement>('style');
  const gfx = $<HTMLSelectElement>('gfx');
  const recent = $<HTMLInputElement>('recent');
  const sound = $<HTMLInputElement>('sound');
  style.value = settings.style;
  gfx.value = settings.gfx;
  recent.value = String(settings.recent);
  $('recentOut').textContent = String(settings.recent);
  sound.checked = settings.sound;
  trail.recent = settings.recent;

  style.onchange = () => {
    settings.style = style.value as Style;
    view?.setStyle(settings.style);
    saveSettings();
  };
  gfx.onchange = () => {
    settings.gfx = gfx.value as Gfx;
    applyGfx();
    saveSettings();
  };
  recent.oninput = () => {
    settings.recent = Number(recent.value);
    $('recentOut').textContent = recent.value;
    trail.recent = settings.recent;
    trail.recolorAll();
    saveSettings();
  };
  sound.onchange = () => {
    settings.sound = sfx.enabled = sound.checked;
    saveSettings();
  };

  const toggleSettings = (open?: boolean) => {
    const p = $('settings');
    p.hidden = open === undefined ? !p.hidden : !open;
  };
  $('btnSettings').onclick = () => toggleSettings();
  $('closeSettings').onclick = () => toggleSettings(false);
  $('seedRandom').onclick = () => ($<HTMLInputElement>('seed').value = randomSeed());
  $('apply').onclick = () => {
    startGame(readForm());
    toggleSettings(false);
  };
  $('share').onclick = () => void copyShare();
  $('resShare').onclick = () => void copyShare();
  const restart = () => startGame(cfg);
  const fresh = () => startGame({ ...cfg, seed: randomSeed() });
  $('btnRestart').onclick = restart;
  $('btnNew').onclick = fresh;
  $('resRetry').onclick = restart;
  $('resNext').onclick = fresh;
  $('resReplay').onclick = enterReplay;
  $('repBack').onclick = exitReplay;
  $('repPlay').onclick = () => {
    if (!repPlaying && repHead >= trail.total) setReplayHead(0);
    repPlaying = !repPlaying;
    $('repPlay').textContent = repPlaying ? '⏸' : '▶';
  };
  $<HTMLInputElement>('repSeek').oninput = (e) => {
    repPlaying = false;
    $('repPlay').textContent = '▶';
    setReplayHead(Number((e.target as HTMLInputElement).value));
  };
  $<HTMLInputElement>('seed').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('apply').click();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') restart();
    else if (k === 'n') fresh();
    else if (k === 'escape') toggleSettings();
  });
  window.addEventListener('resize', applyGfx);
}

initUi();
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
