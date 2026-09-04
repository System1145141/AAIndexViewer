/** 三维场景与图例共用的连续色带（蓝 → 青 → 绿 → 黄 → 红） */
export const RAMP: [number, number, number][] = [
  [0.23, 0.51, 0.96],
  [0.13, 0.83, 0.85],
  [0.29, 0.85, 0.5],
  [0.98, 0.85, 0.24],
  [0.96, 0.42, 0.36],
];

export function rampRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(RAMP.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(
  (c, i) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')}) ${(i / (RAMP.length - 1)) * 100}%`,
).join(', ')})`;
