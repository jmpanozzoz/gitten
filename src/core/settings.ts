import type { IUI } from "./ports/ui.port";
import { readConfig, writeConfig } from "../config/config";

type SettingsAction = "configure" | "disable";

export class Settings {
  constructor(private readonly ui: IUI) {}

  async run(): Promise<void> {
    const config = await readConfig();
    const ai = config.ai;
    const statusLabel = ai?.enabled
      ? `AI enabled — ${ai.model} @ ${ai.baseUrl}`
      : "AI disabled";

    this.ui.info(`Current: ${statusLabel}`);

    const action = await this.ui.askSelect<SettingsAction>("AI Assistant settings:", [
      { value: "configure", label: "✨ Configure AI (base URL, API key, model)" },
      { value: "disable", label: "○  Disable AI" },
    ]);

    if (action === "disable") return this.disable(config);
    if (action === "configure") return this.configure(config);
  }

  private async configure(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
    const existing = config.ai;

    const baseUrl = await this.ui.askText(
      "Base URL:",
      existing?.baseUrl ?? "https://api.openai.com/v1"
    );
    const apiKey = await this.ui.askText("API key:", existing?.apiKey ?? "sk-...");
    const model = await this.ui.askText("Model:", existing?.model ?? "gpt-4o-mini");

    const enable = await this.ui.askConfirm("Enable AI suggestions?");

    await writeConfig({
      ...config,
      ai: { baseUrl, apiKey, model, enabled: enable },
    });

    this.ui.success(enable ? `AI enabled — using ${model}` : "AI configured but disabled.");
  }

  private async disable(config: Awaited<ReturnType<typeof readConfig>>): Promise<void> {
    await writeConfig({ ...config, ai: { ...config.ai, enabled: false } });
    this.ui.success("AI disabled.");
  }
}
