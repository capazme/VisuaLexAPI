// LexCraft's logo (D-136, D-201): LEX, the column-cursor, CRAFT selected, «Va e torna, resta pietra» (variant 1 of the
// design file «05 Animazione di avvio.html»). The outlines are the file's (`lexCraftLogoPaths.ts`); the colours are the
// app's ink, paper, highlighter and stone, swapped in the dark as the file swaps them, and the motion is the file's,
// in CSS (`index.css`, `vlx-logo-*`): `transform` and `clip-path` only, in a box that never changes size.
import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import {
  COLUMN_CAPITAL, COLUMN_FROM, COLUMN_RECTS, COLUMN_SHAFT, CRAFT, CRAFT_FROM, CURSOR_RUN, LEX, LEX_FROM, SELECTION,
  VIEWBOX_INTRO, VIEWBOX_STILL,
} from './lexCraftLogoPaths';

/** still: no motion. sweep: the cursor selects CRAFT in ink and, coming back, leaves it in stone (the shell, once a
 *  session). intro: the whole of the file's animation, in its taller box (the sign-in page). */
export type LogoMotion = 'still' | 'sweep' | 'intro';

const FILL = {
  ink: { fill: 'var(--vlx-logo-ink)' },
  bg: { fill: 'var(--vlx-logo-paper)' },
  sel: { fill: 'var(--vlx-logo-sel)' },
  stone: { fill: 'var(--vlx-pietra)' },
} satisfies Record<string, CSSProperties>;

const from = (d: string) => ({ '--vlx-logo-from': d }) as CSSProperties;

const selection = (style: CSSProperties) => <rect {...SELECTION} style={style} />;

interface LexCraftLogoProps {
  motion?: LogoMotion;
  className?: string;
}

export function LexCraftLogo({ motion = 'still', className }: LexCraftLogoProps) {
  // Under reduced motion no class asks for a movement, and `index.css` holds the rest still too.
  const moving = motion !== 'still' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={motion === 'intro' ? VIEWBOX_INTRO : VIEWBOX_STILL}
      role="img"
      aria-label="LexCraft"
      className={cn('vlx-logo', moving && `vlx-logo-${motion}`, className)}
      style={{ '--vlx-logo-run': CURSOR_RUN } as CSSProperties}
    >
      <g className="vlx-logo-sel-rest">{selection(FILL.sel)}</g>
      <g className="vlx-logo-rise">
        <g className="vlx-logo-open" style={from(LEX_FROM)}>
          <path d={LEX} style={FILL.ink} fillRule="evenodd" />
        </g>
        <g className="vlx-logo-open" style={from(CRAFT_FROM)}>
          <path d={CRAFT} style={FILL.ink} fillRule="evenodd" />
        </g>
      </g>
      <g className="vlx-logo-sel-run">
        {selection(FILL.ink)}
        <path d={CRAFT} style={FILL.bg} fillRule="evenodd" />
      </g>
      <g className="vlx-logo-cursor">
        <g className="vlx-logo-open" style={from(COLUMN_FROM)}>
          <g className="vlx-logo-descend">
            <rect {...rectOf(0)} />
            <path d={COLUMN_CAPITAL} style={FILL.ink} />
            <path d={COLUMN_SHAFT} style={FILL.stone} />
            {[1, 2, 3, 4].map((i) => <rect key={i} {...rectOf(i)} />)}
          </g>
        </g>
      </g>
    </svg>
  );
}

function rectOf(i: number) {
  const { fill, ...box } = COLUMN_RECTS[i];
  return { ...box, style: FILL[fill] };
}
