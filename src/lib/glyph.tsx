/**
 * Deterministic pixel glyph per group. Decision 14.
 *
 * Hash the seed, render a vertically-symmetric 5x5 grid from the bits,
 * hue from the same hash. Stable across machines, legible at 16px,
 * no asset pipeline. The identicon idea, sized for a tab strip.
 */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function glyphHue(seed: string): number {
  return hash(seed) % 360;
}

export function GroupGlyph({ seed, size = 16 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const hue = h % 360;
  const cells: boolean[] = [];
  // 3 columns of 5, mirrored to 5 wide
  for (let i = 0; i < 15; i++) cells.push(((h >>> i) & 1) === 1);
  const px = size / 5;
  const rects: JSX.Element[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!cells[y * 3 + x]) continue;
      rects.push(<rect key={`${x}-${y}`} x={x * px} y={y * px} width={px} height={px} />);
      if (x < 2) rects.push(<rect key={`m${x}-${y}`} x={(4 - x) * px} y={y * px} width={px} height={px} />);
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      style={{ display: "block", flex: "none", borderRadius: 2, background: `hsl(${hue} 24% 50% / 0.16)` }}
    >
      <g fill={`hsl(${hue} 52% 52%)`}>{rects}</g>
    </svg>
  );
}
