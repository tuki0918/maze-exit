/** WebAudio だけで鳴らす簡易効果音（アセット不要） */
export class Sfx {
  enabled = true;
  private ctx?: AudioContext;

  /** ユーザー操作のタイミングで呼ぶ（自動再生制限のため） */
  unlock(): void {
    if (!this.enabled) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = undefined;
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slide = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  move(streak: number): void {
    this.blip(520 + Math.min(streak, 10) * 45, 0.07, 'sine', 0.05, 0, 0.7);
  }

  land(): void {
    this.blip(190, 0.16, 'sine', 0.14, 0, 0.45);
    this.blip(900, 0.05, 'triangle', 0.03);
  }

  goal(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.blip(f, 0.35, 'triangle', 0.09, i * 0.09));
  }
}
