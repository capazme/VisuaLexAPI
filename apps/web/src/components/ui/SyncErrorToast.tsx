import { useAppStore } from '../../store/useAppStore';
import { Toast } from './Toast';

/**
 * Global toast that surfaces server-sync failures for highlights and
 * annotations. The store exposes lastSyncError (newest error supersedes
 * the previous one) so we only ever render at most one toast.
 *
 * Mount once at the layout level — it reads directly from the store.
 */
export function SyncErrorToast() {
  const lastSyncError = useAppStore((s) => s.lastSyncError);
  const dismissSyncError = useAppStore((s) => s.dismissSyncError);

  return (
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
  );
}
