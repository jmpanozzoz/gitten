import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".gitten.json");

export interface AIConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface GitttenConfig {
  ai?: Partial<AIConfig>;
}

export async function readConfig(): Promise<GitttenConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (!(await file.exists())) return {};
    return (await file.json()) as GitttenConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: GitttenConfig): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function getActiveAIConfig(): Promise<AIConfig | null> {
  const { ai } = await readConfig();
  if (!ai?.enabled || !ai?.baseUrl || !ai?.apiKey || !ai?.model) return null;
  return ai as AIConfig;
}
