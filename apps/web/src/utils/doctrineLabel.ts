/**
 * Names for the doctrine layer as the reader sees them.
 *
 * The layer is always called "Dottrina" on screen, never after the site it is
 * drawn from. Code identifiers (`BrocardiDisplay`, `brocardi_info`, the
 * `/brocardi/` segment of annotation ids, the `bg-brocardi` token) keep their
 * names on purpose: stored annotation ids and API fields use them, so renaming
 * them would orphan saved data. Only what a person can read goes through here.
 */

export const DOCTRINE_LABEL = 'Dottrina';

/** Title of the section listing Latin legal maxims (the payload's `Brocardi` key). */
export const LATIN_MAXIMS_LABEL = 'Locuzioni latine';

const PROVIDER_WORD = /\bbrocardi\b/i;
const PROVIDER_URL = /^https?:\/\/(?:www\.)?brocardi\.it(?:[/?#:]|$)/i;

/**
 * The label to show for a source name: "Dottrina" when the value names the
 * doctrine provider ("Brocardi", "brocardi.it"), the value itself otherwise.
 */
export function displaySourceName(value: string | null | undefined): string {
  if (value == null) return '';
  return PROVIDER_WORD.test(value) ? DOCTRINE_LABEL : value;
}

/** True for an http(s) URL on the doctrine provider's domain (with or without `www.`). */
export function isDoctrineProviderUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return PROVIDER_URL.test(value.trim());
}
