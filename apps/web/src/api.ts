/** Tiny API client: bearer token from the (simulated) Entra sign-in, JSON in/out, polling hook. */
import { useCallback, useEffect, useState } from 'react';

const TOKEN_KEY = 'northstar.token';
const CLAIMS_KEY = 'northstar.claims';

export interface Claims {
  oid: string;
  name: string;
  groups: string[];
  roles: string[];
}

export const session = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get claims(): Claims | null {
    const raw = localStorage.getItem(CLAIMS_KEY);
    return raw ? (JSON.parse(raw) as Claims) : null;
  },
  set(token: string, claims: Claims) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CLAIMS_KEY);
  },
};

export const hasRole = (role: string) => Boolean(session.claims?.roles.includes(role));

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(session.token ? { authorization: `Bearer ${session.token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && path.startsWith('/v1/') && !path.startsWith('/v1/auth')) {
    session.clear();
    window.location.assign('/');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data?.message ?? res.statusText);
  return data as T;
}

/** Fetch + optional polling (the backend is async: what you trigger shows up a moment later). */
export function useApi<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    setData(undefined);
    void load();
    if (!pollMs) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, error, reload: load };
}
