import * as THREE from 'three';

const MAX = 600;

/** Easy モード用: 出口までの道のりを示す黄色い粒。出口へ向かって波が流れる。 */
export class Guide {
  readonly mesh: THREE.InstancedMesh;
  private pts: THREE.Vector3[] = [];
  private m = new THREE.Matrix4();

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.12), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  set(points: THREE.Vector3[]): void {
    this.pts = points.slice(0, MAX);
    this.mesh.count = this.pts.length;
  }

  update(time: number): void {
    for (let i = 0; i < this.pts.length; i++) {
      const wave = Math.max(0, Math.sin(time * 5 - i * 0.7));
      const s = 0.75 + 0.9 * wave * wave;
      const p = this.pts[i];
      this.mesh.setMatrixAt(i, this.m.makeScale(s, s, s).setPosition(p.x, p.y, p.z));
    }
    if (this.pts.length) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
