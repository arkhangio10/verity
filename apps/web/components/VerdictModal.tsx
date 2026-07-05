'use client';

import type { RunVerdict } from '@covenant/agent';
import { useEffect } from 'react';
import { useI18n } from '../lib/i18n';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Resolve a verdict's headline/detail into the active language using the i18n
 *  keys the backend attached; falls back to the English text if keys absent. */
export function localizeVerdict(v: RunVerdict, t: T): { headline: string; detail: string } {
  if (!v.headlineKey || !v.detailKey) return { headline: v.headline, detail: v.detail };
  const p = { ...(v.params ?? {}) } as Record<string, string>;
  // special composed fragments
  if (p.cushion === '__CUSHION__') p.cushion = t('v.proposed.cushion');
  if (v.detailKey === 'v.drift.d') {
    p.cause = p.causeText ? t('v.drift.cause', { cause: p.causeText }) : '';
  }
  return { headline: t(v.headlineKey, p), detail: t(v.detailKey, p) };
}

export function localizeMetricLabel(m: { label: string; labelKey?: string }, t: T): string {
  return m.labelKey ? t(m.labelKey) : m.label;
}

/** The result pop-up: appears when the analysis completes, shows the headline
 *  conclusion + key metrics, and routes the reader into the full memo. */
export function VerdictModal({ verdict, onClose }: { verdict: RunVerdict; onClose: () => void }) {
  const { t } = useI18n();
  const { headline, detail } = localizeVerdict(verdict, t);
  const glyph = verdict.tone === 'critical' ? '▲' : verdict.tone === 'warning' ? '◆' : '✓';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statusText = verdict.statusKey ? t(verdict.statusKey) : t('verdict.title');
  const actionText = verdict.actionKey ? t(verdict.actionKey, verdict.params) : null;

  return (
    <>
      <div className="modal-overlay verdict-overlay" onClick={onClose} />
      <div className={`verdict-modal verdict-${verdict.tone}`} role="dialog" aria-label={statusText}>
        {/* 1 — Is it good or bad? A big, plain-language severity badge. */}
        <div className={`vm-badge vm-badge-${verdict.tone}`}>
          <span className="vm-glyph" aria-hidden="true">{glyph}</span>
          {statusText}
        </div>

        {/* 2 — What happened? The headline + one-line explanation. */}
        <h2 className="vm-headline">{headline}</h2>
        <div className="vm-section-label">{t('verdict.whatItMeans')}</div>
        <p className="vm-detail">{detail}</p>

        <div className="vm-metrics">
          {verdict.metrics.map((m, i) => (
            <div className={`vmetric vmetric-${m.tone ?? 'neutral'}`} key={i}>
              <span className="vmetric-label">{localizeMetricLabel(m, t)}</span>
              <span className="vmetric-value">{m.value}</span>
            </div>
          ))}
        </div>

        {/* 3 — What do I do now? The recommended next step, highlighted. */}
        {actionText && (
          <div className={`vm-action vm-action-${verdict.tone}`}>
            <div className="vm-action-label">→ {t('verdict.whatToDo')}</div>
            <div className="vm-action-text">{actionText}</div>
          </div>
        )}

        <div className="vm-actions">
          <button className="btn-primary" onClick={onClose}>
            {t('verdict.viewMemo')}
          </button>
        </div>
      </div>
    </>
  );
}
