import * as THREE from 'three';

export type LiquidMode = 'dot' | 'fluid';

const DOT_N = 6;
const DOT_SIZE = 0.13;

/**
 * 1x1 マスの液体。
 *  - fluid: 頂点シェーダで波打つブロブ（重力方向につぶれ、進行方向に伸びる）
 *  - dot:   小さなキューブの集合をグリッドにスナップして揺らすドット調
 */
export class Liquid {
  readonly group = new THREE.Group();
  private blob: THREE.Mesh;
  private dots: THREE.InstancedMesh;
  private dotBase: THREE.Vector3[] = [];
  private uniforms = {
    uTime: { value: 0 },
    uG: { value: new THREE.Vector3(0, -1, 0) },
    uDir: { value: new THREE.Vector3(1, 0, 0) },
    uStretch: { value: 0 },
    uWobble: { value: 0.3 },
  };
  private mode: LiquidMode = 'fluid';
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uStretch;
        uniform float uWobble;
        uniform vec3 uG;
        uniform vec3 uDir;
        varying vec3 vView;
        varying float vH;
        void main() {
          vec3 p = position;
          vec3 nrm = normalize(position);
          float w = sin(p.x * 9.0 + uTime * 3.1) * sin(p.y * 8.0 + uTime * 2.3)
                  + 0.6 * sin(p.z * 11.0 - uTime * 4.2 + p.x * 4.0);
          p += nrm * w * (0.014 + 0.05 * uWobble);
          float a = dot(p, uG);
          // 重力方向につぶして横に広げ、マスの底へ寄せる
          p += -uG * a * 0.24 + (p - uG * a) * 0.12 + uG * 0.07;
          // 上面のさざ波
          float top = smoothstep(0.0, -0.35, a);
          p -= uG * top * 0.03 * sin(dot(p, vec3(7.0, 5.0, 6.0)) + uTime * 5.0);
          float m = dot(p, uDir);
          p += uDir * m * uStretch;
          vH = -a;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vView;
        varying float vH;
        void main() {
          vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
          vec3 v = normalize(-vView);
          float f = pow(1.0 - abs(dot(n, v)), 2.2);
          vec3 deep = vec3(0.03, 0.30, 0.85);
          vec3 mid = vec3(0.10, 0.74, 1.0);
          vec3 rim = vec3(0.86, 1.0, 1.0);
          vec3 col = mix(deep, mid, smoothstep(-0.35, 0.35, vH));
          col = mix(col, rim, f);
          vec3 l = normalize(vec3(0.4, 0.8, 0.6));
          col += pow(max(dot(reflect(-l, n), v), 0.0), 40.0) * 0.9;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 12), mat);

    const half = (DOT_N - 1) / 2;
    for (let x = 0; x < DOT_N; x++)
      for (let y = 0; y < DOT_N; y++)
        for (let z = 0; z < DOT_N; z++) {
          const v = new THREE.Vector3(x - half, y - half, z - half).multiplyScalar(DOT_SIZE);
          if (v.length() <= 0.41) this.dotBase.push(v);
        }
    this.dots = new THREE.InstancedMesh(
      new THREE.BoxGeometry(DOT_SIZE, DOT_SIZE, DOT_SIZE),
      new THREE.MeshBasicMaterial(),
      this.dotBase.length,
    );
    this.dots.frustumCulled = false;
    const col = new THREE.Color();
    this.dotBase.forEach((b, i) => {
      // ドット絵風に 3 階調 + 市松のディザ
      const shade = (Math.round(b.x / DOT_SIZE + b.y / DOT_SIZE + b.z / DOT_SIZE + 99) % 2) * 0.08;
      const r = b.length() / 0.41;
      if (r > 0.82) col.setRGB(0.55 + shade, 0.95, 1.0);
      else if (r > 0.5) col.setRGB(0.1, 0.66 + shade, 1.0);
      else col.setRGB(0.04, 0.36 + shade, 0.9);
      this.dots.setColorAt(i, col);
    });
    this.dots.visible = false;
    this.group.add(this.blob, this.dots);
  }

  setMode(mode: LiquidMode): void {
    this.mode = mode;
    this.blob.visible = mode === 'fluid';
    this.dots.visible = mode === 'dot';
  }

  /** g, dir は迷路ローカル座標の単位ベクトル */
  update(time: number, g: THREE.Vector3, dir: THREE.Vector3, stretch: number, wobble: number): void {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uG.value.copy(g);
    u.uDir.value.copy(dir);
    u.uStretch.value = stretch;
    u.uWobble.value = wobble;
    if (this.mode !== 'dot') return;

    const v = this.tmpV;
    const snap = DOT_SIZE / 2;
    for (let i = 0; i < this.dotBase.length; i++) {
      const b = this.dotBase[i];
      v.copy(b);
      const a = v.dot(g);
      const wave = Math.sin(time * 5 + b.x * 9 + b.z * 7 + b.y * 5) * (0.025 + 0.07 * wobble);
      v.addScaledVector(g, -a * 0.24 + 0.07 + wave);
      v.x += (b.x - g.x * a) * 0.12;
      v.y += (b.y - g.y * a) * 0.12;
      v.z += (b.z - g.z * a) * 0.12;
      v.addScaledVector(dir, v.dot(dir) * stretch);
      v.set(Math.round(v.x / snap) * snap, Math.round(v.y / snap) * snap, Math.round(v.z / snap) * snap);
      this.dots.setMatrixAt(i, this.tmpM.makeTranslation(v.x, v.y, v.z));
    }
    this.dots.instanceMatrix.needsUpdate = true;
  }
}
