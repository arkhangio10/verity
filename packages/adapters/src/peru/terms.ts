import type { CanonicalFieldPath } from '@covenant/core';

/**
 * Peru's SMV filings follow the NIIF (IFRS) taxonomy in Spanish. This table
 * normalizes those labels into the engine's canonical fields. Matching folds
 * diacritics and case so "Situación"/"Situacion" both resolve.
 */
export type Estado = 'ESF' | 'ER' | 'EFE';

export const STATEMENT_NAMES: Record<Estado, string> = {
  ESF: 'Estado de Situación Financiera',
  ER: 'Estado de Resultados',
  EFE: 'Estado de Flujos de Efectivo',
};

export interface TermMapping {
  es: string;
  field: CanonicalFieldPath;
}

export const PERU_TERMS: TermMapping[] = [
  // ── Estado de Situación Financiera (balance sheet) ─────────────────────
  { es: 'Efectivo y Equivalentes al Efectivo', field: 'balance.cashAndEquivalents' },
  { es: 'Cuentas por Cobrar Comerciales', field: 'balance.accountsReceivable' },
  { es: 'Inventarios', field: 'balance.inventory' },
  { es: 'Otros Activos Corrientes', field: 'balance.otherCurrentAssets' },
  { es: 'Total Activos Corrientes', field: 'balance.currentAssets' },
  { es: 'Propiedades, Planta y Equipo', field: 'balance.propertyPlantEquipment' },
  { es: 'Activos por Derecho de Uso', field: 'balance.rightOfUseAssets' },
  { es: 'Otros Activos No Corrientes', field: 'balance.otherNonCurrentAssets' },
  { es: 'Total Activos', field: 'balance.totalAssets' },
  { es: 'Otros Pasivos Financieros Corrientes', field: 'balance.shortTermBorrowings' },
  { es: 'Porción Corriente de Deuda a Largo Plazo', field: 'balance.currentPortionLongTermDebt' },
  { es: 'Pasivos por Arrendamiento Corrientes', field: 'balance.leaseLiabilitiesCurrent' },
  { es: 'Cuentas por Pagar Comerciales', field: 'balance.accountsPayable' },
  { es: 'Otros Pasivos Corrientes', field: 'balance.otherCurrentLiabilities' },
  { es: 'Total Pasivos Corrientes', field: 'balance.currentLiabilities' },
  { es: 'Otros Pasivos Financieros No Corrientes', field: 'balance.longTermDebt' },
  { es: 'Pasivos por Arrendamiento No Corrientes', field: 'balance.leaseLiabilitiesNonCurrent' },
  { es: 'Otros Pasivos No Corrientes', field: 'balance.otherNonCurrentLiabilities' },
  { es: 'Total Pasivos', field: 'balance.totalLiabilities' },
  { es: 'Total Patrimonio', field: 'balance.totalEquity' },
  // ── Estado de Resultados (income statement) ────────────────────────────
  { es: 'Ingresos de Actividades Ordinarias', field: 'income.revenue' },
  { es: 'Ganancia (Pérdida) por Actividades de Operación', field: 'income.operatingProfit' },
  { es: 'Gastos Financieros', field: 'income.interestExpense' },
  { es: 'Gasto por Impuesto a las Ganancias', field: 'income.taxExpense' },
  { es: 'Ganancia (Pérdida) Neta del Ejercicio', field: 'income.netIncome' },
  { es: 'Compensación Basada en Acciones', field: 'income.stockCompensation' },
  // ── Estado de Flujos de Efectivo (cash-flow statement) ─────────────────
  { es: 'Depreciación y Amortización', field: 'income.depreciationAmortization' },
  { es: 'Impuestos a las Ganancias Pagados', field: 'cashflow.cashTaxesPaid' },
  { es: 'Intereses Pagados', field: 'cashflow.cashInterestPaid' },
  { es: 'Compra de Propiedades, Planta y Equipo', field: 'cashflow.capitalExpenditures' },
  { es: 'Adiciones por Arrendamientos (No Efectivo)', field: 'cashflow.leaseFinancedCapex' },
  { es: 'Amortización de Préstamos', field: 'cashflow.scheduledPrincipalPayments' },
  { es: 'Pagos de Pasivos por Arrendamiento', field: 'cashflow.leasePrincipalPayments' },
  { es: 'Dividendos Pagados', field: 'cashflow.distributionsToOwners' },
];

export function foldEs(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const FOLDED_INDEX = new Map(PERU_TERMS.map((m) => [foldEs(m.es), m.field]));
const CANONICAL_INDEX = new Map(PERU_TERMS.map((m) => [m.field, m.es]));

export function matchTerm(labelEs: string): CanonicalFieldPath | null {
  return FOLDED_INDEX.get(foldEs(labelEs)) ?? null;
}

export function canonicalToEs(field: CanonicalFieldPath): string | null {
  return CANONICAL_INDEX.get(field) ?? null;
}

/** Labels we knowingly skip (subtotals & non-engine lines) — not warnings. */
const IGNORABLE = new Set(
  [
    'Ganancia (Pérdida) antes de Impuestos',
    'Costo de Ventas',
    'Ganancia Bruta',
    'Gastos de Venta y Distribución',
    'Gastos de Administración',
    'Ingresos Financieros',
    'Flujo de Efectivo de Actividades de Operación',
    'Flujo de Efectivo de Actividades de Inversión',
    'Flujo de Efectivo de Actividades de Financiación',
    'Aumento (Disminución) Neto de Efectivo',
  ].map(foldEs),
);

export function isIgnorableTerm(labelEs: string): boolean {
  return IGNORABLE.has(foldEs(labelEs));
}
