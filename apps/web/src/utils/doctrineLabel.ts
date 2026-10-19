/**
 * Names for the doctrine layer as the reader sees them.
 *
 * The layer is called "Dottrina" on screen, and its source is credited
 * wherever its content appears. Code identifiers (`BrocardiDisplay`,
 * `brocardi_info`, the `/brocardi/` segment of annotation ids, the
 * `bg-brocardi` token) keep their names on purpose: stored annotation ids and
 * API fields use them, so renaming them would orphan saved data.
 */

export const DOCTRINE_LABEL = 'Dottrina';

/** Title of the section listing Latin legal maxims (the payload's `Brocardi` key). */
export const LATIN_MAXIMS_LABEL = 'Locuzioni latine';

/** Name of the site the doctrine is drawn from, used in every credit and link to it. */
export const DOCTRINE_SOURCE_NAME = 'Brocardi.it';

/** The credit line shown with doctrine content, on screen and in exports. */
export const DOCTRINE_ATTRIBUTION = `Fonte: ${DOCTRINE_SOURCE_NAME}`;
