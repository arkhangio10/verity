import type { AgreementInfo, SourceDocument, SourceRef } from '@covenant/core';
import { COMPANY } from './seed';

export const AGREEMENT_DOC_ID = 'credit-agreement-2024';
export const AGREEMENT_TITLE = 'Senior Secured Credit Agreement (2024) — ILLUSTRATIVE EXAMPLE';

const clause = (sectionId: string, sectionTitle: string): SourceRef => ({
  docId: AGREEMENT_DOC_ID,
  docTitle: AGREEMENT_TITLE,
  sectionId,
  sectionTitle,
});

/** Exact sentences that must appear verbatim in the rendered agreement —
 *  the agent re-verifies these at run time before trusting the structured
 *  definitions below. */
const QUOTES = {
  ebitda:
    '"Covenant EBITDA" means, for any trailing twelve-month period, consolidated operating profit plus depreciation and amortization, plus (a) non-cash stock-based compensation and (b) unusual or non-recurring costs in an aggregate amount not to exceed S/ 10,000 thousand for such period.',
  debt:
    '"Total Debt" means all interest-bearing obligations of the Borrower, including short-term borrowings, the current portion of long-term debt, long-term debt and lease liabilities recognized under IFRS 16 (NIIF 16).',
  cashTaxes: '"Cash Taxes" means income taxes actually paid in cash during the relevant period.',
  debtService:
    '"Debt Service" means cash interest paid plus scheduled principal payments of Funded Debt, including scheduled principal payments under finance and operating leases.',
  capex:
    '"Unfinanced Capital Expenditures" means capital expenditures other than those financed with the proceeds of leases or purchase-money indebtedness.',
  leverage:
    'The Borrower shall not permit the Net Leverage Ratio, computed as Total Debt minus cash and cash equivalents, divided by Covenant EBITDA for the trailing twelve-month period, to exceed 3.50 to 1.00 as of the last day of any fiscal quarter.',
  dscr:
    'The Borrower shall maintain a Debt Service Coverage Ratio, computed as Covenant EBITDA minus Cash Taxes, divided by Debt Service, of not less than 1.25 to 1.00 for the trailing twelve-month period ending on the last day of any fiscal quarter.',
  current:
    'The Borrower shall maintain a ratio of consolidated current assets to consolidated current liabilities of not less than 1.10 to 1.00 as of the last day of any fiscal quarter.',
} as const;

export function buildAgreementInfo(): AgreementInfo {
  return {
    docId: AGREEMENT_DOC_ID,
    title: AGREEMENT_TITLE,
    signedDate: '2024-08-15',
    covenants: [
      {
        id: 'cov-leverage',
        name: 'Maximum Net Leverage Ratio',
        ratio: 'leverage',
        comparator: 'max',
        threshold: 3.5,
        testBasis: 'ltm',
        frequency: 'quarterly',
        clauseRef: clause('5.1', 'Maximum Net Leverage Ratio'),
        definitionNotes: 'Total Debt includes NIIF 16 lease liabilities; EBITDA per §1.1 with capped add-backs.',
      },
      {
        id: 'cov-dscr',
        name: 'Minimum Debt Service Coverage Ratio',
        ratio: 'dscr',
        comparator: 'min',
        threshold: 1.25,
        testBasis: 'ltm',
        frequency: 'quarterly',
        clauseRef: clause('5.2', 'Minimum Debt Service Coverage Ratio'),
        definitionNotes: 'Debt Service includes lease principal per §1.4 (contract overrides the textbook formula).',
      },
      {
        id: 'cov-current',
        name: 'Minimum Current Ratio',
        ratio: 'current_ratio',
        comparator: 'min',
        threshold: 1.1,
        testBasis: 'point_in_time',
        frequency: 'quarterly',
        clauseRef: clause('5.3', 'Minimum Current Ratio'),
      },
    ],
    definitions: {
      ebitda: {
        name: 'Covenant EBITDA (§1.1)',
        base: 'operatingProfitPlusDA',
        addBacks: [
          {
            key: 'stockCompensation',
            description: 'non-cash stock-based compensation (§1.1(a))',
            clauseRef: clause('1.1', 'Covenant EBITDA'),
          },
          {
            key: 'oneTimeItems',
            description: 'unusual or non-recurring costs (§1.1(b))',
            capPerLtm: 10_000,
            clauseRef: clause('1.1', 'Covenant EBITDA'),
          },
        ],
        clauseRef: clause('1.1', 'Covenant EBITDA'),
      },
      debt: {
        name: 'Total Debt (§1.2)',
        includeShortTermBorrowings: true,
        includeCurrentPortionLongTermDebt: true,
        includeLongTermDebt: true,
        includeLeaseLiabilities: true,
        clauseRef: clause('1.2', 'Total Debt'),
      },
      cashTaxes: { source: 'cashflow.cashTaxesPaid', clauseRef: clause('1.3', 'Cash Taxes') },
      debtService: {
        interestBasis: 'cash',
        includeLeasePrincipal: true,
        clauseRef: clause('1.4', 'Debt Service'),
      },
      capex: { basis: 'unfinanced', clauseRef: clause('1.5', 'Unfinanced Capital Expenditures') },
    },
    verbatimChecks: [
      { subject: 'Covenant EBITDA definition', sectionId: '1.1', quote: QUOTES.ebitda },
      { subject: 'Total Debt definition (incl. NIIF 16 leases)', sectionId: '1.2', quote: QUOTES.debt },
      { subject: 'Debt Service definition (incl. lease principal)', sectionId: '1.4', quote: QUOTES.debtService },
      { subject: 'Leverage covenant clause', sectionId: '5.1', quote: QUOTES.leverage },
      { subject: 'DSCR covenant clause', sectionId: '5.2', quote: QUOTES.dscr },
      { subject: 'Current ratio covenant clause', sectionId: '5.3', quote: QUOTES.current },
    ],
  };
}

export function renderAgreementDocument(): SourceDocument {
  return {
    id: AGREEMENT_DOC_ID,
    title: AGREEMENT_TITLE,
    kind: 'credit_agreement',
    language: 'en',
    date: '2024-08-15',
    sections: [
      {
        id: 'preamble',
        title: 'Preamble',
        text: `SENIOR SECURED CREDIT AGREEMENT dated as of 2024-08-15 among ${COMPANY.name}, as Borrower, the Lenders party hereto, and Banco Continental del Sur, as Administrative Agent, providing for a S/ 320,000 thousand amortizing term facility maturing 2027-08-15 and a S/ 80,000 thousand revolving facility. THIS IS A SYNTHETIC, ILLUSTRATIVE DOCUMENT CREATED FOR A PRODUCT DEMONSTRATION; IT IS NOT A REAL CONTRACT AND HAS NO LEGAL EFFECT.`,
      },
      { id: '1.1', title: 'Covenant EBITDA', text: `Section 1.1. ${QUOTES.ebitda} Add-backs beyond the enumerated items require Required Lender consent.` },
      { id: '1.2', title: 'Total Debt', text: `Section 1.2. ${QUOTES.debt} Obligations owed to wholly-owned subsidiaries are excluded.` },
      { id: '1.3', title: 'Cash Taxes', text: `Section 1.3. ${QUOTES.cashTaxes}` },
      { id: '1.4', title: 'Debt Service', text: `Section 1.4. ${QUOTES.debtService} Voluntary prepayments do not constitute scheduled principal payments.` },
      { id: '1.5', title: 'Unfinanced Capital Expenditures', text: `Section 1.5. ${QUOTES.capex}` },
      { id: '5.1', title: 'Maximum Net Leverage Ratio', text: `Section 5.1. ${QUOTES.leverage}` },
      { id: '5.2', title: 'Minimum Debt Service Coverage Ratio', text: `Section 5.2. ${QUOTES.dscr}` },
      { id: '5.3', title: 'Minimum Current Ratio', text: `Section 5.3. ${QUOTES.current}` },
      {
        id: 'reporting',
        title: 'Section 6 — Reporting',
        text: 'Section 6.1. The Borrower shall deliver quarterly unaudited financial statements within 45 days of each fiscal quarter end and audited annual statements within 90 days of each fiscal year end, in each case accompanied by a compliance certificate setting forth reasonably detailed calculations of the financial covenants in Article 5, certified by a financial officer.',
      },
      {
        id: 'default',
        title: 'Section 7 — Events of Default (extract)',
        text: 'Section 7.1(c). Failure to observe any covenant in Article 5, subject to a cure period of 10 business days for the delivery of a compliance certificate, shall constitute an Event of Default, whereupon the Administrative Agent may, at the direction of the Required Lenders, accelerate the obligations.',
      },
    ],
  };
}
