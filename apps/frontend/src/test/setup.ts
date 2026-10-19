import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { getViewportWidth, setViewportWidth } from './viewport';

// Pages are lazy route chunks; the first render of a page can take longer
// than the 1 s default on a busy CI machine.
configure({ asyncUtilTimeout: 4_000 });

// jsdom lacks matchMedia: emulate min-width queries against a configurable
// viewport width (desktop by default).
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => mediaQueryList(query),
  });
}

function mediaQueryList(query: string): MediaQueryList {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const width = getViewportWidth();
  const noop = () => undefined;
  return {
    matches: min ? width >= Number(min[1]) : true,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  };
}

if (!window.scrollTo) {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
}

afterEach(() => {
  cleanup();
  setViewportWidth(1280);
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
});
