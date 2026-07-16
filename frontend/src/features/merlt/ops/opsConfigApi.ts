import { getMerlt, postMerlt, putMerlt } from '../../../services/merltService';

/** Typed BFF client for the admin runtime-config tuning panel (Loop β ops). */

export type RuntimeConfigKind = 'float' | 'int' | 'bool' | 'enum';

export interface RuntimeConfigItem {
  key: string;
  kind: RuntimeConfigKind;
  value: number | boolean | string;
  default: number | boolean | string;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  choices?: string[] | null;
  description: string;
  requires_restart: boolean;
}

export interface RuntimeConfigResponse {
  params: RuntimeConfigItem[];
}

/** GET /api/merlt/ops/config — current runtime-tunable + engine-state params. */
export function getOpsConfig(): Promise<RuntimeConfigResponse> {
  return getMerlt<RuntimeConfigResponse>('/merlt/ops/config');
}

/** PUT /api/merlt/ops/config/:key — updates a single runtime-tunable param. */
export function setOpsConfig(key: string, value: number | boolean | string): Promise<RuntimeConfigItem> {
  return putMerlt<RuntimeConfigItem>(`/merlt/ops/config/${encodeURIComponent(key)}`, { value });
}

export interface ReinitEngineResponse {
  reinitialized: boolean;
  engine: Record<string, unknown>;
}

/**
 * POST /api/merlt/ops/engine/reinitialize — rebuilds MERL-T's inference engine
 * in-process from the current config (applies construction-time flags —
 * tools/ReAct/neural routing — with no container restart).
 */
export function reinitEngine(): Promise<ReinitEngineResponse> {
  return postMerlt<ReinitEngineResponse>('/merlt/ops/engine/reinitialize');
}
