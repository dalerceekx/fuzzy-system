import type { StateStorage } from 'zustand/middleware';

/**
 * localStorage that never throws (private mode, blocked storage). Used only
 * for per-browser conveniences such as the selected farm — never for
 * tokens, passwords or server data.
 */
export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Storage unavailable: the preference simply is not remembered.
    }
  },
  removeItem(name) {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};
