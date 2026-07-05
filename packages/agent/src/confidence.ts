import type { AgentMode } from './dataset';

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Confidence is calibrated from observable signals, never self-reported by
 * the model, and deliberately categorical — a fake-precise percentage would
 * imply calibration we cannot demonstrate. LOW routes the item to human
 * review instead of auto-publishing.
 */
export interface ConfidenceSignals {
  mode: AgentMode;
  /** Where the governing definitions came from. */
  definitionSource: 'agreement_verbatim' | 'agreement_parsed_llm' | 'default_template';
  /** Was the located clause corroborated (quote found verbatim in the doc)? */
  retrievalCorroborated: boolean | null;
  dataFresh: boolean;
  /** Required inputs that could not be resolved at all. */
  missingInputs: string[];
  /** Optional inputs that defaulted to zero (from ResolvedBundle.missingOptional). */
  derivedFallbacks: string[];
  /** Did independent cross-checks agree (e.g. cause found for the movement)? */
  crossChecksConsistent: boolean | null;
  /** Agreement between multiple LLM drafting samples (0..1), when the LLM drafted. */
  llmSampleAgreement: number | null;
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  justification: string;
  flags: string[];
  signals: ConfidenceSignals;
}

const ORDER: Record<ConfidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function capAt(level: ConfidenceLevel, cap: ConfidenceLevel): ConfidenceLevel {
  return ORDER[level] <= ORDER[cap] ? level : cap;
}

export function minLevel(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return ORDER[a] <= ORDER[b] ? a : b;
}

export function assessConfidence(s: ConfidenceSignals): ConfidenceAssessment {
  let level: ConfidenceLevel = 'HIGH';
  const flags: string[] = [];
  let primaryReason: string | null = null;

  const demote = (to: ConfidenceLevel, flag: string, reason: string) => {
    const next = capAt(level, to);
    if (next !== level || primaryReason === null) {
      if (ORDER[next] < ORDER[level] || primaryReason === null) primaryReason = reason;
      level = next;
    }
    flags.push(flag);
  };

  if (s.missingInputs.length > 0) {
    demote('LOW', 'missing_inputs', `required inputs missing: ${s.missingInputs.join(', ')}`);
  }
  if (s.mode === 'after' && s.definitionSource === 'default_template') {
    demote(
      'LOW',
      'template_definitions_in_monitoring',
      'monitoring must use the executed agreement definitions, but only templates were available',
    );
  }
  if (!s.dataFresh) {
    demote(
      s.derivedFallbacks.length > 0 ? 'LOW' : 'MEDIUM',
      'stale_data',
      'the latest filing is older than the freshness policy allows',
    );
  }
  if (s.definitionSource === 'agreement_parsed_llm') {
    if ((s.llmSampleAgreement ?? 1) < 1) {
      demote('MEDIUM', 'parsed_definition_unstable', 'model-parsed definition varied across samples');
    } else {
      demote('MEDIUM', 'parsed_definition', 'definitions were model-parsed rather than verbatim-verified');
    }
  }
  if (s.retrievalCorroborated === false) {
    demote('MEDIUM', 'clause_not_corroborated', 'the governing clause could not be verbatim-matched in the document');
  }
  if (s.derivedFallbacks.length > 0) {
    demote(
      'MEDIUM',
      'optional_inputs_defaulted',
      `some inputs were not reported and defaulted to zero: ${s.derivedFallbacks.join(', ')}`,
    );
  }
  if (s.crossChecksConsistent === false) {
    demote('MEDIUM', 'cross_check_inconclusive', 'independent cross-checks did not corroborate the finding');
  }
  if (s.llmSampleAgreement !== null && s.llmSampleAgreement < 0.75) {
    demote('MEDIUM', 'draft_samples_diverged', 'drafting samples disagreed on which facts to cite');
  }

  const justification =
    primaryReason ??
    (s.definitionSource === 'agreement_verbatim'
      ? 'definitions located verbatim in the executed agreement; inputs complete and data current'
      : 'inputs complete and data current; standard definition templates apply in design mode');

  return { level, justification, flags, signals: s };
}
