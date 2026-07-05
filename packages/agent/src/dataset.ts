export type {
  AdapterInfo,
  AgreementInfo,
  FreshnessInfo,
  LedgerCategory,
  LedgerEntry,
  RunDataset,
} from '@covenant/core';

export type AgentMode = 'before' | 'after';

export const MODE_LABELS: Record<AgentMode, string> = {
  before: 'Design covenants (BEFORE)',
  after: 'Monitor covenants (AFTER)',
};
