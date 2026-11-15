import * as THREE from 'three';
import { DIRS } from '../maze';

const Y = new THREE.Vector3(0, 1, 0);

/**
 * 液体がいる（向かっている）マスから通れる方向を、ピンクの矢印（四角錐）で示す。
 * 深度テストなしなので、迷路の奥にあっても必ず見える。
 */
export class Locator {
  readonly group = new THREE.Group();
  private arrows: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private n = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3d8b, transparent: true, depthTest: false, depthWrite: false });
    this.arrows = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.42, 4), mat, 6);
    this.arrows.frustumCulled = false;
    this.arrows.renderOrder = 7;
    this.arrows.count = 0;
    this.group.add(this.arrows);
  }

  set(pos: THREE.Vector3, opens: number[]): void {
    this.group.visible = true;
    opens.forEach((d, i) => {
      this.n.set(DIRS[d][0], DIRS[d][1], DIRS[d][2]);
      this.q.setFromUnitVectors(Y, this.n);
      this.p.copy(pos).addScaledVector(this.n, 0.66);
      this.arrows.setMatrixAt(i, this.m.compose(this.p, this.q, this.one));
    });
    this.arrows.count = opens.length;
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.group.visible = false;
  }
}
