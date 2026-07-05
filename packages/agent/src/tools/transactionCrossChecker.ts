import {
  collectSources,
  formatValue,
  moneyUnit,
  PERCENT_UNIT,
  quarterIndex,
  type SourceRef,
} from '@covenant/core';
import { z } from 'zod';
import type { LedgerCategory, LedgerEntry } from '../dataset';
import type { ToolDef, ToolOutcome, ToolServices } from '../toolkit';

const argsSchema = z.object({
  ratio: z.enum(['leverage', 'dscr', 'icr', 'current_ratio', 'fccr']).default('leverage'),
  fromPeriod: z.string().regex(/^\d{4}-Q[1-4]$/),
  toPeriod: z.string().regex(/^\d{4}-Q[1-4]$/),
});

type Args = z.infer<typeof argsSchema>;

export interface CandidateCause {
  rank: number;
  transactionId: string;
  date: string;
  category: LedgerCategory;
  memo: string;
  counterparty: string;
  amount: number;
  amountFactId: string;
  netDebtEffect: number;
  explainedShare: number | null;
  explainedShareFactId?: string;
  narrative: string;
  source: SourceRef;
}

export interface FinancingLink {
  transactionId: string;
  date: string;
  memo: string;
  amount: number;
  amountFactId: string;
  narrative: string;
  source: SourceRef;
}

export interface CrossCheckData {
  ratio: string;
  fromPeriod: string;
  toPeriod: string;
  movement: {
    netDebtDelta: number;
    cashDelta: number;
    totalDebtDelta: number;
    ebitdaLtmDelta: number;
    netDebtDeltaFactId: string;
  };
  causes: CandidateCause[];
  financing: FinancingLink[];
  consistent: boolean;
}

/**
 * Deterministic net-debt attribution of a categorized transaction. This
 * rules table is the heart of the cross-checker: draws and scheduled
 * amortization move cash and debt together (net-debt neutral), while
 * distributions, capex and operating flows move net debt one-for-one.
 */
export function netDebtEffect(entry: LedgerEntry): number {
  switch (entry.category) {
    case 'distribution':
    case 'capex_payment':
    case 'tax_payment':
    case 'interest_payment':
    case 'operating_outflow':
    case 'one_time_cost':
      return entry.amount; // cash out → net debt up
    case 'operating_inflow':
      return -entry.amount; // cash in → net debt down
    case 'lease_addition':
      return entry.amount; // new lease liability, no cash → net debt up
    case 'revolver_draw':
    case 'term_draw':
    case 'term_amortization':
      return 0; // cash and debt move together
    case 'other':
      return entry.direction === 'outflow' ? entry.amount : entry.direction === 'inflow' ? -entry.amount : 0;
  }
}

function periodEndDate(services: ToolServices, label: string): string {
  const q = services.resolver.quarters().find((x) => x.period.label === label);
  if (!q) throw new Error(`quarter ${label} not in dataset`);
  return q.period.endDate;
}

/** transaction_cross_checker(ratio_movement, transactions) → candidate causes
 *  ranked with evidence links. */
export const transactionCrossCheckerTool: ToolDef<Args, CrossCheckData> = {
  name: 'transaction_cross_checker',
  description:
    'Explain a covenant-ratio movement between two quarters by cross-checking the transaction ledger. Decomposes the movement into balance-sheet component deltas, attributes each categorized transaction a deterministic net-debt effect, and returns candidate causes ranked by explained share with links to the ledger entries.',
  paramsJsonSchema: {
    type: 'object',
    properties: {
      ratio: { type: 'string', enum: ['leverage', 'dscr', 'icr', 'current_ratio', 'fccr'] },
      fromPeriod: { type: 'string', description: 'Baseline quarter label, e.g. 2025-Q4.' },
      toPeriod: { type: 'string', description: 'Quarter label of the movement being explained.' },
    },
    required: ['fromPeriod', 'toPeriod'],
  },
  argsSchema,
  async run(args, services: ToolServices): Promise<ToolOutcome<CrossCheckData>> {
    if (quarterIndex(args.toPeriod) <= quarterIndex(args.fromPeriod)) {
      throw new Error('toPeriod must come after fromPeriod');
    }
    const from = services.resolver.at(args.fromPeriod);
    const to = services.resolver.at(args.toPeriod);
    const unit = moneyUnit(to.currency, to.scale);

    const netDebtDelta = to.netDebt.value - from.netDebt.value;
    const cashDelta = to.cash.value - from.cash.value;
    const totalDebtDelta = to.totalDebt.value - from.totalDebt.value;
    const ebitdaLtmDelta = to.ebitda.value - from.ebitda.value;
    const movementSources = [...collectSources(from.netDebt), ...collectSources(to.netDebt)];
    const netDebtDeltaFact = services.facts.addDerived({
      id: `movement:net-debt:${args.fromPeriod}->${args.toPeriod}`,
      label: `Net Debt change ${args.fromPeriod} → ${args.toPeriod}`,
      value: netDebtDelta,
      unit,
      sources: movementSources,
      formula: 'Net Debt (to) − Net Debt (from)',
    });

    const windowStart = periodEndDate(services, args.fromPeriod);
    const windowEnd = periodEndDate(services, args.toPeriod);
    const inWindow = services.dataset.transactions.filter(
      (tx) => tx.date > windowStart && tx.date <= windowEnd,
    );

    const aligned = inWindow
      .map((tx) => ({ tx, effect: netDebtEffect(tx) }))
      .filter(({ effect }) => Math.sign(effect) === Math.sign(netDebtDelta) && effect !== 0)
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    // Shares are measured against the GROSS adverse pressure, not the net
    // delta — a single large outflow can exceed the net movement when
    // operating inflows offset part of it, and shares above 100% mislead.
    const grossAdverse = aligned.reduce((acc, { effect }) => acc + Math.abs(effect), 0);
    const scored = aligned.slice(0, 5);

    const causes: CandidateCause[] = scored.map(({ tx, effect }, i) => {
      const amountFact = services.facts.addValue(
        {
          kind: 'value',
          label: `${categoryLabel(tx.category)} — ${tx.counterparty}`,
          value: tx.amount,
          unit,
          period: args.toPeriod,
          source: tx.source,
        },
        `txn:${tx.id}:amount`,
      );
      const share = grossAdverse > 0 ? Math.abs(effect) / grossAdverse : null;
      let shareFactId: string | undefined;
      if (share !== null) {
        shareFactId = services.facts.addDerived({
          id: `txn:${tx.id}:explained-share`,
          label: `Share of adverse net-debt pressure from ${tx.id}`,
          value: share,
          unit: PERCENT_UNIT,
          sources: [tx.source, ...movementSources],
          formula: 'transaction net-debt effect ÷ gross adverse net-debt pressure in the window',
        }).id;
      }
      return {
        rank: i + 1,
        transactionId: tx.id,
        date: tx.date,
        category: tx.category,
        memo: tx.memo,
        counterparty: tx.counterparty,
        amount: tx.amount,
        amountFactId: amountFact.id,
        netDebtEffect: effect,
        explainedShare: share,
        explainedShareFactId: shareFactId,
        narrative: causeNarrative(tx),
        source: tx.source,
      };
    });

    const financing: FinancingLink[] = inWindow
      .filter((tx) => tx.category === 'revolver_draw' || tx.category === 'term_draw')
      .map((tx) => {
        const amountFact = services.facts.addValue(
          {
            kind: 'value',
            label: `${categoryLabel(tx.category)} — ${tx.counterparty}`,
            value: tx.amount,
            unit,
            period: args.toPeriod,
            source: tx.source,
          },
          `txn:${tx.id}:amount`,
        );
        return {
          transactionId: tx.id,
          date: tx.date,
          memo: tx.memo,
          amount: tx.amount,
          amountFactId: amountFact.id,
          narrative:
            'net-debt neutral on its own (cash and debt rise together), but shows how the outflows were funded',
          source: tx.source,
        };
      });

    const top = causes[0];
    const consistent = top !== undefined && (top.explainedShare ?? 0) >= 0.5;

    const summary = top
      ? `top candidate cause: ${categoryLabel(top.category)} of ${formatValue(top.amount, unit)} on ${top.date} accounts for ${formatValue(top.explainedShare ?? 0, PERCENT_UNIT)} of the adverse net-debt pressure`
      : 'no ledger transaction aligns with the movement direction — cause inconclusive';

    return {
      summary,
      factIds: [
        netDebtDeltaFact.id,
        ...causes.flatMap((c) => [c.amountFactId, ...(c.explainedShareFactId ? [c.explainedShareFactId] : [])]),
        ...financing.map((f) => f.amountFactId),
      ],
      data: {
        ratio: args.ratio,
        fromPeriod: args.fromPeriod,
        toPeriod: args.toPeriod,
        movement: {
          netDebtDelta,
          cashDelta,
          totalDebtDelta,
          ebitdaLtmDelta,
          netDebtDeltaFactId: netDebtDeltaFact.id,
        },
        causes,
        financing,
        consistent,
      },
    };
  },
};

function categoryLabel(category: LedgerCategory): string {
  const labels: Record<LedgerCategory, string> = {
    distribution: 'Distribution to owners',
    revolver_draw: 'Revolver draw',
    term_draw: 'Term loan draw',
    term_amortization: 'Scheduled amortization',
    lease_addition: 'New lease liability',
    capex_payment: 'Capex payment',
    tax_payment: 'Tax payment',
    interest_payment: 'Interest payment',
    operating_inflow: 'Operating inflow',
    operating_outflow: 'Operating outflow',
    one_time_cost: 'One-time cost',
    other: 'Other movement',
  };
  return labels[category];
}

function causeNarrative(tx: LedgerEntry): string {
  switch (tx.category) {
    case 'distribution':
      return 'cash left the company to owners with no offsetting asset, raising net debt one-for-one';
    case 'lease_addition':
      return 'a new lease liability adds to debt under IFRS 16 / NIIF 16 without any cash movement';
    case 'capex_payment':
      return 'investing outflow consumed cash; net debt rises until the asset generates earnings';
    case 'one_time_cost':
      return 'unusual cash cost; also check its EBITDA add-back treatment under the agreement';
    default:
      return 'cash movement with a direct net-debt effect in the movement direction';
  }
}
