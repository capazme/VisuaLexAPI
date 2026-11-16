import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { attiService } from '../../../services/attiService';

/**
 * An address of the act editor, gone with LC53 (`/work/atti/:id`): to the «Atti» tab of the act's dossier, where its
 * text downloads as a Word file; an act with no dossier, or one that cannot be read, to the dossiers.
 */
export function OldAttoRedirect() {
  const { id = '' } = useParams();
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    attiService
      .get(id)
      .then(
        (atto) => (atto.dossierId ? `/dossier?dossier=${encodeURIComponent(atto.dossierId)}&vista=atti` : '/dossier'),
        () => '/dossier',
      )
      .then((next) => alive && setTo(next));
    return () => {
      alive = false;
    };
  }, [id]);
  return to ? <Navigate to={to} replace /> : <p className="p-6 text-sm text-slate-600 dark:text-slate-400">Caricamento…</p>;
}
