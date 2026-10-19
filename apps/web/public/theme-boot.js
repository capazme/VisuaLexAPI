// Applies the theme the reader chose before the first paint, so the splash, the session check and the
// login are drawn in the same theme as the app (Layout applies it again once React runs). A file and
// not an inline script: the ingress's Content-Security-Policy allows scripts from 'self' only.
try {
  var saved = JSON.parse(localStorage.getItem('visualex-storage') || 'null');
  var theme = saved && saved.state && saved.state.settings && saved.state.settings.theme;
  if (theme === 'dark') document.documentElement.classList.add('dark');
  document.documentElement.setAttribute('data-theme', theme || 'light');
} catch (e) {
  // No storage (private window, blocked site data): the default theme, light.
}
