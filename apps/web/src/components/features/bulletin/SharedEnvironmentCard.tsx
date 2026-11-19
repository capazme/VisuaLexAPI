import { Heart, Eye, MoreHorizontal, Flag, Edit, EyeOff, History, Lightbulb, MessageSquare, Trash2, FolderPlus } from 'lucide-react';
import type { SharedEnvironment, EnvironmentCategory } from '../../../types';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { FORUM_CATEGORIES } from '../../../utils/forumCategories';
import { tagLabel } from '../../../utils/tagLabel';
import { Button } from '../../ui/Button';
import { cn } from '../../../lib/utils';
import { MenuButton, type MenuItem } from '../../ui/MenuButton';

interface SharedEnvironmentCardProps {
  environment: SharedEnvironment;
  onLike: (id: string) => void;
  onImport: (env: SharedEnvironment) => void;
  onReport: (id: string) => void;
  onSuggest?: (env: SharedEnvironment) => void;
  onEdit?: (env: SharedEnvironment) => void;
  /** With the menu's button, which the confirmation grows from and gives the focus back to (LC85). */
  onDelete?: (env: SharedEnvironment, origin: HTMLElement | null) => void;
  onWithdraw?: (env: SharedEnvironment) => void;
  onRepublish?: (env: SharedEnvironment) => void;
  onViewVersions?: (env: SharedEnvironment) => void;
  isLiking?: boolean;
  showOwnerActions?: boolean;
  // When true the card root + menu button carry `tour-forum-card` /
  // `tour-forum-actions` DOM ids — only the first card in a grid should
  // set this to avoid duplicate ids.
  isFirst?: boolean;
}

/** A category's hue, from the category palette's tokens (light and dark): the card's leading stripe and the meta line's dot. */
const categoryHue = (c: EnvironmentCategory) => `hsl(var(--category-${c}))`;

/**
 * The grid of the cards, Explore's and «I miei pubblicati»' (S7a): one column, two from `md`, three from `xl`; a row's
 * cards one height (each `h-full`).
 */
export const CARD_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3';

/** The tags shown on a card (S7a): two, then «+N». */
const TAGS_SHOWN = 2;

const categoryLabel = (c: EnvironmentCategory) => FORUM_CATEGORIES.find((o) => o.value === c)?.label ?? 'Altro';

export function SharedEnvironmentCard({
  environment,
  onLike,
  onImport,
  onReport,
  onSuggest,
  onEdit,
  onDelete,
  onWithdraw,
  onRepublish,
  onViewVersions,
  isLiking = false,
  showOwnerActions = false,
  isFirst = false,
}: SharedEnvironmentCardProps) {
  const hue = categoryHue(environment.category);
  const titleId = `forum-card-${environment.id}`;
  const isWithdrawn = !environment.isActive;
  const hasPendingSuggestions = (environment.pendingSuggestionsCount ?? 0) > 0;

  const ownerItems: MenuItem[] = environment.isOwner && showOwnerActions ? [
    ...(onEdit ? [{ label: 'Modifica', icon: Edit, onSelect: () => onEdit(environment) }] : []),
    ...(onViewVersions ? [{ label: 'Versioni', icon: History, onSelect: () => onViewVersions(environment) }] : []),
    ...(isWithdrawn && onRepublish
      ? [{ label: 'Ripubblica', icon: Eye, iconClassName: 'text-green-600 dark:text-green-400', onSelect: () => onRepublish(environment) }]
      : []),
    ...(!isWithdrawn && onWithdraw
      ? [{ label: 'Ritira', icon: EyeOff, iconClassName: 'text-amber-600 dark:text-amber-400', onSelect: () => onWithdraw(environment) }]
      : []),
    // The confirmation grows from the «⋯», which has the focus back by then (LC85, K1b).
    ...(onDelete ? [{ label: 'Elimina', icon: Trash2, danger: true, onSelect: (_e: unknown, trigger: HTMLButtonElement | null) => onDelete(environment, trigger) }] : []),
  ] : [];
  const otherItems: MenuItem[] = environment.isOwner ? [] : [
    ...(onSuggest ? [{ label: 'Suggerisci contenuto', icon: Lightbulb, onSelect: () => onSuggest(environment) }] : []),
    { label: 'Segnala', icon: Flag, danger: true, onSelect: () => onReport(environment.id) },
  ];
  const menuItems = [...ownerItems, ...otherItems];

  // Timestamp: prefer `updatedAt` when it differs meaningfully from
  // `createdAt` (Prisma initializes them equal; we treat a delta < 1s as
  // "never edited"). Label uses "Aggiornato" vs "Creato" accordingly.
  // Absolute timestamp is available on hover via `title`.
  const createdMs = new Date(environment.createdAt).getTime();
  const updatedMs = new Date(environment.updatedAt).getTime();
  const wasEdited = updatedMs - createdMs >= 1000;
  const timeSourceIso = wasEdited ? environment.updatedAt : environment.createdAt;
  const timeSourceMs = wasEdited ? updatedMs : createdMs;
  const timeAgoRelative = !Number.isNaN(timeSourceMs)
    ? formatDistanceToNow(new Date(timeSourceMs), { addSuffix: true, locale: it })
    : null;
  const timeAbsolute = !Number.isNaN(timeSourceMs)
    ? `${wasEdited ? 'Aggiornato' : 'Creato'} il ${new Date(timeSourceIso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}`
    : undefined;

  return (
    // One card a dossier (S7a): as tall as its row in the grid, its one action at its foot.
    <article
      id={isFirst ? 'tour-forum-card' : undefined}
      data-shared-env={environment.id}
      aria-labelledby={titleId}
      className={cn(
        // Resting depth only (LC30): the card is not a link, and a hover lift would make a stacking context that traps the
        // «⋯» menu under the next card.
        'group relative flex h-full flex-col rounded-[8px] border',
        // Withdrawn: a dashed edge on a quieter paper, and the badge — no opacity, which would trap the «⋯» menu in a
        // stacking context of its own and fade the text under AA.
        isWithdrawn
          ? 'border-dashed border-slate-400 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/60'
          : 'border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      {/* The category's hue down the leading edge, from its token; no clipping on the card, so the «⋯» menu can hang out. */}
      <span aria-hidden="true" className="absolute -bottom-px -left-px -top-px w-1 rounded-l-[8px]" style={{ backgroundColor: hue }} />

      <div className="flex flex-1 flex-col p-4 pl-5">
        {/* The title, the badges of the state, the «⋯» menu. */}
        <div className="flex items-start gap-2">
          <h3 id={titleId} className="min-w-0 flex-1 break-words font-serif text-lg font-medium leading-snug text-slate-900 line-clamp-2 dark:text-slate-50">
            {environment.title}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            {isWithdrawn && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                <EyeOff size={12} aria-hidden />
                Ritirato
              </span>
            )}
            {hasPendingSuggestions && environment.isOwner && (
              <span className="flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
                <MessageSquare size={12} aria-hidden />
                {environment.pendingSuggestionsCount}
                <span className="sr-only"> suggerimenti in attesa</span>
              </span>
            )}
            {/* The user's own, in Explore (the «I miei pubblicati» tab is all theirs). */}
            {environment.isOwner && !showOwnerActions && (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-900/30 dark:text-primary-200">
                Tuo
              </span>
            )}
            {/* Only the actions the card has here: the user's own card in Explore has none, so no «⋯» (LC103). */}
            <div id={isFirst ? 'tour-forum-actions' : undefined}>
              <MenuButton
                label={`Azioni su «${environment.title}»`}
                items={menuItems}
                triggerClassName="min-h-[44px] min-w-[44px] justify-center p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 md:min-h-8 md:min-w-8"
              >
                <MoreHorizontal size={16} aria-hidden className="text-slate-500" />
              </MenuButton>
            </div>
          </div>
        </div>

        {/* The category, the version, the author and how long ago, in plain text: one line where the card has room; a
            narrow card wraps it between the parts, each «·» kept with what follows it, and a long username is cut,
            whole on hover. */}
        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hue }} />
            {categoryLabel(environment.category)}
          </span>
          <span className="whitespace-nowrap">
            <span aria-hidden>· </span>v{environment.currentVersion}
          </span>
          <span className="flex min-w-0 max-w-full whitespace-nowrap">
            <span aria-hidden className="shrink-0">·&nbsp;</span>
            <span className="min-w-0 truncate" title={environment.user.username}>
              {environment.user.username}
            </span>
          </span>
          {timeAgoRelative && (
            <span className="whitespace-nowrap" title={timeAbsolute}>
              <span aria-hidden>· </span>
              {timeAgoRelative}
            </span>
          )}
        </p>
        {environment.description && (
          <p className="mt-2 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{environment.description}</p>
        )}

        {environment.tags.length > 0 && (
          <ul aria-label="Etichette" className="mt-3 flex flex-wrap gap-1">
            {environment.tags.slice(0, TAGS_SHOWN).map((tag, idx) => (
              <li key={idx} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {tagLabel(tag)}
              </li>
            ))}
            {environment.tags.length > TAGS_SHOWN && (
              <li className="px-1 py-0.5 text-xs text-slate-600 dark:text-slate-400">
                <span aria-hidden>+{environment.tags.length - TAGS_SHOWN}</span>
                <span className="sr-only">{`e altre ${environment.tags.length - TAGS_SHOWN}`}</span>
              </li>
            )}
          </ul>
        )}

        {/* At the foot: «Mi piace» as its heart and count, how many added it, then the card's one action, outlined. */}
        {/* As tall as the action, on a card without one too (the user's own), so every foot lines up. */}
        {/* Where the card is too narrow for all three, the action goes under them, whole, at the right. */}
        <div className="mt-auto flex min-h-[3.375rem] flex-wrap items-center gap-x-2 gap-y-2 pt-4">
          {/* `Button` quiet (LC114): on a computer as tall as the action beside it, 36 px, 44 on a phone. */}
          <Button
            type="button"
            variant="quiet"
            onClick={() => onLike(environment.id)}
            disabled={isLiking}
            aria-pressed={environment.userLiked}
            aria-label={`Mi piace: ${environment.likeCount}`}
            icon={<Heart size={18} aria-hidden className={environment.userLiked ? 'fill-current' : ''} />}
            className={cn(
              'min-w-11 shrink-0 gap-1.5 px-2 tabular-nums md:min-w-0',
              environment.userLiked
                ? 'text-red-700 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-400'
                : 'text-slate-600 dark:text-slate-400',
            )}
          >
            <span aria-hidden>{environment.likeCount}</span>
          </Button>
          {/* Beside the like, small: how many added it (nothing at 0), and — to its author only, in «I miei
              pubblicati» — how many viewed it. */}
          {(environment.downloadCount > 0 || showOwnerActions) && (
            <p className="min-w-0 text-xs text-slate-600 dark:text-slate-400">
              {environment.downloadCount > 0 && <span className="whitespace-nowrap">aggiunto da {environment.downloadCount}</span>}
              {environment.downloadCount > 0 && showOwnerActions && <span aria-hidden> · </span>}
              {showOwnerActions && (
                <span className="whitespace-nowrap">
                  {environment.viewCount === 1 ? '1 visualizzazione' : `${environment.viewCount} visualizzazioni`}
                </span>
              )}
            </p>
          )}
          {!environment.isOwner && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onImport(environment)}
              aria-label={`Aggiungi «${environment.title}» ai miei dossier`}
              icon={<FolderPlus size={16} aria-hidden />}
              className="ml-auto min-w-0 max-w-full gap-1.5 whitespace-nowrap px-3 font-semibold"
            >
              {/* «Aggiungi» on a phone, as the packs' cards say it, the whole words from `sm` (at 320 px they were cut);
                  the name, the button's label, is whole on every width. */}
              <span className="truncate sm:hidden">Aggiungi</span>
              <span className="hidden truncate sm:inline">Aggiungi ai miei dossier</span>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
