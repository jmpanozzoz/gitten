import { normalizeAIBaseUrl } from "./domain/ai-endpoint";
import { AI_PROVIDERS, type AIProvider } from "./domain/ai-providers";
import {
  type AIConfig,
  DEFAULT_LIMITS,
  type GittenConfig,
  getBranchPrefixes,
  getLimits,
  type LimitsConfig,
  mergeConfig,
  type RepoConfig,
} from "./domain/preferences";
import type { IUI } from "./ports/ui.port";

type SettingsAction = "ai" | "limits" | "effective";
type AIAction = "configure" | "enable" | "disable" | "save" | "switch" | "remove";

interface SettingsDependencies {
  read(): Promise<GittenConfig>;
  readRepository(): Promise<RepoConfig>;
  write(config: GittenConfig): Promise<void>;
  resolveConnection(config: AIConfig): AIConfig | null;
  testConnection(config: AIConfig): Promise<void>;
}

export class Settings {
  constructor(
    private readonly ui: IUI,
    private readonly dependencies: SettingsDependencies,
  ) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<SettingsAction>("Settings:", [
      { value: "ai", label: "✨ AI Assistant" },
      { value: "limits", label: "🔢 User limits" },
      { value: "effective", label: "Effective settings and sources" },
    ]);

    if (action === "ai") return this.runAI();
    if (action === "limits") return this.runLimits();
    if (action === "effective") return this.showEffective();
  }

  private async showEffective(): Promise<void> {
    const [user, repository] = await Promise.all([
      this.dependencies.read(),
      this.dependencies.readRepository(),
    ]);
    this.ui.info(describeEffectivePreferences(user, repository));
  }

  private async runAI(): Promise<void> {
    const config = await this.dependencies.read();
    this.ui.info(`Current: ${describeAI(config)}`);
    const action = await this.ui.askSelect<AIAction>("AI Assistant settings:", aiOptions(config));
    const actions: Record<AIAction, () => Promise<void>> = {
      configure: () => this.configure(config),
      enable: () => this.toggle(config, true),
      disable: () => this.toggle(config, false),
      save: () => this.saveProfile(config),
      switch: () => this.switchProfile(config),
      remove: () => this.removeProfile(config),
    };
    await actions[action]?.();
  }

  private async runLimits(): Promise<void> {
    const config = await this.dependencies.read();
    const current = getLimits(config);

    this.ui.info(
      `User limits (.gittenrc may override) — undo: ${current.undoCommitLimit}  ·  cherry-pick: ${current.cherryPickLogLimit}  ·  bisect: ${current.bisectLogLimit}  ·  revert: ${current.revertLogLimit}`,
    );

    const parseLimit = (raw: string, fallback: number): number => {
      const n = Number(raw);
      return Number.isInteger(n) && n > 0 && n <= 500 ? n : fallback;
    };

    const undoRaw = await this.ui.askText(
      "Undo commit history depth:",
      String(DEFAULT_LIMITS.undoCommitLimit),
      String(current.undoCommitLimit),
    );
    const cherryRaw = await this.ui.askText(
      "Cherry-pick commit history depth:",
      String(DEFAULT_LIMITS.cherryPickLogLimit),
      String(current.cherryPickLogLimit),
    );
    const bisectRaw = await this.ui.askText(
      "Bisect commit history depth:",
      String(DEFAULT_LIMITS.bisectLogLimit),
      String(current.bisectLogLimit),
    );
    const revertRaw = await this.ui.askText(
      "Revert commit history depth:",
      String(DEFAULT_LIMITS.revertLogLimit),
      String(current.revertLogLimit),
    );

    const limits = {
      undoCommitLimit: parseLimit(undoRaw, current.undoCommitLimit),
      cherryPickLogLimit: parseLimit(cherryRaw, current.cherryPickLogLimit),
      bisectLogLimit: parseLimit(bisectRaw, current.bisectLogLimit),
      revertLogLimit: parseLimit(revertRaw, current.revertLogLimit),
    };

    await this.dependencies.write({ ...config, limits });
    this.ui.success(
      `Limits saved — undo: ${limits.undoCommitLimit}  ·  cherry-pick: ${limits.cherryPickLogLimit}  ·  bisect: ${limits.bisectLogLimit}  ·  revert: ${limits.revertLogLimit}`,
    );
  }

  private async configure(config: GittenConfig): Promise<void> {
    const existing = config.ai;

    const providerId = await this.ui.askSelect<string>(
      "AI provider:",
      AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label })),
    );

    const provider = AI_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;
    const baseUrl = await this.promptEndpoint(provider, existing);

    const model = await this.ui.askText(
      "Model:",
      provider.defaultModel || "gpt-4o-mini",
      existing?.provider === providerId ? existing?.model : provider.defaultModel || undefined,
    );

    const apiKey = await this.promptKey(provider, baseUrl, existing);
    const enable = await this.ui.askConfirm("Enable AI suggestions?");

    const savedAi: AIConfig = { provider: providerId, baseUrl, apiKey, model, enabled: enable };
    await this.dependencies.write({ ...config, ai: savedAi });

    this.ui.success(
      enable ? `AI enabled — ${provider.label} / ${model}` : "AI configured but disabled.",
    );

    await this.maybeTestConnection(savedAi);
  }

  private async promptEndpoint(
    provider: AIProvider,
    existing?: Partial<AIConfig>,
  ): Promise<string> {
    if (provider.id !== "custom") {
      this.ui.info(`Endpoint: ${provider.baseUrl}`);
      return provider.baseUrl;
    }
    while (true) {
      const initial = existing?.provider === provider.id ? existing.baseUrl : undefined;
      const input = await this.ui.askText("Base URL:", "https://api.example.com/v1", initial);
      const endpoint = normalizeAIBaseUrl(input);
      if (endpoint) return endpoint;
      this.ui.warn(
        "Enter an HTTPS URL or a local HTTP URL without credentials, query, or fragment.",
      );
    }
  }

  private async promptKey(
    provider: AIProvider,
    endpoint: string,
    existing?: Partial<AIConfig>,
  ): Promise<string> {
    if (!provider.requiresKey) return "";
    const previousKey =
      existing?.provider === provider.id && existing.baseUrl === endpoint
        ? existing.apiKey
        : undefined;
    const entered = await this.ui.askSecret(
      previousKey ? "API key (leave blank to keep current):" : "API key:",
    );
    return entered.trim() || previousKey || "";
  }

  private async maybeTestConnection(config: AIConfig): Promise<void> {
    const shouldTest = await this.ui.askConfirm(`Send a test message to ${config.baseUrl}?`, false);
    if (!shouldTest) return;
    try {
      const connection = this.dependencies.resolveConnection(config);
      if (!connection) throw new Error("Invalid AI connection");
      await this.ui.spin("Testing connection...", () =>
        this.dependencies.testConnection(connection),
      );
      this.ui.success("Connection successful!");
    } catch (err) {
      this.ui.warn(`Connection failed: ${err instanceof Error ? err.message : "unknown error"}`);
      this.ui.info("AI was saved but may not work until you fix the error above.");
    }
  }

  private async toggle(config: GittenConfig, enabled: boolean): Promise<void> {
    await this.dependencies.write({ ...config, ai: { ...config.ai, enabled } });
    this.ui.success(enabled ? "AI enabled." : "AI disabled.");
  }

  private async saveProfile(config: GittenConfig): Promise<void> {
    if (!config.ai?.baseUrl || !config.ai?.model) {
      this.ui.warn("Configure an AI provider before saving it as a profile.");
      return;
    }
    const name = (await this.ui.askText("Profile name:", "work")).trim();
    if (!name) return;
    const profiles = { ...config.aiProfiles, [name]: config.ai as AIConfig };
    await this.dependencies.write({ ...config, aiProfiles: profiles });
    this.ui.success(`Saved profile '${name}'.`);
  }

  private async switchProfile(config: GittenConfig): Promise<void> {
    const profiles = config.aiProfiles ?? {};
    const name = await this.ui.askSelect<string>(
      "Switch to which profile?",
      Object.keys(profiles).map((n) => ({ value: n, label: n })),
    );
    if (!Object.hasOwn(profiles, name)) return;
    const profile = profiles[name]!;
    // The active profile is simply whatever lives in `ai`; switching loads it and turns AI on.
    await this.dependencies.write({ ...config, ai: { ...profile, enabled: true } });
    this.ui.success(`Switched to '${name}' — ${profile.model} via ${profile.provider}.`);
  }

  private async removeProfile(config: GittenConfig): Promise<void> {
    const profiles = { ...(config.aiProfiles ?? {}) };
    const selected = await this.ui.askMultiSelect<string>(
      "Remove which profile(s)?",
      Object.keys(profiles).map((n) => ({ value: n, label: n })),
    );
    if (selected.length === 0) return;
    for (const n of selected) delete profiles[n];
    await this.dependencies.write({ ...config, aiProfiles: profiles });
    this.ui.success(`Removed ${selected.length} profile(s).`);
  }
}

function describeEffectivePreferences(user: GittenConfig, repository: RepoConfig): string {
  const effective = mergeConfig(user, repository);
  const limits = getLimits(effective);
  const names: Record<keyof LimitsConfig, string> = {
    undoCommitLimit: "Undo history",
    cherryPickLogLimit: "Cherry-pick history",
    bisectLogLimit: "Bisect history",
    revertLogLimit: "Revert history",
  };
  const limitsWithSources = (Object.keys(limits) as (keyof LimitsConfig)[]).map((key) => {
    const source = preferenceSource(repository.limits?.[key], user.limits?.[key]);
    return `${names[key]}: ${limits[key]} (${source})`;
  });
  const prefixes = getBranchPrefixes(effective);
  const prefixSource = effective.branchPrefixes?.length
    ? preferenceSource(repository.branchPrefixes, user.branchPrefixes)
    : "built-in default";
  return [
    ...limitsWithSources,
    `Branch prefixes: ${prefixes.join(", ")} (${prefixSource})`,
    `AI connection: ${describeAI(user)} (user configuration)`,
  ].join("\n");
}

function preferenceSource(repository: unknown, user: unknown): string {
  if (repository !== undefined) return ".gittenrc";
  return user === undefined ? "built-in default" : "user configuration";
}

function describeAI(config: GittenConfig): string {
  const count = Object.keys(config.aiProfiles ?? {}).length;
  const suffix = count > 0 ? `  ·  ${count} saved profile(s)` : "";
  const ai = config.ai;
  if (!ai?.baseUrl || !ai.model) return `AI not configured${suffix}`;
  const provider = AI_PROVIDERS.find(({ id }) => id === ai.provider)?.label ?? ai.baseUrl;
  const message = ai.enabled
    ? `✨ AI enabled — ${ai.model} via ${provider}`
    : `AI disabled (${provider} / ${ai.model})`;
  return `${message}${suffix}`;
}

function aiOptions(config: GittenConfig): { value: AIAction; label: string }[] {
  const options: { value: AIAction; label: string }[] = [
    { value: "configure", label: "✨ Configure AI provider" },
  ];
  if (config.ai?.baseUrl && config.ai.model) {
    options.push(
      config.ai.enabled
        ? { value: "disable", label: "○  Disable AI" }
        : { value: "enable", label: "✓  Enable AI" },
    );
    options.push({ value: "save", label: "💾 Save current as profile" });
  }
  if (Object.keys(config.aiProfiles ?? {}).length > 0) {
    options.push(
      { value: "switch", label: "🔀 Switch profile" },
      { value: "remove", label: "🗑️  Remove profile" },
    );
  }
  return options;
}
