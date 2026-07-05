/** Documents are the ground truth the agent cites. They are stored as ordered
 *  sections with stable ids so SourceRefs stay valid across renders. */
export type DocumentKind = 'credit_agreement' | 'filing' | 'knowledge' | 'ledger';

export interface DocSection {
  id: string;
  title: string;
  text: string;
}

export interface SourceDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  language: 'en' | 'es';
  period?: string;
  date?: string;
  sections: DocSection[];
}

/** Retrieval unit. Sections are small enough to be chunks by themselves. */
export interface CorpusChunk {
  id: string;
  docId: string;
  docTitle: string;
  docKind: DocumentKind;
  sectionId: string;
  sectionTitle: string;
  text: string;
  period?: string;
}

export function chunksFromDocuments(docs: SourceDocument[]): CorpusChunk[] {
  return docs.flatMap((doc) =>
    doc.sections.map((s) => ({
      id: `${doc.id}#${s.id}`,
      docId: doc.id,
      docTitle: doc.title,
      docKind: doc.kind,
      sectionId: s.id,
      sectionTitle: s.title,
      text: s.text,
      period: doc.period,
    })),
  );
}

export function findSection(doc: SourceDocument, sectionId: string): DocSection | undefined {
  return doc.sections.find((s) => s.id === sectionId);
}

/** Doc id for the fallback definition templates used in BEFORE mode. The
 *  sample corpus ships a rendered copy so template citations resolve too. */
export const STANDARD_DEFINITIONS_DOC_ID = 'standard-definitions';
