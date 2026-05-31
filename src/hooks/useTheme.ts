import { useCallback, useState } from 'react';

const THEME_KEY = 'intent-editor.theme';
export type Theme = 'light' | 'dark';

/** Current theme — the inline script in index.html already set `data-theme` (saved or OS preference). */
function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Light/dark theme, persisted to `localStorage` and reflected on `<html data-theme>`. */
export function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
