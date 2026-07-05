'use client';

import type { Fact, OutputSection, RunResult, TraceEvent } from '@covenant/agent';
import type { SourceRef } from '@covenant/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAgentRun } from '../lib/client/stream';
import { I18nProvider, LANGS, useI18n, type Lang } from '../lib/i18n';
import { BASE_COMPANY, CompanyManager, type CompanyOption } from './CompanyManager';
import { DocumentsPanel } from './DocumentsPanel';
import { DocViewer, type ViewerTarget } from './DocViewer';
import { OutputPanel } from './OutputPanel';
import { TracePanel } from './TracePanel';
import { VerdictModal } from './VerdictModal';

export interface WorkbenchMeta {
  product: { name: string; tagline: string; disclaimer: string };
  provider: {
    name: string;
    configured: boolean;
    chatModel: string | null;
    retriever: string;
    retrieverReason: string;
    loopMode: string;
  };
  company: {
    name: string;
    ticker: string | null;
    country: string;
    accountingStandard: string;
    currency: string;
    sourceSystem: string;
  };
  asOfDate: string;
  quarters: number;
  agreementTitle: string | null;
}

type Mode = 'before' | 'after';

/** Public wrapper: provides the i18n context to the whole workbench. */
export function Workbench(props: { meta: WorkbenchMeta; operator?: string; onSignOut?: () => void }) {
  return (
    <I18nProvider>
      <WorkbenchInner {...props} />
    </I18nProvider>
  );
}

function WorkbenchInner({
  meta,
  operator,
  onSignOut,
}: {
  meta: WorkbenchMeta;
  operator?: string;
  onSignOut?: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const [mode, setMode] = useState<Mode>('after');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [sections, setSections] = useState<OutputSection[]>([]);
  const [facts, setFacts] = useState<Record<string, Fact>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [companies, setCompanies] = useState<CompanyOption[]>([BASE_COMPANY]);
  const [activeCompanyId, setActiveCompanyId] = useState('base');
  const [verdictOpen, setVerdictOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const MODE_LABELS: Record<Mode, string> = { before: t('mode.before'), after: t('mode.after') };
  // Stable per-tab session id so uploads attach to this browser session.
  const sessionRef = useRef<string>('');
  if (!sessionRef.current) {
    sessionRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Math.random()}`;
  }

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setEvents([]);
    setSections([]);
    setFacts({});
    setResult(null);
    setError(null);
    setRunning(true);
    try {
      await streamAgentRun(
        mode,
        (event) => {
          setEvents((prev) => [...prev, event]);
          if (event.type === 'output_section') {
            setFacts((prev) => ({ ...prev, ...event.facts }));
            setSections((prev) => {
              const next = prev.filter((s) => s.id !== event.section.id);
              next.push(event.section);
              return next;
            });
          }
          if (event.type === 'run_completed') {
            setResult(event.result);
            if (event.result.verdict) setVerdictOpen(true);
          }
          if (event.type === 'error') setError(event.message);
        },
        controller.signal,
        sessionRef.current,
        activeCompanyId,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) setRunning(false);
    }
  }, [mode, activeCompanyId]);

  // Readiness gate: for a user-created company, block the run until it has the
  // data the chosen mode needs, with a clear reason.
  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? BASE_COMPANY;
  const runBlockedReason: string | null = activeCompany.isBase
    ? null
    : mode === 'after'
      ? activeCompany.readiness?.canRunAfter
        ? null
        : t('gate.after')
      : activeCompany.readiness?.canRunBefore
        ? null
        : t('gate.before');

  const openCitation = useCallback((source: SourceRef) => {
    setViewer({ source });
  }, []);

  const openFact = useCallback(
    (factId: string) => {
      const fact = facts[factId];
      if (fact) setViewer({ fact, source: fact.sources[0] });
    },
    [facts],
  );

  const switchMode = (next: Mode) => {
    if (running) return;
    setMode(next);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>
            <span>◈</span> {meta.product.name}
          </h1>
          <small>{t('app.tagline')}</small>
        </div>
        <LangSwitch lang={lang} onChange={setLang} />
        <CompanyManager
          sessionId={sessionRef.current}
          activeCompanyId={activeCompanyId}
          onSelect={setActiveCompanyId}
          companies={companies}
          onCompaniesChanged={setCompanies}
          disabled={running}
        />
        <button
          className="docs-btn"
          onClick={() => setDocsOpen(true)}
          title={t('btn.docs')}
        >
          ▤ {t('btn.docs')}
          {uploadCount > 0 && <span className="docs-count">{uploadCount}</span>}
        </button>
        <div className="mode-switch" role="tablist" aria-label="Agent mode">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => switchMode(m)}
              disabled={running}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {running ? (
          <button className="run-btn stop" onClick={stop}>
            {t('btn.stop')}
          </button>
        ) : (
          <button
            className="run-btn"
            onClick={() => void run()}
            disabled={!!runBlockedReason}
            title={runBlockedReason ?? t('btn.run')}
          >
            {t('btn.run')}
          </button>
        )}
        <div className="provider-badge">
          <span className={`pill ${meta.provider.configured ? 'live' : 'offline'}`}>
            {meta.provider.configured
              ? `VULTR · ${meta.provider.chatModel ?? 'configured'}`
              : t('badge.offline')}
          </span>
          <span>
            {t('badge.retriever')}: {meta.provider.retriever} · {t('badge.loop')}: {meta.provider.loopMode}
          </span>
        </div>
        {operator && (
          <div className="operator-chip" title="Demo session — no real authentication">
            <span className="op-avatar" aria-hidden="true">
              {operator.slice(0, 1).toUpperCase()}
            </span>
            <span className="op-name">{operator}</span>
            {onSignOut && (
              <button className="op-signout" onClick={onSignOut} title={t('btn.exit')}>
                {t('btn.exit')}
              </button>
            )}
          </div>
        )}
      </header>

      <StepRail hasRun={events.length > 0} running={running} done={!!result} mode={mode} t={t} />

      {runBlockedReason && !running && (
        <div className="run-gate">⚠ {runBlockedReason}</div>
      )}

      <main className="main">
        <TracePanel events={events} running={running} onCite={openCitation} />
        <OutputPanel
          mode={mode}
          sections={sections}
          facts={facts}
          result={result}
          running={running}
          error={error}
          disclaimer={meta.product.disclaimer}
          onCite={openCitation}
          onFact={openFact}
        />
      </main>

      {viewer && <DocViewer target={viewer} onClose={() => setViewer(null)} />}
      {docsOpen && (
        <DocumentsPanel
          sessionId={sessionRef.current}
          onClose={() => setDocsOpen(false)}
          onUploadsChanged={setUploadCount}
        />
      )}
      {verdictOpen && result?.verdict && (
        <VerdictModal verdict={result.verdict} onClose={() => setVerdictOpen(false)} />
      )}
    </div>
  );
}

/** Compact language switcher (ES · EN · FR). */
function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          className={lang === l.code ? 'active' : ''}
          onClick={() => onChange(l.code)}
          title={l.label}
        >
          {l.flag}
        </button>
      ))}
    </div>
  );
}

/** The guided 3-step rail under the topbar: tells the user where they are —
 *  choose the question, run the agent, read the answer. */
function StepRail({
  hasRun,
  running,
  done,
  mode,
  t,
}: {
  hasRun: boolean;
  running: boolean;
  done: boolean;
  mode: Mode;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const active = running ? 2 : done ? 3 : hasRun ? 2 : 1;
  const steps = [
    { n: 1, title: t('step.1.title'), hint: mode === 'after' ? t('step.1.hint.after') : t('step.1.hint.before') },
    { n: 2, title: t('step.2.title'), hint: t('step.2.hint') },
    { n: 3, title: t('step.3.title'), hint: t('step.3.hint') },
  ];
  return (
    <div className="step-rail" role="list" aria-label="How to use">
      {steps.map((s, i) => (
        <div
          key={s.n}
          className={`step ${s.n === active ? 'active' : ''} ${s.n < active ? 'passed' : ''}`}
          role="listitem"
        >
          <span className="step-num">{s.n < active ? '✓' : s.n}</span>
          <span className="step-text">
            <b>{s.title}</b>
            <em>{s.hint}</em>
          </span>
          {i < steps.length - 1 && <span className="step-arrow" aria-hidden="true">→</span>}
        </div>
      ))}
    </div>
  );
}
