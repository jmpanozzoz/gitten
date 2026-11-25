import type { AIDestination } from "./ports/ai.port";
import type { IUI } from "./ports/ui.port";

export async function confirmAISend(
  ui: IUI,
  data: string,
  service: AIDestination,
): Promise<boolean> {
  const provider = service.destination ?? "the configured AI provider";
  try {
    return await ui.askConfirm(`Send ${data} to ${provider}?`, false);
  } catch (error) {
    if (error instanceof GoBackSignal) return false;
    throw error;
  }
}

import { GoBackSignal } from "./domain/navigation";
