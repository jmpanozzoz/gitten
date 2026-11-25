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

/** Branch type prefixes offered by New Branch when none are configured. */
export const DEFAULT_BRANCH_PREFIXES = ["feat", "fix", "hotfix", "chore", "docs"];

export interface RepoConfig {
  limits?: Partial<LimitsConfig>;
  /** Custom branch type prefixes for New Branch (replaces the defaults when set). */
  branchPrefixes?: string[];
}

export interface GittenConfig extends RepoConfig {
  ai?: Partial<AIConfig>;
  aiProfiles?: Record<string, AIConfig>;
}

export function getLimits(config: RepoConfig): LimitsConfig {
  return { ...DEFAULT_LIMITS, ...config.limits };
}

/** Resolve the branch prefixes to offer: configured ones if any, else the defaults. */
export function getBranchPrefixes(config: RepoConfig): string[] {
  return config.branchPrefixes?.length ? config.branchPrefixes : [...DEFAULT_BRANCH_PREFIXES];
}

/** Repositories may override project preferences. Connections belong to the user. */
export function mergeConfig(base: GittenConfig, override: RepoConfig): GittenConfig {
  const merged = { ...base };
  if (base.limits || override.limits) merged.limits = { ...base.limits, ...override.limits };
  const branchPrefixes = override.branchPrefixes ?? base.branchPrefixes;
  if (branchPrefixes) merged.branchPrefixes = branchPrefixes;
  return merged;
}
