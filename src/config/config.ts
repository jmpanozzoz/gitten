import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".gitten.json");

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
}

export const DEFAULT_LIMITS: LimitsConfig = {
  undoCommitLimit: 10,
  cherryPickLogLimit: 30,
  bisectLogLimit: 30,
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
}

export async function getActiveAIConfig(): Promise<AIConfig | null> {
  const { ai } = await readConfig();
  if (!ai?.enabled || !ai?.baseUrl || !ai?.model) return null;
  return { provider: "custom", ...ai } as AIConfig;
}
