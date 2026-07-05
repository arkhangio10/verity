'use client';

import type { Fact, OutputSection, RunResult, TraceEvent } from '@covenant/agent';
import type { SourceRef } from '@covenant/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAgentRun } from '../lib/client/stream';
import { DocViewer, type ViewerTarget } from './DocViewer';
import { OutputPanel } from './OutputPanel';
import { TracePanel } from './TracePanel';

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

const MODE_LABELS: Record<Mode, string> = {
  before: 'Design covenants · BEFORE',
  after: 'Monitor · AFTER',
};

export function Workbench({
  meta,
  operator,
  onSignOut,
}: {
  meta: WorkbenchMeta;
  operator?: string;
  onSignOut?: () => void;
}) {
  const [mode, setMode] = useState<Mode>('after');
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [sections, setSections] = useState<OutputSection[]>([]);
  const [facts, setFacts] = useState<Record<string, Fact>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
          if (event.type === 'run_completed') setResult(event.result);
          if (event.type === 'error') setError(event.message);
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) setRunning(false);
    }
  }, [mode]);

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
          <small>{meta.product.tagline}</small>
        </div>
        <div className="company-chip">
          <b>{meta.company.name}</b>
          {meta.company.ticker ? ` · ${meta.company.ticker}` : ''} · {meta.company.country} ·{' '}
          {meta.company.currency} · as of {meta.asOfDate}
        </div>
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
            Stop
          </button>
        ) : (
          <button className="run-btn" onClick={() => void run()}>
            Run agent
          </button>
        )}
        <div className="provider-badge">
          <span className={`pill ${meta.provider.configured ? 'live' : 'offline'}`}>
            {meta.provider.configured
              ? `VULTR · ${meta.provider.chatModel ?? 'configured'}`
              : 'OFFLINE · deterministic planner'}
          </span>
          <span>
            retriever: {meta.provider.retriever} · loop: {meta.provider.loopMode}
          </span>
        </div>
        {operator && (
          <div className="operator-chip" title="Demo session — no real authentication">
            <span className="op-avatar" aria-hidden="true">
              {operator.slice(0, 1).toUpperCase()}
            </span>
            <span className="op-name">{operator}</span>
            {onSignOut && (
              <button className="op-signout" onClick={onSignOut} title="Sign out">
                exit
              </button>
            )}
          </div>
        )}
      </header>

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
    </div>
  );
}
