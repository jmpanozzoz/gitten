import { chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".gitten.json");

/** Env var that overrides the stored API key at runtime, so the secret never
 *  has to be persisted to disk in CI/shared environments. */
const API_KEY_ENV = "GITTEN_AI_API_KEY";

export interface AIConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LimitsConfig {
  undoCommitLimit: number;
  cherryPickLogLimit: number;
  bisectLogLimit: number;
  revertLogLimit: number;
}

export const DEFAULT_LIMITS: LimitsConfig = {
  undoCommitLimit: 10,
  cherryPickLogLimit: 30,
  bisectLogLimit: 30,
  revertLogLimit: 30,
};

export interface GittenConfig {
  ai?: Partial<AIConfig>;
  limits?: Partial<LimitsConfig>;
}

export function getLimits(config: GittenConfig): LimitsConfig {
  return { ...DEFAULT_LIMITS, ...config.limits };
}

export async function readConfig(): Promise<GittenConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) return {};
    return (await file.json()) as GittenConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: GittenConfig): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
  // The file holds an API key — restrict it to the owner. chmod is a no-op on
  // Windows, so failures are non-fatal.
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // best effort
  }
}

export async function getActiveAIConfig(): Promise<AIConfig | null> {
  const { ai } = await readConfig();
  if (!ai?.enabled || !ai?.baseUrl || !ai?.model) return null;
  const apiKey = process.env[API_KEY_ENV] || ai.apiKey || "";
  return { provider: "custom", ...ai, apiKey } as AIConfig;
}
