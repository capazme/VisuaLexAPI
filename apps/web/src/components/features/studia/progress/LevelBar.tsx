import { motion, useReducedMotion } from 'framer-motion';
import { dur, ease } from '../../../../lib/motion';
import { cn } from '../../../../lib/utils';
import type { XpLivello } from '../../../../types/studia';
import { formatCount } from './layout';
import { useXpGrowth } from './seenProgress';
import { INK_BG, INK_TEXT, MUTED_TEXT } from './tokens';
import { XpGain } from './XpGain';
import { useMountedFrame } from './xpGains';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The level (Gymnasium XP spec §4, G1c): «Livello 4», what the next level still asks, and a quiet bar of the level's
 * share. The server computes it; it is the user's alone (G-316: never in the Forum, a public dossier or anything
 * another user sees), with no title (L-27 choice 3) and no weight on a vote (G-318). The text says it all to a screen
 * reader; the bar is its picture. What grew since this browser last drew it (`useXpGrowth`) shows as «+20 XP», and a
 * level not yet shown here is pressed in once (no movement under reduced motion) and announced.
 */
export function LevelBar({ livello, className }: { livello: XpLivello; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const { gain, levelUp } = useXpGrowth(livello.totale, livello.livello);
  const mounted = useMountedFrame();
  const left = Math.max(0, livello.perIlProssimo - livello.nelLivello);
  const share = livello.perIlProssimo > 0 ? Math.min(1, livello.nelLivello / livello.perIlProssimo) : 0;
  return (
    <div data-testid="level-bar" className={cn('grid gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <motion.p
          initial={levelUp && !reduce ? { scale: 1.5, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: dur.scene, ease: ease.out, delay: 0.2 }}
          className={cn('origin-left font-serif text-2xl font-medium leading-none tabular-nums', INK_TEXT)}
        >
          Livello {formatCount(livello.livello)}
        </motion.p>
        <div className="flex items-center gap-2">
          <XpGain gain={gain !== null ? { id: livello.totale, punti: gain } : null} />
          {livello.oggi > 0 && (
            <p aria-hidden className={cn('text-sm tabular-nums', MUTED_TEXT)}>
              {`oggi +${formatCount(livello.oggi)} XP`}
            </p>
          )}
        </div>
      </div>
      <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <span className={cn('block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none', INK_BG)} style={{ width: `${share * 100}%` }} />
      </span>
      <p className={cn('text-sm', MUTED_TEXT)}>
        <span aria-hidden>{`Ancora ${formatCount(left)} XP per il livello ${formatCount(livello.livello + 1)}`}</span>
        <span className="sr-only">
          {`Ancora ${plural(left, 'punto', 'punti')} per il livello ${livello.livello + 1}.${livello.oggi > 0 ? ` Oggi ${plural(livello.oggi, 'punto', 'punti')}.` : ''}`}
        </span>
      </p>
      {/* Filled a frame after the region is drawn, or a screen reader would not hear it. */}
      <span aria-live="polite" className="sr-only">
        {levelUp && mounted ? `Nuovo livello: sei al livello ${livello.livello}.` : ''}
      </span>
    </div>
  );
}
