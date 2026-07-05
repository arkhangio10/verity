import {
  citedValue,
  moneyUnit,
  PERCENT_UNIT,
  setField,
  type CitedValue,
  type CompanyRef,
  type QuarterFinancials,
  type SourceRef,
} from '@covenant/core';
import type { SmvFilingRecord, SmvStatementRecord } from './smv';
import { isIgnorableTerm, matchTerm, STATEMENT_NAMES } from './terms';

export interface MapOptions {
  targetCurrency?: string;
  fx?: { usdPen: number; source: SourceRef };
}

const QUARTER_END: Record<1 | 2 | 3 | 4, string> = {
  1: '03-31',
  2: '06-30',
  3: '09-30',
  4: '12-31',
};

const REQUIRED_FIELDS = [
  'balance.cashAndEquivalents',
  'balance.currentAssets',
  'balance.currentLiabilities',
  'balance.shortTermBorrowings',
  'balance.currentPortionLongTermDebt',
  'balance.longTermDebt',
  'income.revenue',
  'income.operatingProfit',
  'income.depreciationAmortization',
  'income.interestExpense',
  'income.taxExpense',
  'cashflow.cashTaxesPaid',
  'cashflow.cashInterestPaid',
  'cashflow.capitalExpenditures',
  'cashflow.scheduledPrincipalPayments',
] as const;

function recordSource(filing: SmvFilingRecord, record: SmvStatementRecord): SourceRef {
  const docId = filing.docRef?.docId ?? `smv:${filing.rmvCode}:${filing.anio}-Q${filing.trimestre}`;
  const sectionId = filing.docRef?.sectionByEstado[record.estado] ?? record.estado.toLowerCase();
  return {
    docId,
    docTitle: filing.docRef ? undefined : `SMV ${filing.razonSocial} ${filing.anio}-Q${filing.trimestre}`,
    sectionId,
    sectionTitle: STATEMENT_NAMES[record.estado],
    locator: `${record.cuenta} · ${record.descripcion}`,
    quote: record.descripcion,
  };
}

function notasSource(filing: SmvFilingRecord, locator: string): SourceRef {
  const docId = filing.docRef?.docId ?? `smv:${filing.rmvCode}:${filing.anio}-Q${filing.trimestre}`;
  return {
    docId,
    sectionId: filing.docRef?.notasSectionId ?? 'notas',
    sectionTitle: 'Notas a los Estados Financieros',
    locator,
  };
}

/** Convert one SMV filing into canonical QuarterFinancials with a citation on
 *  every mapped line. Unknown labels become warnings, never silent drops. */
export function mapFilingToQuarter(
  filing: SmvFilingRecord,
  opts: MapOptions = {},
): { quarter: QuarterFinancials; warnings: string[] } {
  const warnings: string[] = [];
  const label = `${filing.anio}-Q${filing.trimestre}`;
  const endDate = `${filing.anio}-${QUARTER_END[filing.trimestre]}`;
  const startMonth = (filing.trimestre - 1) * 3 + 1;
  const startDate = `${filing.anio}-${String(startMonth).padStart(2, '0')}-01`;

  const target = opts.targetCurrency ?? filing.moneda;
  const convert = (value: number): { value: number; derivation?: string } => {
    if (target === filing.moneda) return { value };
    if (!opts.fx) {
      throw new Error(`currency conversion ${filing.moneda}→${target} requested without an FX rate`);
    }
    if (filing.moneda === 'PEN' && target === 'USD') {
      return {
        value: value / opts.fx.usdPen,
        derivation: `converted from PEN at USD/PEN ${opts.fx.usdPen}`,
      };
    }
    if (filing.moneda === 'USD' && target === 'PEN') {
      return {
        value: value * opts.fx.usdPen,
        derivation: `converted from USD at USD/PEN ${opts.fx.usdPen}`,
      };
    }
    throw new Error(`unsupported currency pair ${filing.moneda}→${target}`);
  };
  const unit = moneyUnit(target, filing.escala);

  const quarter: QuarterFinancials = {
    period: { label, startDate, endDate, filedAt: filing.fechaPresentacion },
    currency: target,
    scale: filing.escala,
    income: {},
    balance: {},
    cashflow: {},
  };

  const oneTimeItems: CitedValue[] = [];
  for (const record of filing.registros) {
    if (record.cuenta.startsWith('NR')) {
      const { value, derivation } = convert(record.monto);
      oneTimeItems.push(
        citedValue({
          label: record.descripcion,
          value,
          unit,
          period: label,
          source: notasSource(filing, `${record.cuenta} · ${record.descripcion}`),
          derivation,
        }),
      );
      continue;
    }
    const field = matchTerm(record.descripcion);
    if (!field) {
      if (!isIgnorableTerm(record.descripcion)) {
        warnings.push(`${label}: unmapped line "${record.descripcion}" (${record.cuenta})`);
      }
      continue;
    }
    const { value, derivation } = convert(record.monto);
    setField(
      quarter,
      field,
      citedValue({
        label: record.descripcion,
        value,
        unit,
        period: label,
        source: recordSource(filing, record),
        derivation,
      }),
    );
  }
  if (oneTimeItems.length > 0) quarter.income.oneTimeItems = oneTimeItems;

  const floatingShare = filing.metadatos?.deudaTasaVariablePct;
  if (floatingShare !== undefined) {
    quarter.extras = {
      floatingRateDebtShare: citedValue({
        label: 'Deuda a tasa variable (% de deuda financiera)',
        value: floatingShare,
        unit: PERCENT_UNIT,
        period: label,
        source: notasSource(filing, 'Obligaciones financieras — estructura de tasas'),
      }),
    };
  }

  for (const required of REQUIRED_FIELDS) {
    const [statement, fieldName] = required.split('.') as [string, string];
    const bucket =
      statement === 'balance' ? quarter.balance : statement === 'income' ? quarter.income : quarter.cashflow;
    if ((bucket as Record<string, unknown>)[fieldName] === undefined) {
      warnings.push(`${label}: required field ${required} missing from the filing`);
    }
  }

  return { quarter, warnings };
}

export function companyFromFiling(filing: SmvFilingRecord): CompanyRef {
  return {
    id: filing.rmvCode,
    name: filing.razonSocial,
    countryCode: 'PE',
    ticker: filing.ticker,
    sector: filing.sector,
  };
}
