import type { LedgerEntry, SourceDocument, SourceRef } from '@covenant/core';

const LEDGER_DOC_ID = 'transaction-ledger';

const src = (id: string): SourceRef => ({
  docId: LEDGER_DOC_ID,
  docTitle: 'Registro de Movimientos de Tesorería (extracto)',
  sectionId: id,
  locator: id,
});

/**
 * Curated treasury ledger for the monitoring window. The 2026-02-15 special
 * distribution is the seeded "real cause" of the leverage drift; the revolver
 * draws show how it was funded. Aggregated operating flows keep the picture
 * complete without hundreds of noise rows.
 */
export function buildLedger(): LedgerEntry[] {
  const entries: LedgerEntry[] = [
    {
      id: 'tx-2025-07-15-draw',
      date: '2025-07-15',
      category: 'revolver_draw',
      amount: 6_000,
      direction: 'inflow',
      counterparty: 'Banco de Crédito del Perú',
      memo: 'Disposición línea revolvente — capital de trabajo estacional',
      source: src('tx-2025-07-15-draw'),
    },
    {
      id: 'tx-2025-08-21-div',
      date: '2025-08-21',
      category: 'distribution',
      amount: 15_000,
      direction: 'outflow',
      counterparty: 'Accionistas',
      memo: 'Dividendo ordinario ejercicio 2024 — segunda cuota',
      source: src('tx-2025-08-21-div'),
    },
    {
      id: 'tx-2025-10-08-draw',
      date: '2025-10-08',
      category: 'revolver_draw',
      amount: 20_000,
      direction: 'inflow',
      counterparty: 'Interbank',
      memo: 'Disposición línea revolvente — necesidades de caja del cuarto trimestre',
      source: src('tx-2025-10-08-draw'),
    },
    {
      id: 'tx-2025-11-20-div',
      date: '2025-11-20',
      category: 'distribution',
      amount: 20_000,
      direction: 'outflow',
      counterparty: 'Accionistas',
      memo: 'Dividendo extraordinario aprobado por Junta General 2025-11-05',
      source: src('tx-2025-11-20-div'),
    },
    {
      id: 'tx-2026-01-22-draw',
      date: '2026-01-22',
      category: 'revolver_draw',
      amount: 12_000,
      direction: 'inflow',
      counterparty: 'Banco de Crédito del Perú',
      memo: 'Disposición línea revolvente — financiamiento general',
      source: src('tx-2026-01-22-draw'),
    },
    {
      id: 'tx-2026-02-15-div',
      date: '2026-02-15',
      category: 'distribution',
      amount: 45_000,
      direction: 'outflow',
      counterparty: 'Accionistas',
      memo: 'Distribución extraordinaria a accionistas — acuerdo de Junta General 2026-01-30',
      source: src('tx-2026-02-15-div'),
    },
    {
      id: 'tx-2026-02-28-capex',
      date: '2026-02-28',
      category: 'capex_payment',
      amount: 9_300,
      direction: 'outflow',
      counterparty: 'Contratistas varios',
      memo: 'Ampliación línea de empaque — Planta Lurín (porción no financiada)',
      source: src('tx-2026-02-28-capex'),
    },
    {
      id: 'tx-2026-03-05-lease',
      date: '2026-03-05',
      category: 'lease_addition',
      amount: 7_000,
      direction: 'non_cash',
      counterparty: 'Divemotor S.A.',
      memo: 'Arrendamiento financiero flota de reparto (18 camiones) — NIIF 16',
      source: src('tx-2026-03-05-lease'),
    },
    {
      id: 'tx-2026-03-28-amort',
      date: '2026-03-28',
      category: 'term_amortization',
      amount: 6_500,
      direction: 'outflow',
      counterparty: 'Sindicato de bancos',
      memo: 'Amortización programada préstamo sindicado',
      source: src('tx-2026-03-28-amort'),
    },
    {
      id: 'tx-2026-03-28-lease-pay',
      date: '2026-03-28',
      category: 'term_amortization',
      amount: 2_800,
      direction: 'outflow',
      counterparty: 'Arrendadores',
      memo: 'Pago de principal de pasivos por arrendamiento del trimestre',
      source: src('tx-2026-03-28-lease-pay'),
    },
    {
      id: 'tx-2026-03-30-int',
      date: '2026-03-30',
      category: 'interest_payment',
      amount: 8_400,
      direction: 'outflow',
      counterparty: 'Sindicato de bancos y arrendadores',
      memo: 'Intereses del trimestre — préstamo sindicado, revolvente y arrendamientos',
      source: src('tx-2026-03-30-int'),
    },
    {
      id: 'tx-2026-03-31-tax',
      date: '2026-03-31',
      category: 'tax_payment',
      amount: 1_003,
      direction: 'outflow',
      counterparty: 'SUNAT',
      memo: 'Pago a cuenta del Impuesto a la Renta',
      source: src('tx-2026-03-31-tax'),
    },
    {
      id: 'tx-2026-03-31-ops',
      date: '2026-03-31',
      category: 'operating_inflow',
      amount: 50_617,
      direction: 'inflow',
      counterparty: 'Clientes / proveedores (agregado)',
      memo: 'Flujo operativo neto del trimestre (agregado de cobranzas y pagos)',
      source: src('tx-2026-03-31-ops'),
    },
  ];
  return entries;
}

/** Ledger rendered as a document so cause citations resolve in the viewer. */
export function renderLedgerDocument(entries: LedgerEntry[]): SourceDocument {
  return {
    id: LEDGER_DOC_ID,
    title: 'Registro de Movimientos de Tesorería (extracto)',
    kind: 'ledger',
    language: 'es',
    sections: entries.map((tx) => ({
      id: tx.id,
      title: `${tx.date} — ${tx.memo}`,
      text: `${tx.date} · ${tx.memo} · Contraparte: ${tx.counterparty} · Monto: S/ ${tx.amount.toLocaleString('en-US')} mil (${tx.direction === 'inflow' ? 'ingreso' : tx.direction === 'outflow' ? 'egreso' : 'no monetario'}) · Categoría: ${tx.category}. DATO ILUSTRATIVO.`,
    })),
  };
}
