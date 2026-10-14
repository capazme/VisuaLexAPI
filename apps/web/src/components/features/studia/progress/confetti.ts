/**
 * The celebration's confetti (Studia progress spec §6.1), as pure functions: «§» and «✓» thrown up from a
 * point, falling under gravity, fading. `Celebration` draws them on a canvas; nothing here touches the DOM.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  size: number;
  color: string;
  glyph: '§' | '✓';
}

export const PARTICLE_COUNT = 90;
export const FRAMES = 90; // about 1.5 s at 60 frames a second
const GRAVITY = 0.32;
const DRAG = 0.99;

export function spawn(origin: { x: number; y: number }, palette: string[], count = PARTICLE_COUNT, random: () => number = Math.random): Particle[] {
  return Array.from({ length: count }, () => ({
    x: origin.x,
    y: origin.y,
    vx: (random() - 0.5) * 11,
    vy: -random() * 10 - 2,
    rotation: random() * Math.PI * 2,
    spin: (random() - 0.5) * 0.4,
    size: 4 + random() * 5,
    color: palette[Math.floor(random() * palette.length)] ?? 'currentColor',
    glyph: random() < 0.5 ? '§' : '✓',
  }));
}

/** One frame later. */
export function step(particles: Particle[]): Particle[] {
  return particles.map((p) => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vx: p.vx * DRAG, vy: p.vy + GRAVITY, rotation: p.rotation + p.spin }));
}

/** How opaque the confetti is at `frame`: from 1 to 0 over the celebration. */
export function fade(frame: number): number {
  return Math.max(0, 1 - frame / FRAMES);
}
