(function () {
  var STORAGE_KEY = 'theme';
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function readStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  function writeStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_error) {
      // Ignore storage failures (private mode / disabled storage).
    }
  }

  function preferredTheme() {
    var saved = readStoredTheme();
    if (saved === 'light' || saved === 'dark') return saved;
    return media.matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    if (root.style.backgroundColor) {
      // Drop prepaint fallback color so runtime theme changes are CSS-driven and in sync.
      root.style.backgroundColor = '';
    }
    if (toggle) {
      toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }

  function setTheme(theme) {
    writeStoredTheme(theme);
    applyTheme(theme);
  }

  var theme = preferredTheme();
  applyTheme(theme);

  if (toggle) {
    toggle.addEventListener('click', function () {
      var current = root.getAttribute('data-theme') || 'light';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  media.addEventListener('change', function () {
    var saved = readStoredTheme();
    if (saved === 'light' || saved === 'dark') return;
    applyTheme(preferredTheme());
  });
})();
