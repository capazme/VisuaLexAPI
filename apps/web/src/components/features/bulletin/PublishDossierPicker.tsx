import { useId, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Expand } from '../../ui/Expand';
import { IconButton } from '../../ui/IconButton';
import { CARD_RADIUS, CONTROL_BORDER, CONTROL_RADIUS } from '../../ui/controlStyles';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { kindLabel } from '../dossier/dossierKinds';
import { PublishDossierForm } from '../dossier/PublishDossierDialog';
import type { Dossier } from '../../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onPublished: (message: string) => void;
}

/**
 * «Pubblica un dossier» from the Forum (spec 2026-10-13-environments-into-forum, D13): the user's dossiers not yet in
 * the Forum, then the dossier's own «Pubblica nel Forum» form. A dossier the admin withdrew is listed, not offered. In the
 * page under the Forum's header (LC138, L-73), as the dossier's own «Pubblica nel Forum» (LC125): Esc closes it, but not
 * while the server works, and the focus goes back to the command.
 */
export function PublishDossierPicker({ open, onClose, onPublished }: Props) {
  const dossiers = useAppStore((s) => s.dossiers);
  const refreshDossier = useAppStore((s) => s.refreshDossier);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Opened again, it starts from the list; not while a publication it holds is still travelling.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && !busy) setChosenId(null);
  }
  const chosen = chosenId ? dossiers.find((d) => d.id === chosenId) ?? null : null;
  const candidates = dossiers.filter((d) => !d.published && d.items.length > 0);
  const headingId = useId();
  const spaceId = useId();
  const close = () => { if (!busy) onClose(); };
  // Publishing, the form's button waits (disabled): the focus stays on the space, not on the page's body.
  const setWorking = (working: boolean) => {
    setBusy(working);
    if (working) document.getElementById(spaceId)?.focus({ preventScroll: true });
  };

  return (
    // Another space opened while it publishes: it stays until the server answers, then closes (one space at a time).
    <Expand id={spaceId} open={open || busy} onClose={close} role="region" aria-labelledby={headingId} className={cn('bg-card', CARD_RADIUS, CONTROL_BORDER)}>
      {chosen ? (
        <div className="p-4 md:p-5">
          <PublishDossierForm
            dossier={chosen}
            otherDossiers={dossiers}
            onClose={onClose}
            onPublished={(message) => {
              void refreshDossier(chosen.id);
              onPublished(message);
            }}
            onAlreadyPublished={() => void refreshDossier(chosen.id)}
            headingId={headingId}
            busy={busy}
            setBusy={setWorking}
          />
        </div>
      ) : (
        <div className="space-y-3 p-4 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Upload size={18} aria-hidden className="shrink-0" />
              Pubblica un dossier
            </h2>
            <IconButton onClick={close} aria-label="Chiudi" icon={<X aria-hidden />} className="shrink-0" />
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Non hai dossier da pubblicare: quelli già nel Forum si aggiornano dal dossier, e un dossier vuoto non si pubblica.
            </p>
          ) : (
            <ul className="space-y-1">
              {candidates.map((d: Dossier) => (
                <li key={d.id}>
                  {/* bare-button: a row that is a whole option, its title and its line. */}
                  <button
                    type="button"
                    onClick={() => {
                      // The row goes with the list: the focus stays on the space, where Esc still closes it.
                      document.getElementById(spaceId)?.focus({ preventScroll: true });
                      setChosenId(d.id);
                    }}
                    disabled={d.forumBlocked}
                    className={`flex w-full items-center justify-between gap-2 ${CONTROL_RADIUS} px-3 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${TOUCH_TARGET_RESPONSIVE} md:py-2`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{d.title}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {kindLabel(d.kind)} · {d.items.length} {d.items.length === 1 ? 'voce' : 'voci'}
                        {d.forumBlocked ? " · ritirato dall'amministrazione" : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Expand>
  );
}
