const REVOKE_AFTER_MS = 1000;

/**
 * Saves a blob through a temporary link, then lets the object URL go. The URL is not revoked at
 * once: a browser that has not started the download yet would find it gone. The one helper behind
 * every file the app writes (decision downloads, the notes and highlights .txt, an environment).
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
