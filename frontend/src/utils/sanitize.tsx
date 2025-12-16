/**
 * HTML sanitization utilities using DOMPurify to prevent XSS attacks
 */
import DOMPurify, { type Config } from 'dompurify';

/**
 * Default DOMPurify configuration
 * Allows safe HTML tags and attributes while removing scripts and dangerous elements
 */
const DEFAULT_CONFIG: Config = {
  ALLOWED_TAGS: [
    // Text formatting
    'p', 'br', 'span', 'div', 'b', 'i', 'u', 'strong', 'em', 'mark',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Lists
    'ul', 'ol', 'li',
    // Links (with safe attributes only)
    'a',
    // Tables
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    // Semantic elements
    'article', 'section', 'aside', 'nav', 'header', 'footer',
    // Code
    'pre', 'code',
    // Quotes
    'blockquote', 'q', 'cite',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'class', 'id', 'target', 'rel',
    'data-*', // Allow data attributes for custom functionality
  ],
  ALLOW_DATA_ATTR: true,
  // Force links to open in new tab and add noopener
  ADD_ATTR: ['target', 'rel'],
  // Remove any scripts, iframes, objects, etc.
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

/**
 * Strict configuration for untrusted content (e.g., user input)
 * Removes all HTML except basic text formatting
 */
const STRICT_CONFIG: Config = {
  ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
};

/**
 * Sanitize HTML string with default configuration
 *
 * @param dirty - Untrusted HTML string
 * @param config - Optional DOMPurify configuration (defaults to DEFAULT_CONFIG)
 * @returns Sanitized HTML string safe for rendering
 */
export function sanitizeHTML(dirty: string, config?: Config): string {
  if (!dirty) return '';

  const finalConfig = { ...config || DEFAULT_CONFIG, RETURN_TRUSTED_TYPE: false } as const;

  return DOMPurify.sanitize(dirty, finalConfig) as string;
}

/**
 * Sanitize HTML with strict configuration (minimal allowed tags)
 * Use this for user-generated content like comments or notes
 *
 * @param dirty - Untrusted HTML string
 * @returns Strictly sanitized HTML string
 */
export function sanitizeHTMLStrict(dirty: string): string {
  if (!dirty) return '';

  return DOMPurify.sanitize(dirty, { ...STRICT_CONFIG, RETURN_TRUSTED_TYPE: false }) as string;
}

/**
 * Create sanitized props for dangerouslySetInnerHTML
 *
 * @param html - Untrusted HTML string
 * @param strict - Use strict configuration (default: false)
 * @returns Object ready to use with dangerouslySetInnerHTML
 *
 * @example
 * ```tsx
 * <div {...createSafeHTML(content)} />
 * // Instead of:
 * // <div dangerouslySetInnerHTML={{ __html: content }} />
 * ```
 */
export function createSafeHTML(html: string, strict = false) {
  const sanitized = strict ? sanitizeHTMLStrict(html) : sanitizeHTML(html);

  return {
    dangerouslySetInnerHTML: {
      __html: sanitized,
    },
  };
}

/**
 * React component wrapper for sanitized HTML rendering
 *
 * @example
 * ```tsx
 * <SafeHTML html={untrustedContent} />
 * ```
 */
interface SafeHTMLProps {
  html: string;
  strict?: boolean;
  className?: string;
  as?: 'div' | 'span' | 'p' | 'article' | 'section';
}

export function SafeHTML({ html, strict = false, className, as: Tag = 'div' }: SafeHTMLProps) {
  const sanitized = strict ? sanitizeHTMLStrict(html) : sanitizeHTML(html);

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

/**
 * Sanitize text content (strip all HTML tags)
 *
 * @param dirty - String that may contain HTML
 * @returns Plain text with all HTML removed
 */
export function stripHTML(dirty: string): string {
  if (!dirty) return '';

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}

/**
 * Check if a string contains potentially dangerous HTML
 * Useful for validation before saving user input
 *
 * @param html - HTML string to check
 * @returns true if dangerous content detected
 */
export function containsDangerousHTML(html: string): boolean {
  if (!html) return false;

  const dangerous = [
    /<script/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /javascript:/i,
    /on\w+=/i, // onclick, onerror, etc.
  ];

  return dangerous.some((pattern) => pattern.test(html));
}

export default {
  sanitizeHTML,
  sanitizeHTMLStrict,
  createSafeHTML,
  SafeHTML,
  stripHTML,
  containsDangerousHTML,
};
