'use client';

import { useEffect, useRef, useState } from 'react';
import { Workbench, type WorkbenchMeta } from './Workbench';

const STORAGE_KEY = 'covenant.operator';

/** A demo access screen (no password) that fronts the workbench. Editorial,
 *  "credit desk terminal" styling. The entered name is remembered for the
 *  session and shown in the workbench; there is no real auth — this is a demo
 *  gate, stated plainly on screen. */
export function AccessGate({ meta }: { meta: WorkbenchMeta }) {
  const [operator, setOperator] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);
  const [entering, setEntering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setOperator(saved);
    } catch {
      // sessionStorage unavailable — just show the gate
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && !operator) inputRef.current?.focus();
  }, [ready, operator]);

  const enter = (asName: string) => {
    const clean = asName.trim() || 'Guest analyst';
    setEntering(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, clean);
    } catch {
      // ignore storage failure
    }
    // brief "decrypting" beat before revealing the desk
    window.setTimeout(() => setOperator(clean), 520);
  };

  const signOut = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setOperator(null);
    setName('');
    setEntering(false);
  };

  if (!ready) return null;

  if (operator) {
    return <Workbench meta={meta} operator={operator} onSignOut={signOut} />;
  }

  return (
    <div className={`gate ${entering ? 'gate-entering' : ''}`}>
      <div className="gate-grid" aria-hidden="true" />
      <div className="gate-ticker" aria-hidden="true">
        <div className="gate-ticker-run">
          {TICKER.concat(TICKER).map((t, i) => (
            <span className="gate-tick" key={i}>
              <b>{t.k}</b> {t.v} <em className={t.dir}>{t.d}</em>
            </span>
          ))}
        </div>
      </div>

      <header className="gate-top">
        <div className="gate-brand">
          <span className="gate-mark">◈</span> Ver<i>ity</i>
        </div>
        <div className="gate-top-meta">
          <span className="gate-live">
            <em />ACCESS // OPEN
          </span>
          <span>VOL. III · 2026</span>
        </div>
      </header>

      <main className="gate-main">
        <div className="gate-eyebrow">
          <span className="gate-dot" /> THE CREDIT DESK <span className="gate-rule" /> COVENANT
          INTELLIGENCE, CITED TO THE LINE.
        </div>

        <h1 className="gate-hero">
          Every number
          <br />
          has a <span className="accent">source.</span>
        </h1>

        <p className="gate-lede">
          A document-grounded agent that designs and monitors corporate loan covenants — planning,
          retrieving, calculating and composing a cited memo you can actually sign off on.
        </p>

        <form
          className="gate-form"
          onSubmit={(e) => {
            e.preventDefault();
            enter(name);
          }}
        >
          <div className="gate-field">
            <label htmlFor="operator">Operator</label>
            <input
              id="operator"
              ref={inputRef}
              type="text"
              autoComplete="off"
              placeholder="Type a name to enter the desk"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
            />
          </div>
          <button className="gate-enter" type="submit" disabled={entering}>
            {entering ? 'Decrypting…' : 'Enter terminal'} <span aria-hidden="true">→</span>
          </button>
        </form>

        <div className="gate-foot">
          NO PASSWORD · DEMO ACCESS · SYNTHETIC DATASET
          <button className="gate-skip" type="button" onClick={() => enter('Guest analyst')}>
            skip as guest →
          </button>
        </div>
      </main>

      <div className="gate-corner gate-corner-l" aria-hidden="true">
        EV/CS · DISPATCH 026
      </div>
      <div className="gate-corner gate-corner-r" aria-hidden="true">
        {meta.provider.configured
          ? `VULTR · ${(meta.provider.chatModel ?? 'LIVE').toUpperCase()}`
          : 'OFFLINE · DETERMINISTIC'}
      </div>
    </div>
  );
}

const TICKER: { k: string; v: string; d: string; dir: 'up' | 'down' | 'flat' }[] = [
  { k: 'NET LEV', v: '3.31×', d: 'TIGHT', dir: 'down' },
  { k: 'DSCR', v: '1.57×', d: 'OK', dir: 'up' },
  { k: 'CURRENT', v: '1.23×', d: 'OK', dir: 'up' },
  { k: 'PEN/USD', v: '3.7420', d: '—', dir: 'flat' },
  { k: 'BREACH ETA', v: '2026-Q3', d: 'WATCH', dir: 'down' },
  { k: 'HEADROOM', v: '5.5%', d: 'THIN', dir: 'down' },
];
