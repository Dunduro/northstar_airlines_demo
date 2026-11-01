import { session, hasRole } from './api';
import { Link, match, navigate, useLocation } from './router';
import { Login } from './views/Login';
import { OverviewView } from './views/Overview';
import { AccountDetail, AccountList } from './views/Accounts';
import { RolloutsView } from './views/Rollouts';
import { ExceptionsView } from './views/Exceptions';
import { AccessView } from './views/Access';
import { OnboardingView, PeopleView } from './views/Onboarding';
import { NotificationsPanel } from './views/Notifications';
import { TemplatesView } from './views/Templates';

const routes: Array<[string, (p: Record<string, string>) => JSX.Element]> = [
  ['/', () => <OverviewView />],
  ['/accounts', () => <AccountList />],
  ['/accounts/:id', (p) => <AccountDetail id={p.id!} />],
  ['/rollouts', () => <RolloutsView />],
  ['/rollouts/:id', (p) => <RolloutsView id={p.id} />],
  ['/exceptions', () => <ExceptionsView />],
  ['/templates', () => <TemplatesView />],
  ['/access', () => <AccessView />],
  ['/onboarding', () => <OnboardingView personId={session.claims!.oid} self />],
  ['/people', () => <PeopleView />],
  ['/people/:id', (p) => <OnboardingView personId={p.id!} />],
];

export function App() {
  const { path } = useLocation();
  const claims = session.claims;
  if (!claims) return <Login />;

  let page: JSX.Element = <p>Not found</p>;
  for (const [pattern, render] of routes) {
    const params = match(pattern, path);
    if (params) {
      page = render(params);
      break;
    }
  }

  const nav = [
    ['/', 'Overview'],
    ['/accounts', 'Accounts'],
    ['/rollouts', 'Rollouts'],
    ['/exceptions', 'Exceptions'],
    ['/templates', 'Templates'],
    ['/access', 'My access'],
    ['/onboarding', 'Onboarding'],
    ...(hasRole('admin') ? [['/people', 'People']] : []),
  ];
  const active = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          NorthStar <span>Platform</span>
        </div>
        <nav className="nav">
          {nav.map(([to, label]) => (
            <Link key={to} to={to!} className={active(to!) ? 'active' : ''}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="user">
          <span title={claims.groups.join(', ')}>
            {claims.name} · {claims.roles.join(', ')}
          </span>
          <button
            className="secondary"
            onClick={() => {
              session.clear();
              navigate('/');
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="main">{page}</main>
      <NotificationsPanel />
    </div>
  );
}
