import type { RunDataset } from '@covenant/core';
import {
  selectRetriever,
  VultrInferenceClient,
  vultrConfigFromEnv,
  type InferenceClient,
  type Retriever,
} from '@covenant/providers';
import { buildDemoDataset } from '@covenant/sample-data';

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
