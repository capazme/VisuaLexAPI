import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/** The engravings in `public/illustrations` (LC35, Luca 16-11): one ink, transparent, square. */
export type IllustrationName =
  | 'learn-fatto-oggi' | 'learn-ripasso' | 'learn-serie' | 'learn-livello' | 'learn-missione' | 'learn-schede-vuote'
  | 'materia-civile' | 'materia-penale' | 'materia-amministrativo' | 'materia-proc-civile' | 'materia-proc-penale'
  | 'work-oggi-vuota' | 'work-ingresso-vuoto' | 'dossier-vuoti' | 'forum-vuoto';

/**
 * An engraving of LexCraft's (LC35): a plate in the manner of an old law book, drawn in the theme's ink — the file is
 * only its shape (an alpha mask), so the same plate is warm black on the paper and chalk on the dark. Decorative by
 * default; with `label` it is an image with that name.
 */
export function Illustration({ name, label, className, style }: { name: IllustrationName; label?: string; className?: string; style?: CSSProperties }) {
  const url = `url(${import.meta.env.BASE_URL}illustrations/${name}.webp)`;
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-illustration={name}
      className={cn('block shrink-0 bg-slate-800 dark:bg-slate-100', className)}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center', ...style }}
    />
  );
}
