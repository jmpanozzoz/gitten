import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeAIBaseUrl } from "../core/domain/ai-endpoint";
import { AI_PROVIDERS } from "../core/domain/ai-providers";
import {
  type AIConfig,
  DEFAULT_LIMITS,
  type GittenConfig,
  type LimitsConfig,
  mergeConfig,
  type RepoConfig,
} from "../core/domain/preferences";

/** Read the global config from ~/.gitten.json — the editable, app-written file. */
export async function readGlobalConfig(): Promise<GittenConfig> {
  const source = await readObject(join(homedir(), ".gitten.json"));
  const config: GittenConfig = parseRepoConfig(source);
  const ai = parseAIConfig(source.ai);
  if (ai) config.ai = ai;

  const profiles = Object.entries(asRecord(source.aiProfiles)).flatMap(([name, value]) => {
    const profile = parseAIConfig(value);
    return profile ? [[name, profile] as const] : [];
  });
  if (profiles.length > 0) {
    config.aiProfiles = Object.fromEntries(profiles);
  }
  return config;
}

export async function readConfig(repositoryRoot = process.cwd()): Promise<GittenConfig> {
  const [global, repo] = await Promise.all([readGlobalConfig(), readRepoConfig(repositoryRoot)]);
  return mergeConfig(global, repo);
}

export async function readRepoConfig(repositoryRoot: string): Promise<RepoConfig> {
  return parseRepoConfig(await readObject(join(repositoryRoot, ".gittenrc")));
}

export async function writeConfig(config: GittenConfig): Promise<void> {
  const home = homedir();
  const temporary = await mkdtemp(join(home, ".gitten-config-"));
  const candidate = join(temporary, "config.json");
  try {
    await writeFile(candidate, JSON.stringify(config, null, 2), { flag: "wx", mode: 0o600 });
    await rename(candidate, join(home, ".gitten.json"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function getActiveAIConfig(): Promise<AIConfig | null> {
  const { ai } = await readGlobalConfig();
  return ai?.enabled === true ? resolveAIConnection(ai) : null;
}

/** An environment credential is scoped to the same provider and endpoint as a stored key. */
export function resolveAIConnection(config: Partial<AIConfig>): AIConfig | null {
  const connection = parseAIConfig(config);
  if (!connection) return null;

  const provider = AI_PROVIDERS.find(({ id }) => id === connection.provider);
  if (provider?.requiresKey === false) return { ...connection, apiKey: "" };

  const { GITTEN_AI_API_KEY, GITTEN_AI_BASE_URL, GITTEN_AI_PROVIDER } = process.env;
  const useEnvironmentKey =
    GITTEN_AI_API_KEY &&
    GITTEN_AI_PROVIDER === connection.provider &&
    normalizeAIBaseUrl(GITTEN_AI_BASE_URL ?? "") === connection.baseUrl;
  return { ...connection, apiKey: useEnvironmentKey ? GITTEN_AI_API_KEY : connection.apiKey };
}

function parseAIConfig(value: unknown): AIConfig | null {
  const { enabled, provider, baseUrl, apiKey, model } = asRecord(value);
  if (typeof baseUrl !== "string" || typeof model !== "string" || !model.trim()) return null;
  const endpoint = normalizeAIBaseUrl(baseUrl);
  if (!endpoint) return null;

  return {
    enabled: enabled === true,
    provider: typeof provider === "string" && provider ? provider : "custom",
    baseUrl: endpoint,
    apiKey: typeof apiKey === "string" ? apiKey : "",
    model: model.trim(),
  };
}

function parseRepoConfig(source: Record<string, unknown>): RepoConfig {
  const config: RepoConfig = {};
  const limits = asRecord(source.limits);
  const validLimits: Partial<LimitsConfig> = {};
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof LimitsConfig)[]) {
    const limit = limits[key];
    if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 500) {
      validLimits[key] = limit;
    }
  }
  if (Object.keys(validLimits).length > 0) config.limits = validLimits;
  if (isBranchPrefixList(source.branchPrefixes)) config.branchPrefixes = source.branchPrefixes;
  return config;
}

function isBranchPrefixList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (prefix: unknown) => typeof prefix === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(prefix),
    )
  );
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  try {
    return asRecord(await Bun.file(path).json());
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
