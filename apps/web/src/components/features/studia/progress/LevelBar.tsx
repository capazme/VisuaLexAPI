import { motion, useReducedMotion } from 'framer-motion';
import { dur, ease } from '../../../../lib/motion';
import { cn } from '../../../../lib/utils';
import type { XpLivello } from '../../../../types/studia';
import { formatCount } from './layout';
import { useXpGrowth } from './seenProgress';
import { INK_BG, INK_TEXT, MUTED_TEXT } from './tokens';
import { XpGain } from './XpGain';
import { useMountedFrame } from './xpGains';
import { Illustration } from '../../../ui/Illustration';

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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* LC35: the level beside its laurel, an engraving. Keyed by the level: one reached while the page is open is
            pressed in too. */}
        <span className="flex items-center gap-2">
        <Illustration name="learn-livello" className="h-11 w-11" />
        <motion.p
          key={livello.livello}
          // There from the first frame (LC133): it was hidden for 200 ms (a delay from opacity 0) as Learn opened.
          initial={levelUp && !reduce ? { scale: 1.5 } : false}
          animate={{ scale: 1 }}
          transition={{ duration: dur.scene, ease: ease.out }}
          className={cn('origin-left font-serif text-2xl font-medium leading-none tabular-nums', INK_TEXT)}
        >
          Livello {formatCount(livello.livello)}
        </motion.p>
        </span>
        <div className="flex items-center gap-2">
          <XpGain gain={gain !== null ? { id: livello.totale, punti: gain } : null} />
          {livello.oggi > 0 && (
            <p aria-hidden className={cn('text-sm tabular-nums', MUTED_TEXT)}>
              {`oggi +${formatCount(livello.oggi)} XP`}
            </p>
          )}
        </div>
      </div>
      {/* Named and valued as the lesson's bar is; its text alternative is the line under it. */}
      <span
        role="progressbar"
        aria-label={`Livello ${livello.livello}`}
        aria-valuemin={0}
        aria-valuemax={livello.perIlProssimo}
        aria-valuenow={Math.min(livello.nelLivello, livello.perIlProssimo)}
        aria-valuetext={`${livello.nelLivello} punti di ${livello.perIlProssimo} per il livello ${livello.livello + 1}`}
        className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      >
        <span aria-hidden className={cn('block h-full rounded-full transition-[width] duration-(--dur-scene) ease-out motion-reduce:transition-none', INK_BG)} style={{ width: `${share * 100}%` }} />
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
