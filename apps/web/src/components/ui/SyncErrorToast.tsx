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
 * any transient error the app raises with `pushSyncError`. In the app it is an entry of the notification stack
 * (`NotificationHost`, in the toast band, at the top); the zero-size fixed layer in the toast band holds the toast's
 * own fixed box only where no stack is mounted (the `Toast` alone is `z-[60]`, under every overlay).
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
