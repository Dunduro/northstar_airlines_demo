/** A minimal router (history API): enough for a handful of views, no dependency. */
import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

const listeners = new Set<() => void>();

export function navigate(to: string) {
  window.history.pushState({}, '', to);
  listeners.forEach((l) => l());
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const update = () => setLoc({ path: window.location.pathname, search: window.location.search });
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return loc;
}

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}

/** Match "/accounts/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const trim = (x: string) => (x.length > 1 ? x.replace(/\/$/, '') : x);
  const p = trim(pattern).split('/');
  const a = trim(path).split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(a[i]!);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
