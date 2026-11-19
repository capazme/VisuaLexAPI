import { useEffect, useId, useState } from 'react';
import { TOUCH_TARGET_RESPONSIVE } from '../../../constants/interactions';
import { cn } from '../../../lib/utils';
import * as adminService from '../../../services/adminService';
import { setCoursesSwitch } from '../studia/corsi/coursesSwitch';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { CARD_RADIUS } from '../../ui/controlStyles';

/** A box that holds things: `Card`'s 8 px corners (`CARD_RADIUS`). */
const PANEL = cn('border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800', CARD_RADIUS);
const KEY = 'lingo_courses';

/**
 * The switch of «Percorsi» (`lingo_courses`, LC9): read from `GET /admin/switches`, written with
 * `PUT /admin/switches/lingo_courses { enabled }`. Off, every course route answers 404 and the web draws nothing of
 * the courses; the rows stay. Only this switch: the others have no page.
 */
export function CoursesSwitchAdmin() {
  const headingId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [round, setRound] = useState(0);
  const [saving, setSaving] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  // Turning off hides the courses from everyone: it asks first; turning on stays one tap (LC12).
  const [askingOff, setAskingOff] = useState(false);
  const [offFrom, setOffFrom] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let live = true;
    adminService.appSwitches().then(
      (switches) => {
        if (!live) return;
        setEnabled(switches.find((s) => s.key === KEY)?.enabled ?? false);
        setReadFailed(false);
      },
      () => live && setReadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [round]);

  const toggle = async () => {
    if (enabled === null) return;
    setAskingOff(false);
    setSaving(true);
    setWriteFailed(false);
    try {
      const stored = await adminService.setAppSwitch(KEY, !enabled);
      setEnabled(stored.enabled);
      // This tab follows at once; other tabs and users read `GET /api/features` (a few seconds' cache on the server).
      setCoursesSwitch(stored.enabled);
    } catch {
      setWriteFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className={PANEL}>
      <h3 id={headingId} className="text-base font-semibold text-gray-900 dark:text-white">Percorsi</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        I percorsi di studio creati dall’assistente. Spenti, nessuno li vede; i percorsi già creati restano.
      </p>
      {readFailed && enabled === null ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <p>Non riesco a leggere l’interruttore dei percorsi.</p>
          <Button variant="outline" className={TOUCH_TARGET_RESPONSIVE} onClick={() => setRound((n) => n + 1)}>
            Riprova
          </Button>
        </div>
      ) : enabled === null ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Carico l’interruttore…</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p aria-live="polite" className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {enabled ? 'I percorsi sono accesi.' : 'I percorsi sono spenti.'}
          </p>
          {/* Not `disabled` while it writes: a disabled button drops the focus to the page (#458). */}
          <Button
            variant={enabled ? 'outline' : 'primary'}
            className={TOUCH_TARGET_RESPONSIVE}
            aria-disabled={saving}
            onClick={(event) => {
              if (saving) return;
              if (enabled) {
                setOffFrom(event.currentTarget);
                setAskingOff(true);
              }
              else void toggle();
            }}
          >
            {enabled ? 'Spegni i percorsi' : 'Accendi i percorsi'}
          </Button>
        </div>
      )}
      {writeFailed && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          Non sono riuscito a cambiare l’interruttore. Riprova.
        </p>
      )}
      <ConfirmDialog
        open={askingOff}
        origin={offFrom}
        variant="danger"
        title="Spegnere i percorsi?"
        message="Nessuno vedrà più i percorsi finché non li riaccendi; i percorsi già creati restano."
        confirmLabel="Spegni"
        focusCancel
        onConfirm={() => void toggle()}
        onCancel={() => setAskingOff(false)}
      />
    </section>
  );
}
