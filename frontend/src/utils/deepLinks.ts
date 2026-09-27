import type { SearchParams } from '../types';

const SEARCH_PARAM = 'norma';

function encodeUtf8(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeUtf8(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

export function buildSearchDeepLink(params: SearchParams, articleId?: string): string {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.searchParams.set(SEARCH_PARAM, encodeUtf8(JSON.stringify({ params, articleId })));
  return url.toString();
}

export function parseSearchDeepLink(value: string): { params: SearchParams; articleId?: string } | null {
  try {
    const decoded = JSON.parse(decodeUtf8(value)) as { params?: SearchParams; articleId?: string };
    if (!decoded.params?.act_type || !decoded.params.article && !decoded.params.act_number) return null;
    return { params: decoded.params, articleId: decoded.articleId };
  } catch {
    return null;
  }
}

export { SEARCH_PARAM };
