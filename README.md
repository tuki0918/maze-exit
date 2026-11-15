# Liquid Labyrinth

3D の迷路を回し、重力で流れる液体を出口まで導くゲーム。仕様は [docs/SPEC.md](docs/SPEC.md)。

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 迷路生成のテスト
npm run build   # dist/ に出力
```

同じ迷路を他の人と試すには、設定パネルの「共有 URL をコピー」を使う（`?seed=…&size=…&shape=…`）。
