import { useState, FormEvent } from 'react';
import { ArrowRight, Radio, ShieldCheck } from 'lucide-react';
import { api, setCsrf } from '../api';
import { Brand, Spinner, Field } from '../components/ui';
export function Login({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const response = await api<{ csrf: string }>(
        setup ? '/auth/setup' : '/auth/login',
        'POST',
        Object.fromEntries(f),
      );
      setCsrf(response.csrf);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">A LITTLE SIGNAL. A CLEARER PICTURE.</span>
          <h1>
            Your projects.
            <br />
            Always in sight.
          </h1>
          <p>
            A quiet home for your Supabase projects, scheduled database activity, and everything in
            between.
          </p>
          <div className="signal-art" aria-hidden="true">
            <Radio size={110} strokeWidth={0.7} />
            <span />
            <span />
            <span />
          </div>
        </div>
        <small>Self-hosted. Open source. Yours.</small>
      </section>
      <section className="login-form">
        <div className="login-brand">
          <Brand />
        </div>
        <div className="login-inner">
          <span className="small-icon">
            <ShieldCheck size={24} />
          </span>
          <h2>{setup ? 'Set up your workspace' : 'Welcome back'}</h2>
          <p>
            {setup
              ? 'Create the administrator account for this instance.'
              : 'Sign in to your SupaBeacon instance.'}
          </p>
          <form onSubmit={(e) => void submit(e)}>
            {setup && (
              <Field
                label="One-time setup token"
                hint="Find SETUP_TOKEN in the .env file created by setup.sh."
              >
                <input
                  name="setupToken"
                  type="password"
                  required
                  autoComplete="off"
                  minLength={32}
                />
              </Field>
            )}
            <Field label="Username">
              <input
                name="username"
                required
                minLength={3}
                maxLength={80}
                pattern="[a-zA-Z0-9_.@-]+"
                autoComplete="username"
                placeholder="admin"
              />
            </Field>
            <Field
              label="Password"
              hint={setup ? 'At least 12 characters. Use a unique password.' : undefined}
            >
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete={setup ? 'new-password' : 'current-password'}
              />
            </Field>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button full" disabled={pending}>
              {pending ? (
                <Spinner />
              ) : (
                <>
                  {setup ? 'Create administrator' : 'Sign in'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          <div className="login-note">
            <ShieldCheck size={15} />
            Your Supabase credentials stay on this server.
          </div>
        </div>
      </section>
    </div>
  );
}
