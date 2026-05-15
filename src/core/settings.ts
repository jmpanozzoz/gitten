import type { IUI } from "./ports/ui.port";
import { readConfig, writeConfig } from "../config/config";

type SettingsAction = "configure" | "enable" | "disable";

export class Settings {
  constructor(private readonly ui: IUI) {}

  async run(): Promise<void> {
    const config = await readConfig();
    const ai = config.ai;
    const isEnabled = ai?.enabled ?? false;
    const hasConfig = !!(ai?.baseUrl && ai?.apiKey && ai?.model);

    const statusLabel = isEnabled
      ? `AI enabled — ${ai!.model} @ ${ai!.baseUrl}`
      : "AI disabled";
    this.ui.info(`Current: ${statusLabel}`);

    const toggleOption = hasConfig
      ? isEnabled
        ? { value: "disable" as SettingsAction, label: "○  Disable AI" }
        : { value: "enable"  as SettingsAction, label: "✓  Enable AI" }
      : null;

    const options: { value: SettingsAction; label: string }[] = [
      { value: "configure", label: "✨ Configure AI (base URL, API key, model)" },
      ...(toggleOption ? [toggleOption] : []),
    ];

    const action = await this.ui.askSelect<SettingsAction>("AI Assistant settings:", options);

    if (action === "disable") return this.disable(config);
    if (action === "enable")  return this.enable(config);
    if (action === "configure") return this.configure(config);
  }

  private async configure(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
    const existing = config.ai;

    const baseUrl = await this.ui.askText(
      "Base URL:",
      "https://api.openai.com/v1",
      existing?.baseUrl
    );
    const apiKey = await this.ui.askText("API key:", "sk-...", existing?.apiKey);
    const model = await this.ui.askText("Model:", "gpt-4o-mini", existing?.model);

    const enable = await this.ui.askConfirm("Enable AI suggestions?");

    await writeConfig({
      ...config,
      ai: { baseUrl, apiKey, model, enabled: enable },
    });

    this.ui.success(enable ? `AI enabled — using ${model}` : "AI configured but disabled.");
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
