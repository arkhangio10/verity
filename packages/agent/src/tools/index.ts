import type { ToolDef, ToolRegistry } from '../toolkit';
import { covenantProposerTool } from './covenantProposer';
import { documentRetrieverTool } from './documentRetriever';
import { headroomCalculatorTool } from './headroomCalculator';
import { ratioCalculatorTool } from './ratioCalculator';
import { stressTesterTool } from './stressTester';
import { transactionCrossCheckerTool } from './transactionCrossChecker';
import { volatilityAnalyzerTool } from './volatilityAnalyzer';

export function makeToolRegistry(): ToolRegistry {
  const tools: ToolDef<never, unknown>[] = [
    ratioCalculatorTool,
    headroomCalculatorTool,
    volatilityAnalyzerTool,
    stressTesterTool,
    documentRetrieverTool,
    transactionCrossCheckerTool,
    covenantProposerTool,
  ] as unknown as ToolDef<never, unknown>[];
  return new Map(tools.map((t) => [t.name, t]));
}

export { covenantProposerTool } from './covenantProposer';
export { documentRetrieverTool } from './documentRetriever';
export { headroomCalculatorTool } from './headroomCalculator';
export { ratioCalculatorTool } from './ratioCalculator';
export { stressTesterTool } from './stressTester';
export { netDebtEffect, transactionCrossCheckerTool } from './transactionCrossChecker';
export { volatilityAnalyzerTool } from './volatilityAnalyzer';
export type { RatioCalculatorData } from './ratioCalculator';
export type { HeadroomData } from './headroomCalculator';
export type { VolatilityData } from './volatilityAnalyzer';
export type { StressData, StressScenarioSummary } from './stressTester';
export type { DocumentRetrieverData } from './documentRetriever';
export type { CandidateCause, CrossCheckData, FinancingLink } from './transactionCrossChecker';
export type { ProposerData } from './covenantProposer';
