// LexCraft's mark (D-136): the column-cursor, from the logo's icon. The name `BookMark` and the `vlx-book` classes
// stay from VisuaLex's open book (D-120: the code keeps its names). Capital and base take `currentColor` (the action's
// ink: dark ink in the light, paper in the dark), the shaft is stone (`index.css`), and the flutes are cut out of it,
// so they show whatever paper the mark sits on. `index.html` and `public/favicon.svg` repeat the same shapes.
import { useLayoutEffect, useRef, useState } from 'react';

/** When the splash's breath began (`index.html`), read while it is still on screen: React's first render precedes the
 *  commit that replaces it. Null without it, or without the Web Animations API. */
function splashBreathStart(): CSSNumberish | null {
  return document.querySelector('.vlx-splash svg')?.getAnimations?.()[0]?.startTime ?? null;
}
interface BookMarkProps {
  size?: number;
  /** Rise once from the base (500 ms), then breathe while `breathe` is set. */
  draw?: boolean;
  breathe?: boolean;
  className?: string;
  label?: string;
}

export function BookMark({ size = 48, draw = false, breathe = false, className, label }: BookMarkProps) {
  const classes = ['vlx-book', draw && 'vlx-book-draw', breathe && 'vlx-book-breathe', className].filter(Boolean).join(' ');
  // Taking over from the splash, the breath goes on in the splash's phase: started anew, its opacity jumped from the
  // splash's (0.4-1) to 1 in one frame (#446). Same keyframes, timing and delay, so the same start is the same opacity.
  const [splashStart] = useState(() => (breathe ? splashBreathStart() : null));
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const breath = splashStart === null ? undefined : ref.current?.getAnimations?.()[0];
    if (breath) breath.startTime = splashStart;
  }, [splashStart]);
  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={classes}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g className="vlx-column">
        <g transform="translate(50,50) scale(1.4930,0.7858)" fill="currentColor">
          <rect x="-12.90" y="-53.45" width="25.80" height="3.85" />
          <path d="M-11.87 -49.60 L11.87 -49.60 L6.00 -43.72 L-6.00 -43.72 Z" />
          <path
            className="vlx-column-shaft"
            fillRule="evenodd"
            d="M-6.00 -43.72 L6.00 -43.72 L7.50 45.17 L-7.50 45.17 Z M-2.74 -40.72 h1.49 v82.89 h-1.49 Z M1.26 -40.72 h1.49 v82.89 h-1.49 Z"
          />
          <rect x="-9.90" y="45.17" width="19.80" height="4.43" rx="2.01" />
          <rect x="-13.90" y="49.60" width="27.80" height="3.85" />
        </g>
      </g>
    </svg>
  );
}
