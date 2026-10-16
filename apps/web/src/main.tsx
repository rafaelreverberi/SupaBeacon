import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CircleHelp,
  Database,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { Settings } from '../../../packages/shared/config';
import { api, setCsrf } from './api';
import type { Connection } from './lib/types';
import { configureDates } from './lib/date';
import { Brand, Spinner, Button } from './components/ui';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './style.css';
import { Login } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ProjectsPage, ProjectPage } from './pages/Projects';
import { History } from './pages/History';
import { Logs } from './pages/Logs';
import { SettingsPage } from './pages/Settings';
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
function App() {
  const qc = useQueryClient();
  const [route, setRoute] = useState(location.hash.slice(1) || '/');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: () =>
      api<{ authenticated: boolean; setupRequired: boolean; csrf?: string; username?: string }>(
        '/auth/status',
      ),
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<
        Settings & {
          port: string;
          origin: string;
          version: string;
          uptime: number;
          databaseHealth: string;
        }
      >('/settings'),
    enabled: !!auth.data?.authenticated,
  });
  const connection = useQuery({
    queryKey: ['connection'],
    queryFn: () => api<Connection>('/oauth/status'),
    enabled: !!auth.data?.authenticated,
    refetchInterval: 15000,
  });
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || '/');
      setMobile(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    const expired = () => {
      void qc.invalidateQueries({ queryKey: ['auth'] });
    };
    window.addEventListener('session-expired', expired);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('session-expired', expired);
    };
  }, [qc]);
  useEffect(() => {
    if (auth.data?.csrf) setCsrf(auth.data.csrf);
  }, [auth.data]);
  useEffect(() => {
    if (settings.data) {
      configureDates(settings.data.timezone, settings.data.dateFormat === '12h');
      const t = settings.data.theme;
      document.documentElement.dataset.theme =
        t === 'system'
          ? matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : t;
    }
  }, [settings.data]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 9000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const action = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      await qc.invalidateQueries();
      setBusy(false);
    }
  };
  if (auth.isPending)
    return (
      <div className="splash">
        <Brand />
        <Spinner />
      </div>
    );
  if (auth.isError)
    return (
      <div className="splash">
        <Brand />
        <p role="alert">The server is unavailable.</p>
        <Button onClick={() => void auth.refetch()}>Retry</Button>
      </div>
    );
  if (!auth.data?.authenticated)
    return (
      <Login
        setup={!!auth.data?.setupRequired}
        onDone={() => {
          qc.clear();
          void auth.refetch();
        }}
      />
    );
  const title = route.startsWith('/projects')
    ? 'Projects'
    : route === '/activity'
      ? 'Activity'
      : route === '/logs'
        ? 'Logs'
        : route === '/settings'
          ? 'Settings'
          : 'Overview';
  return (
    <div className="shell">
      <aside className={mobile ? 'sidebar open' : 'sidebar'}>
        <a href="#/" className="brand-link">
          <Brand />
        </a>
        <div className="workspace">
          <span className="workspace-icon">S</span>
          <div>
            My workspace<small>Self-hosted instance</small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {[
            ['/', 'Overview', LayoutDashboard],
            ['/projects', 'Projects', Database],
            ['/activity', 'Activity', Activity],
            ['/logs', 'Logs', Terminal],
            ['/settings', 'Settings', Settings2],
          ].map(([href, label, Icon]) => {
            const I = Icon as typeof Activity;
            return (
              <a
                key={String(href)}
                href={`#${href}`}
                aria-current={title === label ? 'page' : undefined}
                className={title === label ? 'selected' : ''}
              >
                <I size={18} />
                {String(label)}
                {label === 'Projects' && <span className="nav-dot" />}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <a
            className="docs-link"
            href="https://supabase.com/docs/guides/platform/free-project-pausing"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={17} />
            About project activity
            <ExternalLink size={13} />
          </a>
          <div className="connection-box">
            <span className={`status-dot ${connection.data?.connected ? 'on' : ''}`} />
            <div>
              Supabase
              <small>
                {connection.data?.connected
                  ? 'Connected'
                  : connection.data?.reauthorize
                    ? 'Reconnect required'
                    : 'Not connected'}
              </small>
            </div>
            <a href="#/settings" aria-label="Integration settings">
              <Settings2 size={16} />
            </a>
          </div>
          <div className="profile">
            <span className="avatar">{auth.data.username?.slice(0, 1).toUpperCase()}</span>
            <div>
              {auth.data.username}
              <small>Administrator</small>
            </div>
            <button
              className="icon-button"
              aria-label="Log out"
              onClick={() => void action(() => api('/auth/logout', 'POST'), 'Signed out')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={21} />
          </button>
          <span>
            Workspace<span className="slash">/</span>
            <b>{title}</b>
          </span>
          <div className="top-right">
            <span className="selfhost">
              <ShieldCheck size={14} />
              Self-hosted
            </span>
            <span className="separator" />
            <span className="status-dot on" />
            Instance online
          </div>
        </header>
        <main key={title}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR SUPABASE WORKSPACE</div>
              <h1>{title}</h1>
              <p>
                {title === 'Overview'
                  ? 'Your Supabase projects, always in sight.'
                  : title === 'Projects'
                    ? 'Every authorized project. One place to manage activity.'
                    : title === 'Activity'
                      ? 'A complete record of your database heartbeat executions.'
                      : title === 'Logs'
                        ? 'Operational events, without sensitive data.'
                        : 'Make this instance work for you.'}
              </p>
            </div>
            {title !== 'Settings' && (
              <div className="heading-actions">
                <Button
                  secondary
                  disabled={busy || !connection.data?.connected}
                  onClick={() =>
                    void action(() => api('/projects/sync', 'POST'), 'Projects synchronized')
                  }
                >
                  <RefreshCw size={15} />
                  Sync projects
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    location.hash = '/settings';
                  }}
                >
                  <Settings2 size={15} />
                  Configure
                </Button>
              </div>
            )}
          </div>
          {title === 'Overview' && (
            <OverviewPage
              connected={!!connection.data?.connected}
              configured={!!connection.data?.configured}
              busy={busy}
              action={action}
            />
          )}
          {title === 'Projects' &&
            (route.split('/')[2] ? (
              <ProjectPage
                id={route.split('/')[2]}
                action={action}
                busy={busy}
                dataEnabled={!!connection.data?.dataEnabled}
              />
            ) : (
              <ProjectsPage action={action} busy={busy} />
            ))}
          {title === 'Activity' && <History />}
          {title === 'Logs' && <Logs />}
          {title === 'Settings' && settings.data && connection.data && (
            <SettingsPage
              settings={settings.data}
              connection={connection.data}
              action={action}
              busy={busy}
            />
          )}
          <footer>
            <span>
              <Radio size={13} />
              SupaBeacon <span className="muted">·</span> Your infrastructure, your control.
            </span>
            <span>Pause-prevention effectiveness is unverified.</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
