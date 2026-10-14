import { describe, expect, it } from 'vitest';
import { DURATION_MS, FRAMES, PARTICLE_COUNT, fade, spawn, step, stepsAt } from './confetti';

describe('the confetti', () => {
  const steady = () => 0.5;

  it('throws «§» and «✓» up from one point, in the palette’s colours', () => {
    const particles = spawn({ x: 40, y: 60 }, ['red', 'blue']);
    expect(particles).toHaveLength(PARTICLE_COUNT);
    expect(new Set(particles.map((p) => p.glyph))).toEqual(new Set(['§', '✓']));
    expect(particles.every((p) => p.x === 40 && p.y === 60 && p.vy < 0)).toBe(true);
    expect(particles.every((p) => p.color === 'red' || p.color === 'blue')).toBe(true);
  });

  it('lets them fall: gravity turns the climb into a fall', () => {
    let particles = spawn({ x: 0, y: 0 }, ['red'], 1, steady);
    const start = particles[0].vy;
    for (let i = 0; i < 40; i++) particles = step(particles);
    expect(particles[0].vy).toBeGreaterThan(0);
    expect(particles[0].vy - start).toBeCloseTo(40 * 0.32, 5);
  });

  it('fades out over the celebration', () => {
    expect(fade(0)).toBe(1);
    expect(fade(FRAMES / 2)).toBeCloseTo(0.5);
    expect(fade(FRAMES)).toBe(0);
    expect(fade(FRAMES + 10)).toBe(0);
  });
});

describe('the confetti’s clock', () => {
  it('steps by elapsed time: the same 1.5 s on any screen', () => {
    expect(DURATION_MS).toBe(1500);
    expect(stepsAt(0)).toBe(0);
    expect(stepsAt(1000 / 60)).toBe(1);
    expect(stepsAt(750)).toBe(45);
    expect(stepsAt(DURATION_MS)).toBe(FRAMES);
    expect(stepsAt(5000)).toBe(FRAMES);
  });
});
