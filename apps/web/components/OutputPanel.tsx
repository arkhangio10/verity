'use client';

import type {
  Fact,
  OutputBlock,
  OutputSection,
  RunResult,
  RunVerdict,
  Span,
} from '@covenant/agent';
import type { SourceRef } from '@covenant/core';
import { useI18n } from '../lib/i18n';
import { localizeMetricLabel, localizeVerdict } from './VerdictModal';

interface OutputPanelProps {
  mode: 'before' | 'after';
  sections: OutputSection[];
  facts: Record<string, Fact>;
  result: RunResult | null;
  running: boolean;
  error: string | null;
  disclaimer: string;
  onCite: (source: SourceRef) => void;
  onFact: (factId: string) => void;
}

/** RIGHT panel: the cited deliverable — a term sheet (BEFORE) or an
 *  escalation memo (AFTER). Every number is a fact chip that opens its
 *  sources; every claim can carry citation marks. */
export function OutputPanel({
  mode,
  sections,
  facts,
  result,
  running,
  error,
  disclaimer,
  onCite,
  onFact,
}: OutputPanelProps) {
  const { t } = useI18n();
  const title =
    result?.output.title ?? (mode === 'after' ? 'Escalation memo' : 'Covenant design term sheet');

  return (
    <section className="panel" aria-label="Cited output">
      <div className="panel-head">
        <span>{mode === 'after' ? t('panel.answer.after') : t('panel.answer.before')}</span>
        {result && (
          <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
            <ConfidenceBadge
              level={result.overallConfidence.level}
              justification={result.overallConfidence.justification}
            />
          </span>
        )}
      </div>
      <div className="panel-body">
        {error && <div className="review-banner">Run error: {error}</div>}
        {sections.length === 0 && !error ? (
          <div className="empty-state answer-empty">
            {running ? (
              <>
                <div className="spinner" aria-hidden="true" />
                <p>{t('answer.composing')}</p>
              </>
            ) : (
              <>
                <div className="empty-icon" aria-hidden="true">{mode === 'after' ? '⚖' : '✎'}</div>
                <p className="empty-lead">
                  {mode === 'after' ? t('empty.answer.after.lead') : t('empty.answer.before.lead')}
                </p>
                <p className="empty-sub">
                  {mode === 'after' ? t('empty.answer.after.sub') : t('empty.answer.before.sub')}
                </p>
                <p className="empty-cue">{t('empty.press')} <b>{t('btn.run')}</b> {t('empty.cue.generate')} →</p>
              </>
            )}
          </div>
        ) : (
          <>
            {result?.verdict && <VerdictBanner verdict={result.verdict} t={t} />}
            {result && (
              <div className="memo-header">
                <h2>{title}</h2>
                <div className="basis">{result.output.basisNote}</div>
                <div className="memo-flags">
                  <ConfidenceBadge
                    level={result.overallConfidence.level}
                    justification={result.overallConfidence.justification}
                  />
                  <span className="drafted-by">
                    {result.factCount} {t('memo.citedFacts')} · {t('memo.planner')} {result.planner} · {result.loopMode} {t('memo.loop')}
                  </span>
                </div>
                {result.needsHumanReview && (
                  <div className="review-banner" style={{ marginTop: 8 }}>
                    {t('memo.needsReview')}
                  </div>
                )}
              </div>
            )}
            {sections.map((section) => (
              <SectionView
                key={section.id}
                section={section}
                facts={facts}
                onCite={onCite}
                onFact={onFact}
                t={t}
              />
            ))}
            {result && <div className="disclaimer">{result.output.disclaimer}</div>}
            {!result && <div className="disclaimer">{disclaimer}</div>}
          </>
        )}
      </div>
    </section>
  );
}

export function ConfidenceBadge({ level, justification }: { level: string; justification?: string }) {
  return (
    <span className={`conf-badge ${level}`} title={justification}>
      {level}
    </span>
  );
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** The headline conclusion — read this first, then the detail below. */
function VerdictBanner({ verdict, t }: { verdict: RunVerdict; t: T }) {
  const glyph = verdict.tone === 'critical' ? '▲' : verdict.tone === 'warning' ? '◆' : '✓';
  const { headline, detail } = localizeVerdict(verdict, t);
  const statusText = verdict.statusKey ? t(verdict.statusKey) : '';
  const actionText = verdict.actionKey ? t(verdict.actionKey, verdict.params) : null;
  return (
    <div className={`verdict verdict-${verdict.tone}`}>
      <div className="verdict-top">
        <span className="verdict-glyph" aria-hidden="true">{glyph}</span>
        <span className="verdict-headline">{headline}</span>
        {statusText && <span className={`vm-badge vm-badge-${verdict.tone} verdict-status`}>{statusText}</span>}
      </div>
      <p className="verdict-detail">{detail}</p>
      {verdict.metrics.length > 0 && (
        <div className="verdict-metrics">
          {verdict.metrics.map((m, i) => (
            <div className={`vmetric vmetric-${m.tone ?? 'neutral'}`} key={i}>
              <span className="vmetric-label">{localizeMetricLabel(m, t)}</span>
              <span className="vmetric-value">{m.value}</span>
            </div>
          ))}
        </div>
      )}
      {actionText && (
        <div className={`vm-action vm-action-${verdict.tone}`} style={{ marginTop: 12 }}>
          <div className="vm-action-label">→ {t('verdict.whatToDo')}</div>
          <div className="vm-action-text">{actionText}</div>
        </div>
      )}
    </div>
  );
}

function SectionView({
  section,
  facts,
  onCite,
  onFact,
  t,
}: {
  section: OutputSection;
  facts: Record<string, Fact>;
  onCite: (source: SourceRef) => void;
  onFact: (factId: string) => void;
  t: T;
}) {
  // per-section citation numbering
  const citeIndex = new Map<string, number>();
  const citeNumber = (source: SourceRef): number => {
    const key = `${source.docId}#${source.sectionId ?? ''}`;
    const existing = citeIndex.get(key);
    if (existing !== undefined) return existing;
    const next = citeIndex.size + 1;
    citeIndex.set(key, next);
    return next;
  };

  const renderSpans = (spans: Span[]) =>
    spans.map((span, i) => {
      switch (span.kind) {
        case 'text':
          return <span key={i}>{span.text}</span>;
        case 'strong':
          return <b key={i}>{span.text}</b>;
        case 'fact': {
          const fact = facts[span.factId];
          return (
            <button
              key={i}
              className={`fact ${fact ? '' : 'missing'}`}
              title={fact ? `${fact.label}${fact.formula ? ` — ${fact.formula}` : ''}` : span.factId}
              onClick={() => onFact(span.factId)}
            >
              {fact?.formatted ?? '…'}
            </button>
          );
        }
        case 'cite':
          return (
            <button
              key={i}
              className="cite"
              title={`${span.source.docTitle ?? span.source.docId}${span.source.sectionTitle ? ` — ${span.source.sectionTitle}` : ''}`}
              onClick={() => onCite(span.source)}
            >
              [{citeNumber(span.source)}]
            </button>
          );
        default:
          return null;
      }
    });

  const renderSources = (sources: SourceRef[]) =>
    sources.map((source, i) => (
      <button
        key={i}
        className="cite"
        title={`${source.docTitle ?? source.docId}${source.sectionTitle ? ` — ${source.sectionTitle}` : ''}`}
        onClick={() => onCite(source)}
      >
        [{citeNumber(source)}]
      </button>
    ));

  const renderBlock = (block: OutputBlock, key: number) => {
    switch (block.kind) {
      case 'paragraph':
        return <p key={key}>{renderSpans(block.spans)}</p>;
      case 'callout':
        return (
          <div key={key} className={`callout ${block.tone}`}>
            {renderSpans(block.spans)}
          </div>
        );
      case 'covenant_table':
        return (
          <table key={key} className="cov-table">
            <thead>
              <tr>
                <th>Covenant</th>
                <th>Required</th>
                <th>Actual</th>
                <th>Headroom</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => {
                const actual = facts[row.actualFactId];
                const headroom = facts[row.headroomPctFactId];
                return (
                  <tr key={row.covenantId}>
                    <td>
                      {row.label} {renderSources(row.sources)}
                    </td>
                    <td className="num">{row.requirementText}</td>
                    <td className="num">
                      <button className="fact" onClick={() => onFact(row.actualFactId)} title={actual?.label}>
                        {actual?.formatted ?? '…'}
                      </button>
                    </td>
                    <td>
                      <HeadroomBar pct={headroom?.value ?? 0} status={row.status} />
                      <button
                        className="fact"
                        onClick={() => onFact(row.headroomPctFactId)}
                        title={headroom?.label}
                      >
                        {headroom?.formatted ?? '…'}
                      </button>
                    </td>
                    <td>
                      <span className={`status-pill ${row.status}`}>{row.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      case 'key_values':
        return (
          <table key={key} className="kv-table">
            <tbody>
              {block.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    {item.label} {item.sources ? renderSources(item.sources) : null}
                  </td>
                  <td className="num">
                    {item.factId ? (
                      <button
                        className="fact"
                        onClick={() => onFact(item.factId!)}
                        title={facts[item.factId]?.label}
                      >
                        {facts[item.factId]?.formatted ?? '…'}
                      </button>
                    ) : null}
                    {item.text ? <span style={{ fontFamily: 'var(--sans)' }}> {item.text}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'cause_list':
        return (
          <div key={key}>
            {block.items.map((item) => (
              <div className="cause" key={item.rank}>
                <div>
                  <span className="rank">#{item.rank}</span>
                  <span className="cause-title">{item.title}</span>
                </div>
                <div style={{ marginTop: 4, color: 'var(--text-dim)' }}>{renderSpans(item.spans)}</div>
                <div className="evidence">
                  evidence:{' '}
                  {item.evidence.map((ev) => (
                    <button key={ev.transactionId} onClick={() => onCite(ev.source)}>
                      {ev.transactionId} · {ev.date} ·{' '}
                      {facts[ev.amountFactId]?.formatted ?? ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      case 'proposal_table':
        return (
          <table key={key} className="cov-table">
            <thead>
              <tr>
                <th>Covenant</th>
                <th>Proposed</th>
                <th>Step-downs</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.covenantId}>
                  <td>
                    {row.label} {renderSources(row.sources)}
                  </td>
                  <td className="num">{row.requirementText}</td>
                  <td className="num">{row.stepDownText ?? '—'}</td>
                  <td>{renderSpans(row.basisSpans)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      default:
        return null;
    }
  };

  // Section headings come from the backend in English; translate the known set.
  const heading = t(`h.${section.heading}`);
  return (
    <div className="section" id={`section-${section.id}`}>
      <div className="section-head">
        <h3>{heading === `h.${section.heading}` ? section.heading : heading}</h3>
        {section.draftedBy === 'llm' && <span className="drafted-by">{t('draftedBy.llm')}</span>}
        {section.needsHumanReview && <span className="status-pill breach">{t('section.needsReview')}</span>}
        {section.confidence && (
          <ConfidenceBadge level={section.confidence.level} justification={section.confidence.justification} />
        )}
      </div>
      <div className="section-body">{section.blocks.map((block, i) => renderBlock(block, i))}</div>
    </div>
  );
}

function HeadroomBar({ pct, status }: { pct: number; status: string }) {
  const width = Math.max(0, Math.min(1, pct / 0.3)) * 100;
  const color = status === 'breach' ? 'var(--red)' : status === 'tight' ? 'var(--amber)' : 'var(--green)';
  return (
    <span className="headroom-bar" title="headroom relative to a 30% scale">
      <i style={{ width: `${width}%`, background: color }} />
    </span>
  );
}
