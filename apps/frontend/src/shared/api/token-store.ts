type Listener = (token: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener(accessToken);
}

/**
 * The access token lives in memory only (never localStorage/sessionStorage),
 * so an XSS payload cannot lift a long-lived credential from storage. The
 * refresh token is an HttpOnly cookie the page cannot read at all.
 */
export const accessTokenStore = {
  get(): string | null {
    return accessToken;
  },
  set(token: string): void {
    accessToken = token;
    notify();
  },
  clear(): void {
    if (accessToken === null) return;
    accessToken = null;
    notify();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
