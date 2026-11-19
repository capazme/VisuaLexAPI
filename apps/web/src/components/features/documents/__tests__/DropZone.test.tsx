import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// Framer reads the preference once per module; the test sets it per case.
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motion.reduce,
}));

import { DropZone } from '../DropZone';

// LC117 (the consultant on #670): a file dropped draws the wave from the frame; under reduced motion nothing moves.
describe('DropZone — the wave of a drop', () => {
  it.each([[false, 1], [true, 0]])('under reduced motion %s draws %i waves', (reduce, waves) => {
    motion.reduce = reduce;
    const { container } = render(<DropZone phase="idle" landings={1} touch={false} busy={false} onChoose={() => {}} />);
    expect(container.querySelectorAll('[data-drop-wave]')).toHaveLength(waves);
  });
});
