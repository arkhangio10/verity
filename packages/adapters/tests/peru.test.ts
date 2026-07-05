import { describe, expect, it } from 'vitest';
import {
  canonicalToEs,
  foldEs,
  isIgnorableTerm,
  mapFilingToQuarter,
  matchTerm,
  parseFilingTextToRecords,
  PeruAdapter,
  type SmvClient,
  type SmvFilingRecord,
} from '@covenant/adapters';

function sampleFiling(overrides: Partial<SmvFilingRecord> = {}): SmvFilingRecord {
  return {
    rmvCode: 'B00001',
    razonSocial: 'Alimentos Andinos S.A.A.',
    ticker: 'ALIANDC1',
    anio: 2026,
    trimestre: 1,
    moneda: 'PEN',
    escala: 1000,
    fechaPresentacion: '2026-05-14',
    registros: [
      { estado: 'ESF', cuenta: '1D0101', descripcion: 'Efectivo y Equivalentes al Efectivo', monto: 14_000 },
      { estado: 'ESF', cuenta: '1D0T', descripcion: 'Total Activos Corrientes', monto: 262_000 },
      { estado: 'ESF', cuenta: '1DPT', descripcion: 'Total Pasivos Corrientes', monto: 209_000 },
      { estado: 'ESF', cuenta: '1D2001', descripcion: 'Otros Pasivos Financieros Corrientes', monto: 62_000 },
      { estado: 'ESF', cuenta: '1D2002', descripcion: 'Porción Corriente de Deuda a Largo Plazo', monto: 26_000 },
      { estado: 'ESF', cuenta: '1D2101', descripcion: 'Otros Pasivos Financieros No Corrientes', monto: 276_000 },
      { estado: 'ESF', cuenta: '1D2102', descripcion: 'Pasivos por Arrendamiento No Corrientes', monto: 33_100 },
      { estado: 'ESF', cuenta: '1D2003', descripcion: 'Pasivos por Arrendamiento Corrientes', monto: 12_600 },
      { estado: 'ER', cuenta: '2D01', descripcion: 'Ingresos de Actividades Ordinarias', monto: 216_000 },
      { estado: 'ER', cuenta: '2D05', descripcion: 'Ganancia (Pérdida) por Actividades de Operación', monto: 11_800 },
      { estado: 'ER', cuenta: '2D07', descripcion: 'Gastos Financieros', monto: 8_400 },
      { estado: 'ER', cuenta: '2D09', descripcion: 'Gasto por Impuesto a las Ganancias', monto: 1_003 },
      { estado: 'ER', cuenta: 'NR-01', descripcion: 'Costos por disrupción logística (El Niño)', monto: 1_500 },
      { estado: 'EFE', cuenta: '3D02', descripcion: 'Depreciación y Amortización', monto: 10_600 },
      { estado: 'EFE', cuenta: '3D10', descripcion: 'Impuestos a las Ganancias Pagados', monto: 1_003 },
      { estado: 'EFE', cuenta: '3D11', descripcion: 'Intereses Pagados', monto: 8_400 },
      { estado: 'EFE', cuenta: '3D12', descripcion: 'Compra de Propiedades, Planta y Equipo', monto: 16_300 },
      { estado: 'EFE', cuenta: '3D13', descripcion: 'Amortización de Préstamos', monto: 6_500 },
      { estado: 'EFE', cuenta: '3D14', descripcion: 'Dividendos Pagados', monto: 45_000 },
      { estado: 'EFE', cuenta: '3D15', descripcion: 'Línea Misteriosa Sin Mapeo', monto: 123 },
      { estado: 'ER', cuenta: '2D03', descripcion: 'Ganancia Bruta', monto: 60_000 },
    ],
    docRef: {
      docId: 'filing-2026-Q1',
      sectionByEstado: { ESF: 'estado-situacion', ER: 'estado-resultados', EFE: 'estado-flujos' },
      notasSectionId: 'notas',
    },
    metadatos: { deudaTasaVariablePct: 0.55 },
    ...overrides,
  };
}

describe('Peru term normalization', () => {
  it('maps Spanish NIIF labels to canonical fields, diacritics-insensitively', () => {
    expect(matchTerm('Estado nonsense')).toBeNull();
    expect(matchTerm('Efectivo y Equivalentes al Efectivo')).toBe('balance.cashAndEquivalents');
    expect(matchTerm('efectivo y equivalentes al efectivo')).toBe('balance.cashAndEquivalents');
    expect(matchTerm('Ganancia (Perdida) por Actividades de Operacion')).toBe('income.operatingProfit');
    expect(matchTerm('DEPRECIACIÓN Y AMORTIZACIÓN')).toBe('income.depreciationAmortization');
  });

  it('provides the reverse mapping for document rendering', () => {
    expect(canonicalToEs('balance.leaseLiabilitiesNonCurrent')).toBe('Pasivos por Arrendamiento No Corrientes');
  });

  it('knows which subtotal lines are intentionally ignored', () => {
    expect(isIgnorableTerm('Ganancia Bruta')).toBe(true);
    expect(isIgnorableTerm('Línea Misteriosa Sin Mapeo')).toBe(false);
  });

  it('foldEs strips accents and normalizes whitespace', () => {
    expect(foldEs('  Situación   Financiera ')).toBe('situacion financiera');
  });
});

describe('SMV → canonical mapping', () => {
  it('maps a filing into cited canonical fields', () => {
    const { quarter, warnings } = mapFilingToQuarter(sampleFiling());
    expect(quarter.period.label).toBe('2026-Q1');
    expect(quarter.period.filedAt).toBe('2026-05-14');
    expect(quarter.balance.cashAndEquivalents?.value).toBe(14_000);
    expect(quarter.balance.cashAndEquivalents?.source.docId).toBe('filing-2026-Q1');
    expect(quarter.balance.cashAndEquivalents?.source.sectionId).toBe('estado-situacion');
    expect(quarter.balance.cashAndEquivalents?.source.locator).toContain('1D0101');
    expect(quarter.income.operatingProfit?.value).toBe(11_800);
    expect(quarter.cashflow.distributionsToOwners?.value).toBe(45_000);
    // NIIF 16 lease liabilities present for the debt definition
    expect(quarter.balance.leaseLiabilitiesCurrent?.value).toBe(12_600);
    expect(quarter.balance.leaseLiabilitiesNonCurrent?.value).toBe(33_100);
    // one-time item routed from the NR record with a notes citation
    expect(quarter.income.oneTimeItems?.[0]?.label).toContain('disrupción');
    expect(quarter.income.oneTimeItems?.[0]?.source.sectionId).toBe('notas');
    // floating-rate share from the notes metadata
    expect(quarter.extras?.floatingRateDebtShare?.value).toBe(0.55);
    // unmapped non-ignorable line surfaces as a warning; ignorable one does not
    expect(warnings.some((w) => w.includes('Línea Misteriosa'))).toBe(true);
    expect(warnings.some((w) => w.includes('Ganancia Bruta'))).toBe(false);
  });

  it('reports required fields that are missing', () => {
    const filing = sampleFiling();
    filing.registros = filing.registros.filter((r) => r.descripcion !== 'Ingresos de Actividades Ordinarias');
    const { warnings } = mapFilingToQuarter(filing);
    expect(warnings.some((w) => w.includes('income.revenue'))).toBe(true);
  });

  it('converts PEN→USD with a cited FX rate and a derivation note', () => {
    const { quarter } = mapFilingToQuarter(sampleFiling(), {
      targetCurrency: 'USD',
      fx: { usdPen: 3.75, source: { docId: 'bcrp-fx', sectionId: 'tc' } },
    });
    expect(quarter.currency).toBe('USD');
    expect(quarter.balance.cashAndEquivalents?.value).toBeCloseTo(14_000 / 3.75, 6);
    expect(quarter.balance.cashAndEquivalents?.derivation).toContain('USD/PEN 3.75');
  });

  it('refuses conversion without an FX rate', () => {
    expect(() => mapFilingToQuarter(sampleFiling(), { targetCurrency: 'USD' })).toThrowError(/FX rate/);
  });
});

describe('PDF text path', () => {
  const text = `
ALIMENTOS ANDINOS S.A.A.
Estado de Situación Financiera (en miles de soles)
Efectivo y Equivalentes al Efectivo ........ 14,000
Total Activos Corrientes ................... 262,000

Estado de Resultados
Ingresos de Actividades Ordinarias           216,000
Gastos Financieros ......................... (8,400)
`;

  it('parses statement lines under their headers, handling negatives', () => {
    const parsed = parseFilingTextToRecords(text);
    const cash = parsed.records.find((r) => r.descripcion.startsWith('Efectivo'));
    expect(cash?.estado).toBe('ESF');
    expect(cash?.monto).toBe(14_000);
    const interest = parsed.records.find((r) => r.descripcion === 'Gastos Financieros');
    expect(interest?.estado).toBe('ER');
    expect(interest?.monto).toBe(-8_400);
  });

  it('warns when nothing parses (likely a scanned PDF)', () => {
    const parsed = parseFilingTextToRecords('imagen escaneada sin texto');
    expect(parsed.records).toEqual([]);
    expect(parsed.warnings[0]).toMatch(/scanned/);
  });
});

describe('PeruAdapter freshness policy', () => {
  const client: SmvClient = {
    sourceName: 'fixture',
    fetchFilings: async () => [sampleFiling()],
  };
  const adapter = new PeruAdapter({ smvClient: client });

  it('fresh filing within the window', async () => {
    const result = await adapter.fetchStatements({ companyId: 'B00001' });
    const report = adapter.assessFreshness(result.quarters, '2026-06-30');
    expect(report.stale).toBe(false);
    expect(report.ageDays).toBe(47);
    expect(report.latestPeriodEnd).toBe('2026-03-31');
  });

  it('stale when the as-of date runs past the policy window', async () => {
    const result = await adapter.fetchStatements({ companyId: 'B00001' });
    const report = adapter.assessFreshness(result.quarters, '2026-12-31');
    expect(report.stale).toBe(true);
  });
});
