import { confirmAISend } from "./ai-consent";
import type { AICommitExplainer } from "./ports/ai.port";
import type { IUI } from "./ports/ui.port";

export async function explainDiff(
  ui: IUI,
  readDiff: () => Promise<string>,
  data: string,
  explain?: AICommitExplainer,
): Promise<void> {
  if (!explain || !(await confirmAISend(ui, data, explain))) return;
  try {
    const diff = await readDiff();
    if (!diff) return;
    const explanation = await ui.spin("Analyzing diff...", () => explain(diff));
    if (explanation) ui.info(`✨ ${explanation}`);
  } catch {
    // Explanation remains optional even if the provider or diff fails.
  }
}
