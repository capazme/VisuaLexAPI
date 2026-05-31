/**
 * React component wrapper for sanitized HTML rendering.
 *
 * The pure sanitization helpers live in `./sanitizeHtml` so this file only
 * exports a component (react-refresh/only-export-components). Existing
 * importers of `SafeHTML` keep importing from `utils/sanitize`.
 */
import { memo, useMemo } from 'react';
import { sanitizeHTML, sanitizeHTMLStrict } from './sanitizeHtml';

interface SafeHTMLProps {
  html: string;
  strict?: boolean;
  className?: string;
  as?: 'div' | 'span' | 'p' | 'article' | 'section';
}

function SafeHTMLBase({ html, strict = false, className, as: Tag = 'div' }: SafeHTMLProps) {
  // DOMPurify on a full article body can cost 50-200ms. Without this
  // memo every unrelated parent re-render (e.g. a store mutation for
  // another article) would pay that cost again even when `html` is the
  // same string reference. The sanitize step is preserved — we just
  // cache its result on the (html, strict) tuple.
  const sanitized = useMemo(
    () => (strict ? sanitizeHTMLStrict(html) : sanitizeHTML(html)),
    [html, strict],
  );
  const props = { __html: sanitized };

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={props}
    />
  );
}

// React.memo skips the re-render entirely when props are shallow-equal,
// so the sanitization (and matching DOM diff of a big innerHTML) no
// longer fires when the parent re-renders with the same props.
export const SafeHTML = memo(SafeHTMLBase);
