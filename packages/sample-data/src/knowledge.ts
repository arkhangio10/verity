import { STANDARD_DEFINITIONS_DOC_ID, type SourceDocument } from '@covenant/core';

/** Rendered copy of the standard definition templates, so template citations
 *  in BEFORE mode resolve to a real document. */
export function renderStandardDefinitionsDocument(): SourceDocument {
  return {
    id: STANDARD_DEFINITIONS_DOC_ID,
    title: 'Standard Definition Templates',
    kind: 'knowledge',
    language: 'en',
    sections: [
      {
        id: 'preamble',
        title: 'About these templates',
        text: 'Default metric definitions used when no executed credit agreement governs (covenant design mode). Each becomes negotiable contract language; executed agreements always override these templates.',
      },
      {
        id: 'ebitda',
        title: 'EBITDA',
        text: 'EBITDA (template): consolidated operating profit plus depreciation and amortization, plus non-cash stock-based compensation. One-time add-backs should be enumerated and capped in documentation.',
      },
      {
        id: 'total-debt',
        title: 'Total Debt',
        text: 'Total Debt (template): all interest-bearing obligations including short-term borrowings, current portion of long-term debt, long-term debt and IFRS 16 / NIIF 16 lease liabilities. Including leases keeps leverage comparable across owned-vs-leased asset strategies.',
      },
      {
        id: 'cash-taxes',
        title: 'Cash Taxes',
        text: 'Cash Taxes (template): income taxes actually paid in cash during the period, per the cash-flow statement.',
      },
      {
        id: 'debt-service',
        title: 'Debt Service',
        text: 'Debt Service (template): cash interest paid plus scheduled principal payments, including lease principal payments, over the trailing twelve months.',
      },
      {
        id: 'capex',
        title: 'Unfinanced Capital Expenditures',
        text: 'Unfinanced Capital Expenditures (template): gross capital expenditures minus amounts financed with leases or purchase-money debt.',
      },
    ],
  };
}

/** Market-conventions note the proposer cites when sizing thresholds. */
export function renderMarketStandardsDocument(): SourceDocument {
  return {
    id: 'market-standards',
    title: 'Market Standards for Covenant Packages',
    kind: 'knowledge',
    language: 'en',
    sections: [
      {
        id: 'conventions',
        title: 'Threshold conventions',
        text: 'Mid-market LatAm term facilities typically covenant net leverage between 3.00x and 4.50x depending on sector cyclicality, with thresholds set in 0.25x steps. Coverage floors (DSCR/FCCR) move in 0.05x steps and rarely sit below 1.00x. Amortizing structures test DSCR; bullet structures test interest coverage instead. ILLUSTRATIVE REFERENCE NOTE FOR DEMONSTRATION.',
      },
      {
        id: 'cushions',
        title: 'Cushion sizing',
        text: 'Covenant cushions should absorb a normal downside quarter without a technical default: common practice sizes the opening threshold to clear the worst plausible stressed level (EBITDA down twenty percent, rates up two hundred basis points) and adds an explicit step when quarterly EBITDA volatility is high (coefficient of variation above roughly twelve percent), testing on a trailing-twelve-month basis to damp seasonality.',
      },
      {
        id: 'stepdowns',
        title: 'Step-downs',
        text: 'Opening leverage caps commonly step down toward the sustainable landing level over four to eight quarters, matching the deleveraging path implied by scheduled amortization.',
      },
      {
        id: 'ifrs16',
        title: 'IFRS 16 / NIIF 16 treatment',
        text: 'Post-IFRS 16, lease liabilities are debt on the balance sheet. Agreements should state explicitly whether lease liabilities count toward Total Debt and whether lease principal counts in Debt Service; silence invites covenant disputes.',
      },
    ],
  };
}
