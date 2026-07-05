'use client';

import type { TraceEvent } from '@covenant/agent';
import type { SourceRef } from '@covenant/core';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';

/** LEFT panel: the live reasoning trace. Every plan, retrieval, tool call,
 *  decision and confidence assessment streams in as the agent works. */
export function TracePanel({
  events,
  running,
  onCite,
}: {
  events: TraceEvent[];
  running: boolean;
  onCite: (source: SourceRef) => void;
}) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events, pinned]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  return (
    <section className="panel" aria-label="Agent reasoning trace">
      <div className="panel-head">
        <span>{t('panel.trace')}</span>
        {running && <span className="run-dot">{t('trace.running')}</span>}
        <span className="head-count">{events.length > 0 ? `${events.length} ${t('trace.count')}` : ''}</span>
      </div>
      <div className="panel-body" ref={bodyRef} onScroll={onScroll}>
        {events.length === 0 ? (
          <div className="empty-state trace-empty">
            <div className="empty-icon" aria-hidden="true">◉</div>
            <p className="empty-lead">{t('empty.trace.lead')}</p>
            <p className="empty-sub">{t('empty.trace.sub')}</p>
            <p className="empty-cue">{t('empty.press')} <b>{t('btn.run')}</b> {t('empty.cue.start')} →</p>
          </div>
        ) : (
          events.map((event) => <TraceItem key={event.seq} event={event} onCite={onCite} />)
        )}
      </div>
    </section>
  );
}

function time(ts: string): string {
  return ts.slice(11, 19);
}

function TraceItem({ event, onCite }: { event: TraceEvent; onCite: (source: SourceRef) => void }) {
  switch (event.type) {
    case 'run_started':
      return (
        <Item tag="RUN" tagClass="step">
          <div className="trace-title">
            {event.mode === 'after' ? 'Monitoring run' : 'Covenant design run'} — {event.companyName}
          </div>
          <div className="trace-sub">
            test period {event.asOfQuarter} · planner {event.planner} · loop {event.loopMode} · provider{' '}
            {event.provider} · retriever {event.retriever} · {time(event.ts)}
          </div>
        </Item>
      );
    case 'plan_created':
      return (
        <Item tag="PLAN" tagClass="plan">
          <div className="trace-title">Plan created</div>
          <ol className="plan-steps">
            {event.steps.map((s) => (
              <li key={s.id}>
                <b>{s.title}</b> <span className="trace-sub">— {s.description}</span>
              </li>
            ))}
          </ol>
        </Item>
      );
    case 'step_started':
      return (
        <Item tag="STEP" tagClass="step">
          <div className="trace-title">{event.title}</div>
        </Item>
      );
    case 'step_completed':
      return null;
    case 'note':
      return (
        <Item tag={event.author === 'llm' ? 'LLM' : 'NOTE'} tagClass={event.author === 'llm' ? 'llm' : 'note'}>
          <div className="trace-detail">{event.text}</div>
        </Item>
      );
    case 'retrieval':
      return (
        <Item tag="RETRIEVE" tagClass="retrieve">
          <div className="trace-detail">
            “{event.query}” <span className="trace-sub">via {event.retriever}</span>
          </div>
          {event.hits.map((hit) => (
            <div className="hit" key={`${hit.docId}#${hit.sectionId}`}>
              <button
                className="where"
                onClick={() =>
                  onCite({
                    docId: hit.docId,
                    docTitle: hit.docTitle,
                    sectionId: hit.sectionId,
                    sectionTitle: hit.sectionTitle,
                  })
                }
                title="Open in document viewer"
              >
                {hit.docTitle} — {hit.sectionTitle} · score {hit.score}
              </button>
              <span className="snippet">{hit.snippet}</span>
            </div>
          ))}
          {event.hits.length === 0 && <div className="trace-sub">no matches</div>}
        </Item>
      );
    case 'tool_call':
      return (
        <Item tag="TOOL" tagClass="tool">
          <details className="trace-expand">
            <summary>
              <b>{event.tool}</b>
              <span className="trace-sub"> · {event.callId}</span>
            </summary>
            <div className="tool-args">{JSON.stringify(event.args)}</div>
          </details>
        </Item>
      );
    case 'tool_result':
      return (
        <Item tag={event.ok ? '✓ RESULT' : '✗ FAIL'} tagClass="tool">
          <div className={event.ok ? 'tool-result-ok' : 'tool-result-err'}>
            {event.ok ? event.summary : `${event.summary}: ${event.error ?? ''}`}
            {event.factIds.length > 0 && (
              <span className="trace-sub"> · {event.factIds.length} fact(s) registered</span>
            )}
          </div>
        </Item>
      );
    case 'decision':
      return (
        <Item tag="DECIDE" tagClass={`decide ${event.severity === 'critical' ? 'critical' : ''}`}>
          <div className="trace-title">{event.title}</div>
          <div className="trace-detail">{event.detail}</div>
        </Item>
      );
    case 'confidence':
      return (
        <Item tag="CONFID" tagClass="conf">
          <div className="trace-detail">
            <b>{event.subject}</b>: <span className={`conf-badge ${event.level}`}>{event.level}</span>{' '}
            <span className="trace-sub">{event.justification}</span>
          </div>
        </Item>
      );
    case 'output_section':
      return (
        <Item tag="COMPOSE" tagClass="note">
          <div className="trace-sub">
            → section “{event.section.heading}” added to the output panel
            {event.section.draftedBy === 'llm' ? ' (LLM-drafted, guard-verified)' : ''}
          </div>
        </Item>
      );
    case 'warning':
      return (
        <Item tag="WARN" tagClass="warn">
          <div className="trace-detail">{event.text}</div>
        </Item>
      );
    case 'error':
      return (
        <Item tag="ERROR" tagClass="warn">
          <div className="tool-result-err">{event.message}</div>
        </Item>
      );
    case 'run_completed':
      return (
        <Item tag="DONE" tagClass="step">
          <div className="trace-title">
            Run completed in {(event.result.durationMs / 1000).toFixed(1)}s
          </div>
          <div className="trace-sub">
            {event.result.factCount} cited facts · overall confidence {event.result.overallConfidence.level}
            {event.result.needsHumanReview ? ' · ROUTED TO HUMAN REVIEW' : ''}
          </div>
        </Item>
      );
    default:
      return null;
  }
}

function Item({
  tag,
  tagClass,
  children,
}: {
  tag: string;
  tagClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="trace-item">
      <span className={`tag ${tagClass}`}>{tag}</span>
      <div className="trace-content">{children}</div>
    </div>
  );
}
