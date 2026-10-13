import { useId, useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { TextParagraphs } from '../../../components/features/studia/TextParagraphs';
import { cn } from '../../../lib/utils';
import type { MerltNotice } from '../../../services/merltService';
import type { MerltConsentLevel } from '../merltConsent';
import { CONSENT_LEVELS } from './levels';

/**
 * The one place a MERL-T consent is chosen: the notice in full (every word from the server's
 * version, plain text), the three levels, the notice's checkbox — needed for «Base» and
 * «Completo», not to say no — and the notice's button. `ConsentScreen` shows it once, before
 * work begins, and it cannot be dismissed there; `ConsentDialog` shows it on request.
 */

export interface ConsentChoiceModalProps {
  isOpen: boolean;
  notice: MerltNotice;
  /** The level offered as chosen: the person's last one, or none for someone never asked. */
  initialLevel: MerltConsentLevel | null;
  /** The once-only screen cannot be dismissed: choosing «Nessuna raccolta» is the way out. */
  dismissible: boolean;
  intro: string;
  onConfirm: (level: MerltConsentLevel, noticeId: string) => Promise<void>;
  onCancel?: () => void;
}

export function ConsentChoiceModal({
  isOpen,
  notice,
  initialLevel,
  dismissible,
  intro,
  onConfirm,
  onCancel,
}: ConsentChoiceModalProps) {
  const [selected, setSelected] = useState<MerltConsentLevel | null>(initialLevel);
  // The tick belongs to a version: a new notice shows it unticked, with no effect to reset it.
  const [tickedFor, setTickedFor] = useState<string | null>(null);
  const ticked = tickedFor === notice.id;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupName = useId();
  const checkboxId = useId();
  const noticeHeadingId = useId();
  const firstOptionRef = useRef<HTMLInputElement>(null);

  // Reset to the offered level each time the modal opens (derived during render, gotcha 11).
  const [trackedOpen, setTrackedOpen] = useState(isOpen);
  if (isOpen !== trackedOpen) {
    setTrackedOpen(isOpen);
    if (isOpen) {
      setSelected(initialLevel);
      setTickedFor(null);
      setError(null);
    }
  }

  const needsTick = selected !== null && selected !== 'none';
  const canConfirm = selected !== null && (!needsTick || ticked) && !saving;

  const handleConfirm = async () => {
    if (selected === null) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(selected, notice.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La scelta non è stata salvata: riprova.');
    } finally {
      setSaving(false);
    }
  };

  const close = onCancel ?? (() => {});

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={notice.titolo}
      size="lg"
      showCloseButton={dismissible}
      closeOnBackdrop={dismissible}
      closeOnEscape={dismissible}
      initialFocusRef={firstOptionRef}
      footer={
        <>
          {dismissible && (
            <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-0" onClick={close}>
              Annulla
            </Button>
          )}
          <Button
            size="sm"
            className="min-h-[44px] md:min-h-0"
            disabled={!canConfirm}
            loading={saving}
            onClick={() => void handleConfirm()}
          >
            {notice.azione}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <p>{intro}</p>

        <section aria-labelledby={noticeHeadingId}>
          <h3 id={noticeHeadingId} className="mb-2 text-xs font-bold uppercase text-slate-500">
            Informativa · versione {notice.versione}
          </h3>
          <div
            tabIndex={0}
            data-testid="merlt-notice-body"
            className={cn(
              'max-h-[40vh] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 leading-relaxed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              'dark:border-slate-700 dark:bg-slate-800/50',
            )}
          >
            <TextParagraphs body={notice.corpo} />
          </div>
        </section>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-bold uppercase text-slate-500">La tua scelta</legend>
          {CONSENT_LEVELS.map((meta, index) => {
            const isSelected = selected === meta.level;
            const optionId = `${groupName}-${meta.level}`;
            return (
              <label
                key={meta.level}
                htmlFor={optionId}
                data-testid={`consent-option-${meta.level}`}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-150',
                  isSelected
                    ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/30'
                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
                )}
              >
                <input
                  ref={index === 0 ? firstOptionRef : undefined}
                  id={optionId}
                  type="radio"
                  name={groupName}
                  value={meta.level}
                  checked={isSelected}
                  onChange={() => setSelected(meta.level)}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                <span>
                  <span className="block font-semibold text-slate-900 dark:text-white">{meta.title}</span>
                  <span className="block text-slate-600 dark:text-slate-300">{meta.summary}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex items-start gap-2">
          <input
            id={checkboxId}
            type="checkbox"
            checked={ticked}
            onChange={(e) => setTickedFor(e.target.checked ? notice.id : null)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <label htmlFor={checkboxId} className="cursor-pointer">
            {notice.conferma}
            {needsTick && !ticked && (
              <span className="block text-xs text-slate-500">Serve per «Base» e «Completo».</span>
            )}
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
