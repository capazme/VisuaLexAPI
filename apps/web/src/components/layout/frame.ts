/**
 * The frame of the pages (U1, L-46 and L-47): one frame, one reading measure, the room left over to columns.
 *
 * The frame is the window less its margins — 16 px on a phone, 32 from `md`, 48 from 1536 px — and at most 1600 px
 * (`max-w-frame`), 2400 in full screen (`max-w-frame-full`). The margins are padding outside it (`box-content`), so the
 * frame is the column the page draws in. `Layout` draws it around every page, and the public «Crediti» page the same
 * way; the vertical padding is theirs.
 */
export const PAGE_FRAME = 'mx-auto box-content px-4 md:px-8 2xl:px-12';

/**
 * The width a page declares, once, on its root (`data-page-width`; `PageFrame` writes it from its `width`):
 * - `reading`: the body at the reading measure (`max-w-measure`), the title at the frame's edge as on every page;
 * - `work`: the frame, the default;
 * - `full`: the full-screen frame in the normal view too (the search page; after U4, the agenda): `Layout` widens to it
 *   through `:has()` (`FULL_PAGE_FRAME`), so no list of routes is kept apart from the pages.
 */
export type PageWidth = 'reading' | 'work' | 'full';

/** `Layout`'s frame while a `full` page is in it. */
export const FULL_PAGE_FRAME = 'has-[[data-page-width=full]]:max-w-frame-full';
