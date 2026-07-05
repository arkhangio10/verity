import type { RunDataset } from '@covenant/core';
import {
  selectRetriever,
  VultrInferenceClient,
  vultrConfigFromEnv,
  type InferenceClient,
  type Retriever,
} from '@covenant/providers';
import { buildDemoDataset } from '@covenant/sample-data';
import { getUploads, mergeUploads } from './uploads';
import { assembleWorkspaceDataset, getWorkspace } from './workspace';

export interface AppRuntime {
  dataset: RunDataset;
  retriever: Retriever;
  retrieverReason: string;
  inference: InferenceClient | null;
  loopMode: 'scripted' | 'model';
  provider: {
    name: string;
    configured: boolean;
    chatModel: string | null;
    embedConfigured: boolean;
  };
}

let cached: Promise<AppRuntime> | null = null;

/** Composition root of the app: demo dataset (through the Peru adapter),
 *  retriever selection (Vultron vs lexical fallback) and the Vultr inference
 *  client from env. Built once per server process; runs share it because all
 *  of it is immutable. */
export function getRuntime(): Promise<AppRuntime> {
  if (!cached) cached = init();
  return cached;
}

async function init(): Promise<AppRuntime> {
  const dataset = await buildDemoDataset();
  const config = vultrConfigFromEnv();
  const client = new VultrInferenceClient(config);
  const inference = client.isConfigured() ? client : null;
  const { retriever, reason } = await selectRetriever(dataset.corpus, inference);
  const loopMode = process.env.AGENT_LOOP_MODE === 'model' ? 'model' : 'scripted';
  return {
    dataset,
    retriever,
    retrieverReason: reason,
    inference,
    loopMode,
    provider: {
      name: inference ? client.providerName : 'offline',
      configured: client.isConfigured(),
      chatModel: client.isConfigured() ? config.chatModel : null,
      embedConfigured: client.isEmbedConfigured(),
    },
  };
}

/** Dataset + retriever for a run. Three cases:
 *  1. companyId points to a user-created workspace → assemble a real dataset
 *     from the uploaded quarters (agent computes on the user's company);
 *  2. base case + session uploads that only add citable documents;
 *  3. pristine base case (common path, reuses the cached base retriever). */
export async function getRunContext(
  sessionId: string,
  companyId?: string,
): Promise<{ dataset: RunDataset; retriever: Retriever; retrieverReason: string }> {
  const app = await getRuntime();

  // Case 1: a user-created company workspace.
  if (companyId && companyId !== 'base') {
    const ws = getWorkspace(sessionId, companyId);
    if (ws) {
      const dataset = await assembleWorkspaceDataset(ws, app.dataset.asOfDate);
      const { retriever, reason } = await selectRetriever(dataset.corpus, app.inference);
      return {
        dataset,
        retriever,
        retrieverReason: `${reason} · empresa creada por el usuario (${ws.name})`,
      };
    }
  }

  // Case 2: base case + citable uploads.
  const uploads = getUploads(sessionId).filter((u) => u.status !== 'failed' && u.document);
  if (uploads.length === 0) {
    return { dataset: app.dataset, retriever: app.retriever, retrieverReason: app.retrieverReason };
  }
  const dataset = mergeUploads(app.dataset, uploads);
  const { retriever, reason } = await selectRetriever(dataset.corpus, app.inference);
  return { dataset, retriever, retrieverReason: `${reason} · incluye ${uploads.length} documento(s) subido(s)` };
}
