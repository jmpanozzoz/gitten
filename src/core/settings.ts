import type { IUI } from "./ports/ui.port";
import { readConfig, writeConfig, getLimits, DEFAULT_LIMITS } from "../config/config";
import { AI_PROVIDERS } from "../config/providers";
import { testAIConnection } from "./ai-suggester";
import type { AIConfig } from "../config/config";

type SettingsAction = "ai" | "limits";
type AIAction = "configure" | "enable" | "disable";

export class Settings {
  constructor(private readonly ui: IUI) {}

  async run(): Promise<void> {
    const action = await this.ui.askSelect<SettingsAction>("Settings:", [
      { value: "ai",     label: "✨ AI Assistant" },
      { value: "limits", label: "🔢 Limits" },
    ]);

    if (action === "ai")     return this.runAI();
    if (action === "limits") return this.runLimits();
  }

  private async runAI(): Promise<void> {
    const config = await readConfig();
    const ai = config.ai;
    const isEnabled = ai?.enabled ?? false;
    const hasConfig = !!(ai?.baseUrl && ai?.model);

    const providerLabel = AI_PROVIDERS.find((p) => p.id === ai?.provider)?.label ?? ai?.baseUrl ?? "—";
    const statusLabel = isEnabled
      ? `✨ AI enabled — ${ai!.model} via ${providerLabel}`
      : hasConfig
        ? `AI disabled (${providerLabel} / ${ai!.model})`
        : "AI not configured";
    this.ui.info(`Current: ${statusLabel}`);

    const toggleOption = hasConfig
      ? isEnabled
        ? { value: "disable" as AIAction, label: "○  Disable AI" }
        : { value: "enable"  as AIAction, label: "✓  Enable AI" }
      : null;

    const options: { value: AIAction; label: string }[] = [
      { value: "configure", label: "✨ Configure AI provider" },
      ...(toggleOption ? [toggleOption] : []),
    ];

    const aiAction = await this.ui.askSelect<AIAction>("AI Assistant settings:", options);

    if (aiAction === "disable")   return this.disable(config);
    if (aiAction === "enable")    return this.enable(config);
    if (aiAction === "configure") return this.configure(config);
  }

  private async runLimits(): Promise<void> {
    const config = await readConfig();
    const current = getLimits(config);

    this.ui.info(
      `Current limits — undo: ${current.undoCommitLimit}  ·  cherry-pick: ${current.cherryPickLogLimit}  ·  bisect: ${current.bisectLogLimit}`
    );

    const parseLimit = (raw: string, fallback: number): number => {
      const n = parseInt(raw, 10);
      return n > 0 && n <= 500 ? n : fallback;
    };

    const undoRaw = await this.ui.askText(
      "Undo commit history depth:",
      String(DEFAULT_LIMITS.undoCommitLimit),
      String(current.undoCommitLimit)
    );
    const cherryRaw = await this.ui.askText(
      "Cherry-pick commit history depth:",
      String(DEFAULT_LIMITS.cherryPickLogLimit),
      String(current.cherryPickLogLimit)
    );
    const bisectRaw = await this.ui.askText(
      "Bisect commit history depth:",
      String(DEFAULT_LIMITS.bisectLogLimit),
      String(current.bisectLogLimit)
    );

    const limits = {
      undoCommitLimit:    parseLimit(undoRaw,    current.undoCommitLimit),
      cherryPickLogLimit: parseLimit(cherryRaw,  current.cherryPickLogLimit),
      bisectLogLimit:     parseLimit(bisectRaw,  current.bisectLogLimit),
    };

    await writeConfig({ ...config, limits });
    this.ui.success(
      `Limits saved — undo: ${limits.undoCommitLimit}  ·  cherry-pick: ${limits.cherryPickLogLimit}  ·  bisect: ${limits.bisectLogLimit}`
    );
  }

  private async configure(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
    const existing = config.ai;

    const providerId = await this.ui.askSelect<string>(
      "AI provider:",
      AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))
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
      existing?.provider === providerId ? existing?.model : provider.defaultModel || undefined
    );

    let apiKey = existing?.apiKey ?? "";
    if (provider.requiresKey) {
      apiKey = await this.ui.askText("API key:", "sk-...", existing?.apiKey);
    }

    const enable = await this.ui.askConfirm("Enable AI suggestions?");

    const savedAi: AIConfig = { provider: providerId, baseUrl, apiKey, model, enabled: enable };
    await writeConfig({ ...config, ai: savedAi });

    this.ui.success(enable ? `AI enabled — ${provider.label} / ${model}` : "AI configured but disabled.");

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

  private async enable(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
    await writeConfig({ ...config, ai: { ...config.ai, enabled: true } });
    this.ui.success("AI enabled.");
  }

  private async disable(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
    await writeConfig({ ...config, ai: { ...config.ai, enabled: false } });
    this.ui.success("AI disabled.");
  }
}
