import { BadgeCheck, SearchCheck, BookMarked } from 'lucide-react';
import type { LinkKind } from '../../../types';
import { cn } from '../../../lib/utils';

/**
 * The one distinction the whole Giurisprudenza block exists to preserve: a
 * source-declared fact ("cited"), a search engine's inference ("matched"),
 * and an editor's selection ("curated" — Brocardi choosing a maxim for this
 * article, never sent by the API, see `LinkKind` in types/index.ts). Colour,
 * icon AND label all differ, so the difference survives a glance, a
 * screenshot, or a colourblind reader — never just a hover title.
 */
const LINK_KIND_CONFIG: Record<LinkKind, {
    label: string;
    icon: typeof BadgeCheck;
    containerClass: string;
    title: string;
}> = {
    cited: {
        label: 'Citazione dichiarata',
        icon: BadgeCheck,
        containerClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        title: 'La fonte dichiara che questa decisione cita la norma: un fatto, non un’inferenza.',
    },
    matched: {
        label: 'Trovata nel testo',
        icon: SearchCheck,
        containerClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        title: 'Il testo della norma è stato trovato nella decisione: un’inferenza della ricerca, può essere sbagliata (es. lo stesso articolo di un altro codice).',
    },
    curated: {
        label: 'Selezionata da Brocardi',
        icon: BookMarked,
        containerClass: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
        title: 'Un redattore di Brocardi.it ha scelto questa massima per l’articolo: più affidabile di un’inferenza automatica, ma resta il giudizio di una fonte secondaria, non una dichiarazione della corte.',
    },
};

export function LinkKindBadge({ kind }: { kind: LinkKind }) {
    // A `kind` this map has no entry for must never fall back to `cited`:
    // that badge claims the source *declared* the citation, which would turn
    // an unrecognised value into a fabricated fact instead of the inference
    // `matched` already, correctly, admits it might be wrong. It must also
    // not throw — an unguarded lookup would take the whole reading surface
    // down over one bad badge.
    const config = LINK_KIND_CONFIG[kind] ?? LINK_KIND_CONFIG.matched;
    const Icon = config.icon;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0',
                config.containerClass,
            )}
            title={config.title}
        >
            <Icon size={10} />
            {config.label}
        </span>
    );
}
