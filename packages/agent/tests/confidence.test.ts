import { describe, expect, it } from 'vitest';
import { assessConfidence, minLevel, type ConfidenceSignals } from '@covenant/agent';

const healthy: ConfidenceSignals = {
  mode: 'after',
  definitionSource: 'agreement_verbatim',
  retrievalCorroborated: true,
  dataFresh: true,
  missingInputs: [],
  derivedFallbacks: [],
  crossChecksConsistent: true,
  llmSampleAgreement: null,
};

describe('calibrated categorical confidence', () => {
  it('verbatim definitions + fresh, complete data → HIGH', () => {
    const a = assessConfidence(healthy);
    expect(a.level).toBe('HIGH');
    expect(a.justification).toMatch(/verbatim/);
  });

  it('missing required inputs → LOW (needs human review)', () => {
    const a = assessConfidence({ ...healthy, missingInputs: ['income.operatingProfit'] });
    expect(a.level).toBe('LOW');
    expect(a.justification).toContain('income.operatingProfit');
  });

  it('template definitions in MONITORING mode → LOW', () => {
    const a = assessConfidence({ ...healthy, definitionSource: 'default_template' });
    expect(a.level).toBe('LOW');
    expect(a.flags).toContain('template_definitions_in_monitoring');
  });

  it('template definitions in DESIGN mode are expected → HIGH', () => {
    const a = assessConfidence({
      ...healthy,
      mode: 'before',
      definitionSource: 'default_template',
      retrievalCorroborated: null,
      crossChecksConsistent: null,
    });
    expect(a.level).toBe('HIGH');
  });

  it('stale data caps at MEDIUM; stale + defaulted inputs → LOW', () => {
    expect(assessConfidence({ ...healthy, dataFresh: false }).level).toBe('MEDIUM');
    expect(
      assessConfidence({ ...healthy, dataFresh: false, derivedFallbacks: ['cashflow.leasePrincipalPayments'] })
        .level,
    ).toBe('LOW');
  });

  it('unverified clause quotes cap at MEDIUM', () => {
    const a = assessConfidence({ ...healthy, retrievalCorroborated: false });
    expect(a.level).toBe('MEDIUM');
    expect(a.flags).toContain('clause_not_corroborated');
  });

  it('optional inputs defaulted to zero cap at MEDIUM', () => {
    const a = assessConfidence({ ...healthy, derivedFallbacks: ['extras.floatingRateDebtShare'] });
    expect(a.level).toBe('MEDIUM');
  });

  it('inconsistent cross-checks cap at MEDIUM', () => {
    expect(assessConfidence({ ...healthy, crossChecksConsistent: false }).level).toBe('MEDIUM');
  });

  it('diverging LLM samples cap at MEDIUM; agreeing samples do not', () => {
    expect(assessConfidence({ ...healthy, llmSampleAgreement: 0.5 }).level).toBe('MEDIUM');
    expect(assessConfidence({ ...healthy, llmSampleAgreement: 0.9 }).level).toBe('HIGH');
  });

  it('minLevel picks the weaker level', () => {
    expect(minLevel('HIGH', 'MEDIUM')).toBe('MEDIUM');
    expect(minLevel('LOW', 'HIGH')).toBe('LOW');
  });
});
