/**
 * ILLUSTRATIVE DEMO DATA — "Alimentos Andinos S.A.A." is a fictional Peruvian
 * packaged-foods company. Twelve quarters of drivers are authored below; the
 * builder rolls them into internally consistent statements (balance sheet
 * ties by construction, cash rolls from the cash-flow statement). The SMV
 * fixtures, the rendered filings and the transaction ledger all derive from
 * this single seed, so every citation matches the data.
 *
 * The scenario is tuned so that:
 *  - AFTER mode: leverage headroom is thin at 2026-Q1 and drifting toward a
 *    breach, driven by a large special distribution funded with revolver debt;
 *  - BEFORE mode: quarterly EBITDA is seasonal (CoV ≈ 16%), which triggers
 *    the volatility cushion in the proposal policy.
 */
export interface SeedQuarter {
  label: string;
  filedAt: string;
  revenue: number;
  /** Reported EBITDA (after one-time costs; add-backs restore them). */
  ebitda: number;
  da: number;
  interest: number;
  capexGross: number;
  leaseFinanced: number;
  revolverEnd: number;
  termDraw: number;
  dividends: number;
  dividendDate?: string;
  oneTime?: { label: string; amount: number };
}

export const COMPANY = {
  id: 'B00001',
  rmvCode: 'B00001',
  name: 'Alimentos Andinos S.A.A.',
  ticker: 'ALIANDC1',
  sector: 'Consumo masivo — alimentos procesados',
  countryCode: 'PE',
} as const;

export const DEFAULT_AS_OF = '2026-06-30';

export const SEED_CONSTANTS = {
  taxRate: 0.295,
  termAmortPerQuarter: 6_500,
  leasePrincipalPerQuarter: 2_800,
  currentPortionLtd: 26_000,
  stockCompPerQuarter: 600,
  arOverRevenue: 0.61,
  invOverRevenue: 0.5,
  apOverRevenue: 0.45,
  otherCurrentAssets: 9_000,
  otherCurrentLiabilities: 11_000,
  otherNonCurrentAssets: 25_000,
  otherNonCurrentLiabilities: 18_000,
  floatingRateDebtShare: 0.55,
  opening: {
    revenueT0: 202_000,
    cash: 74_000,
    termLoan: 350_000,
    revolver: 15_000,
    leases: 60_800,
    ppe: 305_000,
    rou: 58_000,
  },
} as const;

export const SEED_QUARTERS: SeedQuarter[] = [
  { label: '2023-Q2', filedAt: '2023-08-14', revenue: 208_000, ebitda: 26_000, da: 9_500, interest: 6_900, capexGross: 8_800, leaseFinanced: 0, revolverEnd: 15_000, termDraw: 0, dividends: 0 },
  { label: '2023-Q3', filedAt: '2023-11-14', revenue: 216_000, ebitda: 27_500, da: 9_550, interest: 6_950, capexGross: 9_000, leaseFinanced: 0, revolverEnd: 15_000, termDraw: 0, dividends: 8_000, dividendDate: '2023-08-25' },
  { label: '2023-Q4', filedAt: '2024-03-01', revenue: 246_000, ebitda: 33_900, da: 9_600, interest: 7_000, capexGross: 9_400, leaseFinanced: 0, revolverEnd: 25_000, termDraw: 0, dividends: 0 },
  { label: '2024-Q1', filedAt: '2024-05-15', revenue: 198_000, ebitda: 21_800, da: 9_700, interest: 7_050, capexGross: 8_600, leaseFinanced: 0, revolverEnd: 15_000, termDraw: 0, dividends: 0 },
  { label: '2024-Q2', filedAt: '2024-08-14', revenue: 221_000, ebitda: 27_600, da: 9_750, interest: 7_100, capexGross: 15_000, leaseFinanced: 6_000, revolverEnd: 15_000, termDraw: 0, dividends: 0 },
  { label: '2024-Q3', filedAt: '2024-11-14', revenue: 229_000, ebitda: 28_900, da: 9_800, interest: 7_150, capexGross: 9_200, leaseFinanced: 0, revolverEnd: 15_000, termDraw: 0, dividends: 9_000, dividendDate: '2024-08-22', oneTime: { label: 'Reestructuración Planta Callao', amount: 2_400 } },
  { label: '2024-Q4', filedAt: '2025-03-01', revenue: 261_000, ebitda: 35_400, da: 9_900, interest: 7_400, capexGross: 36_000, leaseFinanced: 0, revolverEnd: 32_000, termDraw: 30_000, dividends: 0 },
  { label: '2025-Q1', filedAt: '2025-05-15', revenue: 209_000, ebitda: 23_200, da: 10_000, interest: 7_600, capexGross: 14_700, leaseFinanced: 5_500, revolverEnd: 22_000, termDraw: 0, dividends: 0 },
  { label: '2025-Q2', filedAt: '2025-08-14', revenue: 233_000, ebitda: 29_300, da: 10_100, interest: 7_650, capexGross: 9_600, leaseFinanced: 0, revolverEnd: 18_000, termDraw: 0, dividends: 0 },
  { label: '2025-Q3', filedAt: '2025-11-14', revenue: 240_000, ebitda: 29_800, da: 10_300, interest: 7_700, capexGross: 9_800, leaseFinanced: 0, revolverEnd: 24_000, termDraw: 0, dividends: 15_000, dividendDate: '2025-08-21' },
  { label: '2025-Q4', filedAt: '2026-03-01', revenue: 273_000, ebitda: 35_900, da: 10_450, interest: 7_800, capexGross: 10_200, leaseFinanced: 0, revolverEnd: 50_000, termDraw: 0, dividends: 20_000, dividendDate: '2025-11-20' },
  { label: '2026-Q1', filedAt: '2026-05-14', revenue: 216_000, ebitda: 22_400, da: 10_600, interest: 8_400, capexGross: 16_300, leaseFinanced: 7_000, revolverEnd: 62_000, termDraw: 0, dividends: 45_000, dividendDate: '2026-02-15', oneTime: { label: 'Costos por disrupción logística (Fenómeno El Niño)', amount: 1_500 } },
];

/** A fully derived quarter: statements tie by construction. */
export interface BuiltQuarter {
  seed: SeedQuarter;
  label: string;
  startDate: string;
  endDate: string;
  filedAt: string;
  // income statement
  revenue: number;
  operatingProfit: number;
  da: number;
  interest: number;
  ebt: number;
  tax: number;
  netIncome: number;
  stockComp: number;
  // cash flow
  deltaWorkingCapital: number;
  cfo: number;
  cfi: number;
  cff: number;
  cashTaxesPaid: number;
  cashInterestPaid: number;
  leasePrincipal: number;
  termAmort: number;
  // balance sheet (end of quarter)
  cash: number;
  ar: number;
  inventory: number;
  ap: number;
  revolver: number;
  cpltd: number;
  ltd: number;
  leasesTotal: number;
  leaseCurrent: number;
  leaseNonCurrent: number;
  ppe: number;
  rou: number;
  equity: number;
  currentAssets: number;
  currentLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
}

const QUARTER_END: Record<string, string> = { Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-31' };

function datesFor(label: string): { startDate: string; endDate: string } {
  const [year, q] = label.split('-') as [string, string];
  const quarter = Number(q.slice(1));
  const startMonth = String((quarter - 1) * 3 + 1).padStart(2, '0');
  return { startDate: `${year}-${startMonth}-01`, endDate: `${year}-${QUARTER_END[q]}` };
}

const round0 = (x: number): number => Math.round(x);

export function buildQuarters(): BuiltQuarter[] {
  const C = SEED_CONSTANTS;
  const built: BuiltQuarter[] = [];

  let cash: number = C.opening.cash;
  let term: number = C.opening.termLoan;
  let leases: number = C.opening.leases;
  let ppe: number = C.opening.ppe;
  let rou: number = C.opening.rou;
  let revolver: number = C.opening.revolver;
  let ar = round0(C.opening.revenueT0 * C.arOverRevenue);
  let inv = round0(C.opening.revenueT0 * C.invOverRevenue);
  let ap = round0(C.opening.revenueT0 * C.apOverRevenue);
  // equity is the opening plug that makes the opening balance sheet tie
  let equity =
    cash + ar + inv + C.otherCurrentAssets + ppe + rou + C.otherNonCurrentAssets -
    (ap + C.otherCurrentLiabilities + revolver + term + leases + C.otherNonCurrentLiabilities);

  const recentLeaseFinanced: number[] = [];

  for (const seed of SEED_QUARTERS) {
    const { startDate, endDate } = datesFor(seed.label);
    const operatingProfit = seed.ebitda - seed.da;
    const ebt = operatingProfit - seed.interest;
    const tax = round0(Math.max(0, ebt * C.taxRate));
    const netIncome = ebt - tax;

    const arNew = round0(seed.revenue * C.arOverRevenue);
    const invNew = round0(seed.revenue * C.invOverRevenue);
    const apNew = round0(seed.revenue * C.apOverRevenue);
    const deltaWorkingCapital = arNew - ar + (invNew - inv) - (apNew - ap);

    // simplification (documented): cash taxes = accrual tax, cash interest =
    // accrual interest, so CFO = NI + D&A − ΔWC and the balance sheet ties.
    const cfo = netIncome + seed.da - deltaWorkingCapital;
    const capexUnfinanced = seed.capexGross - seed.leaseFinanced;
    const cfi = -capexUnfinanced;
    const deltaRevolver = seed.revolverEnd - revolver;
    const cff =
      deltaRevolver + seed.termDraw - C.termAmortPerQuarter - C.leasePrincipalPerQuarter - seed.dividends;

    cash = cash + cfo + cfi + cff;
    term = term - C.termAmortPerQuarter + seed.termDraw;
    leases = leases - C.leasePrincipalPerQuarter + seed.leaseFinanced;
    recentLeaseFinanced.push(seed.leaseFinanced);
    if (recentLeaseFinanced.length > 4) recentLeaseFinanced.shift();
    const leaseCurrent = Math.min(
      leases,
      4 * C.leasePrincipalPerQuarter + 0.2 * recentLeaseFinanced.reduce((a, b) => a + b, 0),
    );
    const rouDep = C.leasePrincipalPerQuarter;
    const ppeDep = seed.da - rouDep;
    ppe = ppe + capexUnfinanced - ppeDep;
    rou = rou + seed.leaseFinanced - rouDep;
    revolver = seed.revolverEnd;
    ar = arNew;
    inv = invNew;
    ap = apNew;
    equity = equity + netIncome - seed.dividends;

    const currentAssets = cash + ar + inv + C.otherCurrentAssets;
    const currentLiabilities = revolver + C.currentPortionLtd + leaseCurrent + ap + C.otherCurrentLiabilities;
    const totalAssets = currentAssets + ppe + rou + C.otherNonCurrentAssets;
    const totalLiabilities =
      currentLiabilities + (term - C.currentPortionLtd) + (leases - leaseCurrent) + C.otherNonCurrentLiabilities;

    built.push({
      seed,
      label: seed.label,
      startDate,
      endDate,
      filedAt: seed.filedAt,
      revenue: seed.revenue,
      operatingProfit,
      da: seed.da,
      interest: seed.interest,
      ebt,
      tax,
      netIncome,
      stockComp: C.stockCompPerQuarter,
      deltaWorkingCapital,
      cfo,
      cfi,
      cff,
      cashTaxesPaid: tax,
      cashInterestPaid: seed.interest,
      leasePrincipal: C.leasePrincipalPerQuarter,
      termAmort: C.termAmortPerQuarter,
      cash,
      ar,
      inventory: inv,
      ap,
      revolver,
      cpltd: C.currentPortionLtd,
      ltd: term - C.currentPortionLtd,
      leasesTotal: leases,
      leaseCurrent,
      leaseNonCurrent: leases - leaseCurrent,
      ppe,
      rou,
      equity,
      currentAssets,
      currentLiabilities,
      totalAssets,
      totalLiabilities,
    });
  }
  return built;
}
