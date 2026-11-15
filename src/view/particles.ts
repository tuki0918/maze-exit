import * as THREE from 'three';

const MAX = 600;

/** ワールド空間のしぶき。重力は常に画面の下向き。 */
export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private base = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private next = 0;
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.pos.fill(1e6); // 未使用の粒は画面外に置いておく
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }

  burst(origin: THREE.Vector3, count: number, speed: number, color: THREE.Color, up = 0.6, life = 0.7): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      // 球面上の一様な方向
      const z = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.vel[i * 3] = r * Math.cos(a) * s;
      this.vel[i * 3 + 1] = z * s + up * speed;
      this.vel[i * 3 + 2] = r * Math.sin(a) * s;
      this.pos[i * 3] = origin.x;
      this.pos[i * 3 + 1] = origin.y;
      this.pos[i * 3 + 2] = origin.z;
      const k = 1;
      this.base[i * 3] = color.r * k;
      this.base[i * 3 + 1] = color.g * k;
      this.base[i * 3 + 2] = color.b * k;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.8);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9 * dt;
      for (let j = 0; j < 3; j++) {
        this.pos[i * 3 + j] += this.vel[i * 3 + j] * dt;
        this.col[i * 3 + j] = this.base[i * 3 + j];
      }
      // 紙吹雪のように色はそのまま、寿命が来たら画面外へ
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = 1e6;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
