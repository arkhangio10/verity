'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';

export interface Readiness {
  quarterCount: number;
  quarterLabels: string[];
  hasConsecutive4: boolean;
  hasCovenants: boolean;
  canRunBefore: boolean;
  canRunAfter: boolean;
  messages: string[];
}

export interface CompanyOption {
  id: string;
  name: string;
  isBase: boolean;
  readiness?: Readiness;
}

/** The base demo case, always available and always ready. */
export const BASE_COMPANY: CompanyOption = { id: 'base', name: 'Alimentos Andinos S.A.A. (caso demo)', isBase: true };

interface CompanyManagerProps {
  sessionId: string;
  activeCompanyId: string;
  onSelect: (id: string) => void;
  companies: CompanyOption[];
  onCompaniesChanged: (companies: CompanyOption[]) => void;
  disabled: boolean;
}

/** Company selector + "create a company" modal. Lets the user analyze the base
 *  demo case OR build a new company from their own uploaded filings. */
export function CompanyManager({
  sessionId,
  activeCompanyId,
  onSelect,
  companies,
  onCompaniesChanged,
  disabled,
}: CompanyManagerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const nameOf = (c: CompanyOption) => (c.isBase ? t('co.demo') : c.name);
  const active = companies.find((c) => c.id === activeCompanyId) ?? BASE_COMPANY;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/company?session=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const json = (await res.json()) as { companies: Omit<CompanyOption, 'isBase'>[] };
    const created = json.companies.map((c) => ({ ...c, isBase: false }));
    onCompaniesChanged([BASE_COMPANY, ...created]);
  }, [sessionId, onCompaniesChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="company-picker">
      <button className="company-select" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <span className="cs-dot" aria-hidden="true" />
        <span className="cs-name">{nameOf(active)}</span>
        <span className="cs-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="cs-overlay" onClick={() => setOpen(false)} />
          <div className="cs-menu" role="listbox">
            {companies.map((c) => (
              <button
                key={c.id}
                className={`cs-item ${c.id === activeCompanyId ? 'active' : ''}`}
                role="option"
                aria-selected={c.id === activeCompanyId}
                onClick={() => {
                  onSelect(c.id);
                  setOpen(false);
                }}
              >
                <span className="cs-item-name">{nameOf(c)}</span>
                {!c.isBase && c.readiness && (
                  <span className={`cs-ready ${c.readiness.canRunBefore ? 'ok' : 'pending'}`}>
                    {c.readiness.quarterCount}Q{c.readiness.canRunAfter ? ' · covenants' : ''}
                  </span>
                )}
                {c.isBase && <span className="cs-ready ok">{t('co.ready')}</span>}
              </button>
            ))}
            <button
              className="cs-create"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              {t('co.create')}
            </button>
          </div>
        </>
      )}
      {creating && (
        <CreateCompanyModal
          sessionId={sessionId}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            await refresh();
            onSelect(id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

// ── Create-company modal ─────────────────────────────────────────────────────

function CreateCompanyModal({
  sessionId,
  onClose,
  onCreated,
}: {
  sessionId: string;
  onClose: () => void;
  onCreated: (companyId: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createCompany = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, name }),
      });
      const json = (await res.json()) as { company?: { id: string }; readiness?: Readiness; error?: string };
      if (!res.ok || !json.company) {
        setError(json.error ?? 'no se pudo crear la empresa');
        return;
      }
      setCompanyId(json.company.id);
      setReadiness(json.readiness ?? null);
      setLog((l) => [`Empresa "${name}" creada.`, ...l]);
    } finally {
      setBusy(false);
    }
  }, [name, sessionId]);

  const uploadFilings = useCallback(
    async (files: FileList | File[]) => {
      if (!companyId) return;
      setError(null);
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append('session', sessionId);
          form.append('companyId', companyId);
          form.append('file', file);
          const res = await fetch('/api/company/filing', { method: 'POST', body: form });
          const json = (await res.json()) as {
            ok?: boolean;
            period?: string;
            mappedFields?: number;
            error?: string;
            readiness?: Readiness;
          };
          if (json.ok) {
            setLog((l) => [`✓ ${json.period}: ${json.mappedFields} campos mapeados`, ...l]);
            if (json.readiness) setReadiness(json.readiness);
          } else {
            setLog((l) => [`✕ ${file.name}: ${json.error ?? 'error'}`, ...l]);
            setError(json.error ?? null);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [companyId, sessionId],
  );

  const setCovenants = useCallback(async () => {
    if (!companyId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/company/covenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, companyId }),
      });
      const json = (await res.json()) as { ok?: boolean; readiness?: Readiness; error?: string };
      if (json.ok) {
        setLog((l) => ['✓ leverage ≤3.50× · DSCR ≥1.25× · current ≥1.10×', ...l]);
        if (json.readiness) setReadiness(json.readiness);
      } else setError(json.error ?? null);
    } finally {
      setBusy(false);
    }
  }, [companyId, sessionId]);

  const step = !companyId ? 1 : (readiness?.quarterCount ?? 0) < 4 ? 2 : !readiness?.hasCovenants ? 3 : 4;

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-label={t('co.modal.title')}>
        <div className="modal-head">
          <h3>{t('co.modal.title')}</h3>
          <button className="drawer-close" onClick={onClose} aria-label="✕">✕</button>
        </div>
        <div className="modal-body">
          <div className="create-steps">
            <span className={step >= 1 ? 'cstep done' : 'cstep'}>{t('co.step.name')}</span>
            <span className={step >= 2 ? 'cstep active' : 'cstep'}>{t('co.step.quarters')}</span>
            <span className={step >= 3 ? 'cstep' : 'cstep'}>{t('co.step.covenants')}</span>
            <span className={step >= 4 ? 'cstep ready' : 'cstep'}>{t('co.step.ready')}</span>
          </div>

          {/* Step 1: name */}
          <label className="field-label">{t('co.field.name')}</label>
          <div className="field-row">
            <input
              className="text-input"
              value={name}
              disabled={!!companyId || busy}
              placeholder="Minera Los Andes S.A."
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !companyId && name.length >= 2 && createCompany()}
            />
            {!companyId && (
              <button className="btn-primary" onClick={createCompany} disabled={busy || name.trim().length < 2}>
                {t('co.field.create')}
              </button>
            )}
          </div>

          {companyId && (
            <>
              {/* Step 2: quarters */}
              <label className="field-label">
                {t('co.field.quarters')} <span className="req">{t('co.field.quartersReq')}</span>
              </label>
              <div
                className="dropzone small"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) void uploadFilings(e.dataTransfer.files);
                }}
                role="button"
                tabIndex={0}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.json,.txt,application/pdf,application/json"
                  multiple
                  hidden
                  onChange={(e) => e.target.files && uploadFilings(e.target.files)}
                />
                <span className="dz-icon">{busy ? '⏳' : '⬆'}</span>
                <span className="dz-main">{t('co.drop')}</span>
                <span className="dz-sub">
                  {t('co.dropSub')} <code>2026-Q1</code>)
                </span>
              </div>

              {/* Progress */}
              {readiness && (
                <div className="ready-box">
                  <div className="ready-row">
                    <span>{t('co.ready.quarters')}</span>
                    <b className={readiness.hasConsecutive4 ? 'ok' : 'pending'}>
                      {readiness.quarterCount}
                      {readiness.quarterLabels.length > 0 ? ` (${readiness.quarterLabels.join(', ')})` : ''}
                    </b>
                  </div>
                  <div className="ready-row">
                    <span>{t('co.ready.covenants')}</span>
                    {readiness.hasCovenants ? (
                      <b className="ok">{t('co.ready.yes')}</b>
                    ) : (
                      <button className="btn-mini" onClick={setCovenants} disabled={busy || !readiness.hasConsecutive4}>
                        {t('co.ready.applyTemplate')}
                      </button>
                    )}
                  </div>
                  <div className="ready-flags">
                    <span className={readiness.canRunBefore ? 'flag ok' : 'flag off'}>
                      {readiness.canRunBefore ? '✓' : '○'} {t('co.flag.before')}
                    </span>
                    <span className={readiness.canRunAfter ? 'flag ok' : 'flag off'}>
                      {readiness.canRunAfter ? '✓' : '○'} {t('co.flag.after')}
                    </span>
                  </div>
                  {readiness.messages.map((m, i) => (
                    <div key={i} className="ready-msg">{m}</div>
                  ))}
                </div>
              )}

              {log.length > 0 && (
                <div className="create-log">
                  {log.slice(0, 6).map((l, i) => (
                    <div key={i} className={l.startsWith('✕') ? 'log-err' : 'log-ok'}>{l}</div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <div className="review-banner" style={{ marginTop: 10 }}>{error}</div>}

          <div className="modal-actions">
            {companyId && readiness?.canRunBefore ? (
              <button className="btn-primary" onClick={() => onCreated(companyId)}>
                {t('co.use')}
              </button>
            ) : (
              <button className="btn-ghost" onClick={onClose}>
                {companyId ? t('co.saveClose') : t('co.cancel')}
              </button>
            )}
          </div>
          <p className="modal-note">{t('co.note')}</p>
        </div>
      </div>
    </>
  );
}
