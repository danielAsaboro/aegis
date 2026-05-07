/**
 * Token-aware fetch helpers. The token lives in the URL query string
 * because that's what the server expects on every /api/* and /ws/*
 * request. We pull it from the page URL the user landed on (the server
 * prints `http://127.0.0.1:7474/?token=...` to the terminal).
 */

export function getToken(): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  return url.searchParams.get('token') || '';
}

export function apiUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('token', getToken());
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${proto}//${host}${path}?token=${encodeURIComponent(getToken())}`;
}

export async function jsonGet<T = unknown>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const r = await fetch(apiUrl(path, params), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
