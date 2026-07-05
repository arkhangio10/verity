'use client';

import type { Fact } from '@covenant/agent';
import type { SourceDocument, SourceRef } from '@covenant/core';
import { useEffect, useRef, useState } from 'react';

export interface ViewerTarget {
  fact?: Fact;
  source?: SourceRef;
}

/** Right-side drawer that resolves a citation: shows the fact's provenance
 *  (label, formula, all sources) and the source document with the target
 *  section highlighted and the quoted text marked. */
export function DocViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const [source, setSource] = useState<SourceRef | undefined>(target.source);
  const [doc, setDoc] = useState<SourceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSource(target.source);
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    if (!source?.docId) return;
    fetch(`/api/documents/${encodeURIComponent(source.docId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`document "${source.docId}" not found`);
        return (await res.json()) as SourceDocument;
      })
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source?.docId]);

  useEffect(() => {
    if (doc && targetSectionRef.current) {
      targetSectionRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [doc, source?.sectionId]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Source document">
        <div className="drawer-head">
          <h3>{doc?.title ?? source?.docTitle ?? source?.docId ?? 'Provenance'}</h3>
          {doc && <span className="kind">{doc.kind}</span>}
          {doc && <span className="kind">{doc.language.toUpperCase()}</span>}
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">
          {target.fact && (
            <div className="fact-popover">
              <div className="fp-label">
                {target.fact.label} = <span className="num">{target.fact.formatted}</span>
                {target.fact.period ? ` (${target.fact.period})` : ''}
              </div>
              {target.fact.formula && <div className="fp-formula">{target.fact.formula}</div>}
              {target.fact.notes?.map((note, i) => (
                <div key={i} className="fp-formula">
                  note: {note}
                </div>
              ))}
              <div className="fp-src">
                {target.fact.sources.length === 0 && (
                  <span style={{ color: 'var(--text-faint)' }}>no document sources (policy-derived)</span>
                )}
                {target.fact.sources.map((s, i) => (
                  <button key={i} onClick={() => setSource(s)}>
                    ↳ {s.docTitle ?? s.docId}
                    {s.sectionTitle ? ` — ${s.sectionTitle}` : s.sectionId ? ` — §${s.sectionId}` : ''}
                    {s.locator ? ` · ${s.locator}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <div className="review-banner">{error}</div>}
          {!doc && !error && source?.docId && <div className="empty-state">Loading document…</div>}
          {doc &&
            doc.sections.map((section) => {
              const isTarget = source?.sectionId === section.id;
              return (
                <div
                  key={section.id}
                  ref={isTarget ? targetSectionRef : undefined}
                  className={`doc-section ${isTarget ? 'target' : ''}`}
                >
                  <h4>
                    §{section.id} — {section.title}
                  </h4>
                  <pre>{isTarget ? highlight(section.text, source?.quote) : section.text}</pre>
                </div>
              );
            })}
        </div>
      </aside>
    </>
  );
}

/** Mark the quoted evidence inside the target section, if present. */
function highlight(text: string, quote?: string): React.ReactNode {
  if (!quote) return text;
  const idx = text.toLowerCase().indexOf(quote.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + quote.length)}</mark>
      {text.slice(idx + quote.length)}
    </>
  );
}
