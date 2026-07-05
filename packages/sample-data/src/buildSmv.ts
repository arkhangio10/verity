import { canonicalToEs } from '@covenant/adapters';
import type { SmvFilingRecord, SmvStatementRecord } from '@covenant/adapters';
import type { CanonicalFieldPath } from '@covenant/core';
import { COMPANY, SEED_CONSTANTS, type BuiltQuarter } from './seed';

/**
 * Render the built quarters as SMV-shaped filing records (Spanish NIIF
 * labels, account codes). The demo then ingests these through the real
 * PeruAdapter mapping pipeline — the same code path a live SMV pull uses.
 */
const LINE: { cuenta: string; field: CanonicalFieldPath; estado: 'ESF' | 'ER' | 'EFE'; pick: (q: BuiltQuarter) => number }[] = [
  { cuenta: '1D0101', estado: 'ESF', field: 'balance.cashAndEquivalents', pick: (q) => q.cash },
  { cuenta: '1D0103', estado: 'ESF', field: 'balance.accountsReceivable', pick: (q) => q.ar },
  { cuenta: '1D0105', estado: 'ESF', field: 'balance.inventory', pick: (q) => q.inventory },
  { cuenta: '1D0109', estado: 'ESF', field: 'balance.otherCurrentAssets', pick: () => SEED_CONSTANTS.otherCurrentAssets },
  { cuenta: '1D01ST', estado: 'ESF', field: 'balance.currentAssets', pick: (q) => q.currentAssets },
  { cuenta: '1D0201', estado: 'ESF', field: 'balance.propertyPlantEquipment', pick: (q) => q.ppe },
  { cuenta: '1D0203', estado: 'ESF', field: 'balance.rightOfUseAssets', pick: (q) => q.rou },
  { cuenta: '1D0209', estado: 'ESF', field: 'balance.otherNonCurrentAssets', pick: () => SEED_CONSTANTS.otherNonCurrentAssets },
  { cuenta: '1D02TT', estado: 'ESF', field: 'balance.totalAssets', pick: (q) => q.totalAssets },
  { cuenta: '1D0301', estado: 'ESF', field: 'balance.shortTermBorrowings', pick: (q) => q.revolver },
  { cuenta: '1D0302', estado: 'ESF', field: 'balance.currentPortionLongTermDebt', pick: (q) => q.cpltd },
  { cuenta: '1D0303', estado: 'ESF', field: 'balance.leaseLiabilitiesCurrent', pick: (q) => q.leaseCurrent },
  { cuenta: '1D0305', estado: 'ESF', field: 'balance.accountsPayable', pick: (q) => q.ap },
  { cuenta: '1D0309', estado: 'ESF', field: 'balance.otherCurrentLiabilities', pick: () => SEED_CONSTANTS.otherCurrentLiabilities },
  { cuenta: '1D03ST', estado: 'ESF', field: 'balance.currentLiabilities', pick: (q) => q.currentLiabilities },
  { cuenta: '1D0401', estado: 'ESF', field: 'balance.longTermDebt', pick: (q) => q.ltd },
  { cuenta: '1D0403', estado: 'ESF', field: 'balance.leaseLiabilitiesNonCurrent', pick: (q) => q.leaseNonCurrent },
  { cuenta: '1D0409', estado: 'ESF', field: 'balance.otherNonCurrentLiabilities', pick: () => SEED_CONSTANTS.otherNonCurrentLiabilities },
  { cuenta: '1D04TT', estado: 'ESF', field: 'balance.totalLiabilities', pick: (q) => q.totalLiabilities },
  { cuenta: '1D05TT', estado: 'ESF', field: 'balance.totalEquity', pick: (q) => q.equity },
  { cuenta: '2D01', estado: 'ER', field: 'income.revenue', pick: (q) => q.revenue },
  { cuenta: '2D05', estado: 'ER', field: 'income.operatingProfit', pick: (q) => q.operatingProfit },
  { cuenta: '2D07', estado: 'ER', field: 'income.interestExpense', pick: (q) => q.interest },
  { cuenta: '2D09', estado: 'ER', field: 'income.taxExpense', pick: (q) => q.tax },
  { cuenta: '2D11', estado: 'ER', field: 'income.netIncome', pick: (q) => q.netIncome },
  { cuenta: '2D13', estado: 'ER', field: 'income.stockCompensation', pick: (q) => q.stockComp },
  { cuenta: '3D02', estado: 'EFE', field: 'income.depreciationAmortization', pick: (q) => q.da },
  { cuenta: '3D10', estado: 'EFE', field: 'cashflow.cashTaxesPaid', pick: (q) => q.cashTaxesPaid },
  { cuenta: '3D11', estado: 'EFE', field: 'cashflow.cashInterestPaid', pick: (q) => q.cashInterestPaid },
  { cuenta: '3D12', estado: 'EFE', field: 'cashflow.capitalExpenditures', pick: (q) => q.seed.capexGross },
  { cuenta: '3D13', estado: 'EFE', field: 'cashflow.scheduledPrincipalPayments', pick: (q) => q.termAmort },
  { cuenta: '3D14', estado: 'EFE', field: 'cashflow.leasePrincipalPayments', pick: (q) => q.leasePrincipal },
];

export function filingDocIdFor(label: string): string {
  return `filing-${label}`;
}

export function buildSmvFilings(quarters: BuiltQuarter[]): SmvFilingRecord[] {
  return quarters.map((q) => {
    const [anio, trimestre] = q.label.split('-Q').map(Number) as [number, number];
    const registros: SmvStatementRecord[] = LINE.map((line) => ({
      estado: line.estado,
      cuenta: line.cuenta,
      descripcion: canonicalToEs(line.field) ?? line.field,
      monto: line.pick(q),
    }));
    if (q.seed.leaseFinanced > 0) {
      registros.push({
        estado: 'EFE',
        cuenta: '3D15',
        descripcion: canonicalToEs('cashflow.leaseFinancedCapex') ?? 'Adiciones por Arrendamientos (No Efectivo)',
        monto: q.seed.leaseFinanced,
      });
    }
    if (q.seed.dividends > 0) {
      registros.push({
        estado: 'EFE',
        cuenta: '3D16',
        descripcion: canonicalToEs('cashflow.distributionsToOwners') ?? 'Dividendos Pagados',
        monto: q.seed.dividends,
      });
    }
    if (q.seed.oneTime) {
      registros.push({
        estado: 'ER',
        cuenta: 'NR-01',
        descripcion: q.seed.oneTime.label,
        monto: q.seed.oneTime.amount,
      });
    }
    return {
      rmvCode: COMPANY.rmvCode,
      razonSocial: COMPANY.name,
      ticker: COMPANY.ticker,
      sector: COMPANY.sector,
      anio,
      trimestre: trimestre as 1 | 2 | 3 | 4,
      moneda: 'PEN',
      escala: 1000,
      fechaPresentacion: q.filedAt,
      registros,
      docRef: {
        docId: filingDocIdFor(q.label),
        sectionByEstado: {
          ESF: 'estado-situacion',
          ER: 'estado-resultados',
          EFE: 'estado-flujos',
        },
        notasSectionId: 'notas',
      },
      metadatos: { deudaTasaVariablePct: SEED_CONSTANTS.floatingRateDebtShare },
    };
  });
}
