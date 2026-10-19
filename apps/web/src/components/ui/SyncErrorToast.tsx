import { useAppStore } from '../../store/useAppStore';
import { Toast } from './Toast';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

/**
 * Global toast that surfaces server-sync failures for highlights and
 * annotations. The store exposes lastSyncError (newest error supersedes
 * the previous one) so we only ever render at most one toast.
 *
 * Mount once at the layout level — it reads directly from the store. Despite its name it carries
 * any transient error the app raises with `pushSyncError`. It sits in the toast band of the z-index
 * scale (the `Toast` alone is `z-[60]`, under every overlay): a zero-size fixed layer holds the
 * toast's own fixed box, so an error raised while the command palette is open still shows.
 */
export function SyncErrorToast() {
  const lastSyncError = useAppStore((s) => s.lastSyncError);
  const dismissSyncError = useAppStore((s) => s.dismissSyncError);

  return (
    <div data-testid="sync-error-layer" className={cn('fixed left-0 top-0', Z_INDEX.toast)}>
      <Toast
        message={lastSyncError?.message ?? ''}
        type="error"
        isVisible={lastSyncError !== null}
        onClose={() => {
          if (lastSyncError) dismissSyncError(lastSyncError.id);
        }}
        duration={5000}
        position="top"
      />
    </div>
  );
}
