import { GoBackSignal } from "./domain/navigation";
import type { IUI } from "./ports/ui.port";

const linesPerPage = 40;

export async function showDiffPages(ui: IUI, diff: string): Promise<void> {
  const lines = diff.replace(/\n$/, "").split("\n");
  const count = Math.ceil(lines.length / linesPerPage);
  if (count <= 1) {
    ui.showDiff(diff);
    return;
  }

  type Navigation = "back" | "previous" | "next";
  let page = 1;
  try {
    while (true) {
      ui.info(`Diff page ${page} of ${count}`);
      ui.showDiff(lines.slice((page - 1) * linesPerPage, page * linesPerPage).join("\n"));
      const options: { value: Navigation; label: string }[] = [{ value: "back", label: "Back" }];
      if (page < count) options.push({ value: "next", label: "Next page" });
      if (page > 1) options.push({ value: "previous", label: "Previous page" });
      const command = await ui.askSelect("Browse diff:", options);
      if (command === "back") return;
      page += command === "next" ? 1 : -1;
    }
  } catch (error) {
    if (!(error instanceof GoBackSignal)) throw error;
  }
}
