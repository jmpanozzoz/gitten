import type { IUI } from "./ports/ui.port";
import { readConfig, writeConfig } from "../config/config";
import { AI_PROVIDERS } from "../config/providers";
import { testAIConnection } from "./ai-suggester";
import type { AIConfig } from "../config/config";

type SettingsAction = "configure" | "enable" | "disable";

export class Settings {
  constructor(private readonly ui: IUI) {}

  async run(): Promise<void> {
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
        ? { value: "disable" as SettingsAction, label: "○  Disable AI" }
        : { value: "enable"  as SettingsAction, label: "✓  Enable AI" }
      : null;

    const options: { value: SettingsAction; label: string }[] = [
      { value: "configure", label: "✨ Configure AI provider" },
      ...(toggleOption ? [toggleOption] : []),
    ];

    const action = await this.ui.askSelect<SettingsAction>("AI Assistant settings:", options);

    if (action === "disable") return this.disable(config);
    if (action === "enable")  return this.enable(config);
    if (action === "configure") return this.configure(config);
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
