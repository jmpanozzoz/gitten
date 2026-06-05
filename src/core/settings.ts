import type { AIConfig, GittenConfig } from "../config/config";
import { DEFAULT_LIMITS, getLimits, readGlobalConfig, writeConfig } from "../config/config";
import { AI_PROVIDERS } from "../config/providers";
import { testAIConnection } from "./ai-suggester";
import type { IUI } from "./ports/ui.port";

type SettingsAction = "ai" | "limits";
type AIAction = "configure" | "enable" | "disable";

/** Mask a secret for display: keep a short head/tail, hide the middle. */
function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(Math.max(key.length, 4));
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export class Settings {
  constructor(private readonly ui: IUI) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<SettingsAction>("Settings:", [
      { value: "ai", label: "✨ AI Assistant" },
      { value: "limits", label: "🔢 Limits" },
    ]);

    if (action === "ai") return this.runAI();
    if (action === "limits") return this.runLimits();
  }

  private async runAI(): Promise<void> {
    const config = await readGlobalConfig();
    const ai = config.ai;
    const isEnabled = ai?.enabled ?? false;
    const hasConfig = !!(ai?.baseUrl && ai?.model);

    const providerLabel =
      AI_PROVIDERS.find((p) => p.id === ai?.provider)?.label ?? ai?.baseUrl ?? "—";
    const statusLabel = isEnabled
      ? `✨ AI enabled — ${ai!.model} via ${providerLabel}`
      : hasConfig
        ? `AI disabled (${providerLabel} / ${ai!.model})`
        : "AI not configured";
    this.ui.info(`Current: ${statusLabel}`);

    const toggleOption = hasConfig
      ? isEnabled
        ? { value: "disable" as AIAction, label: "○  Disable AI" }
        : { value: "enable" as AIAction, label: "✓  Enable AI" }
      : null;

    const options: { value: AIAction; label: string }[] = [
      { value: "configure", label: "✨ Configure AI provider" },
      ...(toggleOption ? [toggleOption] : []),
    ];

    const aiAction = await this.ui.askSelect<AIAction>("AI Assistant settings:", options);

    if (aiAction === "disable") return this.disable(config);
    if (aiAction === "enable") return this.enable(config);
    if (aiAction === "configure") return this.configure(config);
  }

  private async runLimits(): Promise<void> {
    const config = await readGlobalConfig();
    const current = getLimits(config);

    this.ui.info(
      `Current limits — undo: ${current.undoCommitLimit}  ·  cherry-pick: ${current.cherryPickLogLimit}  ·  bisect: ${current.bisectLogLimit}  ·  revert: ${current.revertLogLimit}`,
    );

    const parseLimit = (raw: string, fallback: number): number => {
      const n = parseInt(raw, 10);
      return n > 0 && n <= 500 ? n : fallback;
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

    await writeConfig({ ...config, limits });
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

    const provider = AI_PROVIDERS.find((p) => p.id === providerId)!;

    let baseUrl: string;
    if (providerId === "custom") {
      baseUrl = await this.ui.askText("Base URL:", "https://api.example.com/v1", existing?.baseUrl);
    } else {
      baseUrl = provider.baseUrl;
      this.ui.info(`Endpoint: ${baseUrl}`);
    }

    const model = await this.ui.askText(
      "Model:",
      provider.defaultModel || "gpt-4o-mini",
      existing?.provider === providerId ? existing?.model : provider.defaultModel || undefined,
    );

    let apiKey = existing?.apiKey ?? "";
    if (provider.requiresKey) {
      const reusable = !!existing?.apiKey && existing.provider === providerId;
      if (reusable) {
        this.ui.info(`Current key: ${maskKey(existing!.apiKey!)}`);
      }
      // Never pre-fill the secret into the input — show a masked hint instead and
      // keep the stored key when the user leaves it blank.
      const entered = await this.ui.askText(
        reusable ? "API key (leave blank to keep current):" : "API key:",
        "sk-...",
      );
      if (entered.trim()) apiKey = entered.trim();
    }

    const enable = await this.ui.askConfirm("Enable AI suggestions?");

    const savedAi: AIConfig = { provider: providerId, baseUrl, apiKey, model, enabled: enable };
    await writeConfig({ ...config, ai: savedAi });

    this.ui.success(
      enable ? `AI enabled — ${provider.label} / ${model}` : "AI configured but disabled.",
    );

    const shouldTest = await this.ui.askConfirm("Test the connection now?");
    if (shouldTest) {
      try {
        await this.ui.spin("Testing connection...", () => testAIConnection(savedAi));
        this.ui.success("Connection successful!");
      } catch (err) {
        this.ui.warn(`Connection failed: ${err instanceof Error ? err.message : "unknown error"}`);
        this.ui.info("AI was saved but may not work until you fix the error above.");
      }
    }
  }

  private async enable(config: GittenConfig): Promise<void> {
    await writeConfig({ ...config, ai: { ...config.ai, enabled: true } });
    this.ui.success("AI enabled.");
  }

  private async disable(config: GittenConfig): Promise<void> {
    await writeConfig({ ...config, ai: { ...config.ai, enabled: false } });
    this.ui.success("AI disabled.");
  }
}
