'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';

interface IngestedDocMeta {
  docId: string;
  title: string;
  kind: string;
  origin: 'case' | 'uploaded';
  status: 'ingested' | 'partial' | 'failed';
  detail: string;
  sizeLabel?: string;
}

interface DocumentsResponse {
  company: string;
  country: string;
  accountingStandard: string;
  sourceSystem: string;
  quarters: number;
  caseDocuments: IngestedDocMeta[];
  uploadedDocuments: IngestedDocMeta[];
}

/** Documents drawer: shows the case documents already ingested (the safe demo
 *  path) plus an optional dropzone to ingest your own PDF/JSON financial
 *  statement through the real Peru adapter. */
export function DocumentsPanel({
  sessionId,
  onClose,
  onUploadsChanged,
}: {
  sessionId: string;
  onClose: () => void;
  onUploadsChanged: (count: number) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/documents-list?session=${encodeURIComponent(sessionId)}`);
    if (res.ok) {
      const json = (await res.json()) as DocumentsResponse;
      setData(json);
      onUploadsChanged(json.uploadedDocuments.length);
    }
  }, [sessionId, onUploadsChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append('file', file);
          form.append('session', sessionId);
          const res = await fetch('/api/ingest', { method: 'POST', body: form });
          const json = (await res.json()) as { error?: string };
          if (!res.ok && json.error) setError(json.error);
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [sessionId, load],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer docs-drawer" role="dialog" aria-label={t('docs.title')}>
        <div className="drawer-head">
          <h3>{t('docs.title')}</h3>
          {data && <span className="kind">{data.sourceSystem}</span>}
          <button className="drawer-close" onClick={onClose} aria-label="✕">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {data && (
            <p className="docs-intro">
              <b>{data.company}</b> · {data.country} · {data.accountingStandard} · {data.quarters} ·{' '}
              {t('co.note')}
            </p>
          )}

          <div className="docs-section-label">{t('docs.case')}</div>
          <div className="docs-list">
            {data?.caseDocuments.map((d) => <DocRow key={d.docId} doc={d} t={t} />)}
            {!data && <div className="docs-loading">…</div>}
          </div>

          {data && data.uploadedDocuments.length > 0 && (
            <>
              <div className="docs-section-label">{t('docs.uploaded')}</div>
              <div className="docs-list">
                {data.uploadedDocuments.map((d) => <DocRow key={d.docId} doc={d} t={t} />)}
              </div>
            </>
          )}

          <div className="docs-section-label">{t('docs.upload')}</div>
          <div
            className={`dropzone ${dragOver ? 'over' : ''} ${busy ? 'busy' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.json,.txt,.csv,application/pdf,application/json"
              multiple
              hidden
              onChange={(e) => e.target.files && upload(e.target.files)}
            />
            <div className="dz-icon">{busy ? '⏳' : '⬆'}</div>
            <div className="dz-main">{busy ? t('docs.ingesting') : t('docs.drop')}</div>
            <div className="dz-sub">{t('docs.dropSub')}</div>
          </div>
          {error && <div className="review-banner" style={{ marginTop: 10 }}>{error}</div>}

          <p className="docs-note">{t('co.note')}</p>
        </div>
      </aside>
    </>
  );
}

function DocRow({ doc, t }: { doc: IngestedDocMeta; t: (k: string) => string }) {
  const icon = doc.kind.includes('Contrato') || doc.kind.includes('agreement')
    ? '§'
    : doc.kind.includes('transacciones') || doc.kind.includes('Ledger')
      ? '⇄'
      : '▤';
  return (
    <div className="doc-row">
      <span className="doc-icon">{icon}</span>
      <div className="doc-main">
        <div className="doc-title">{doc.title}</div>
        <div className="doc-detail">
          {doc.kind}
          {doc.sizeLabel ? ` · ${doc.sizeLabel}` : ''} · {doc.detail}
        </div>
      </div>
      <span className={`doc-status st-${doc.status}`}>
        {doc.status === 'ingested'
          ? t('docs.status.ingested')
          : doc.status === 'partial'
            ? t('docs.status.partial')
            : t('docs.status.failed')}
      </span>
    </div>
  );
}
