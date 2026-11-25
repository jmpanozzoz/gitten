import * as clack from "@clack/prompts";
import { GoBackSignal } from "../core/domain/navigation";
import type { IUI } from "../core/ports/ui.port";
import { renderDiff } from "./diff-renderer";
import { searchMultiSelect, searchSelect } from "./search-select";
import { terminalText } from "./terminal-text";
import { theme } from "./theme";

export class UI implements IUI {
  intro(title: string): void {
    clack.intro(terminalText(title));
  }

  outro(message: string): void {
    clack.outro(terminalText(message));
  }

  async askSelect<T extends string>(
    message: string,
    options: { value: T; label: string }[],
  ): Promise<T> {
    return terminalPrompt<T>((signal) =>
      clack.select<T>({
        signal,
        message: terminalText(message),
        options: safeLabels(options) as unknown as Parameters<typeof clack.select<T>>[0]["options"],
      }),
    );
  }

  async askMultiSelect<T extends string>(
    message: string,
    options: { value: T; label: string }[],
  ): Promise<T[]> {
    return terminalPrompt<T[]>((signal) =>
      clack.multiselect<T>({
        signal,
        message: terminalText(message),
        options: safeLabels(options) as unknown as Parameters<
          typeof clack.multiselect<T>
        >[0]["options"],
        required: false,
      }),
    );
  }

  async askSearchSelect<T>(
    message: string,
    options: { value: T; label: string; hints?: string[] }[],
    searchPool?: { value: T; label: string; hints?: string[] }[],
  ): Promise<T> {
    return searchSelect(
      terminalText(message),
      safeLabels(options),
      searchPool && safeLabels(searchPool),
    );
  }

  async askSearchMultiSelect<T>(
    message: string,
    options: { value: T; label: string; hints?: string[] }[],
  ): Promise<T[]> {
    return searchMultiSelect(terminalText(message), safeLabels(options));
  }

  async askText(message: string, placeholder?: string, initialValue?: string): Promise<string> {
    return terminalPrompt<string>((signal) =>
      clack.text({
        signal,
        message: terminalText(message),
        placeholder: placeholder === undefined ? undefined : terminalText(placeholder, true),
        initialValue: initialValue === undefined ? undefined : terminalText(initialValue, true),
      }),
    );
  }

  async askSecret(message: string): Promise<string> {
    return terminalPrompt<string>((signal) =>
      clack.password({ message: terminalText(message), signal }),
    );
  }

  async askConfirm(message: string, initialValue = false): Promise<boolean> {
    return terminalPrompt<boolean>((signal) =>
      clack.confirm({
        message: terminalText(message),
        initialValue,
        signal,
      }),
    );
  }

  async waitForConflictResolution(): Promise<boolean | null> {
    const decision = await this.askSelect("Pending Git operation", [
      { value: "leave", label: "Leave pending and return to menu" },
      { value: "continue", label: "Continue the operation" },
      { value: "abort", label: "Abort the operation and discard its conflict resolution" },
    ]);
    if (decision === "leave") return null;
    if (decision === "continue") return true;
    return (await this.askConfirm("Abort the active Git operation?", false)) ? false : null;
  }

  async spin<T>(message: string, task: () => Promise<T>): Promise<T> {
    const spinner = clack.spinner();
    const label = terminalText(message, true).replace(/\.{3}$|…$/, "");
    spinner.start(label);
    try {
      const result = await task();
      spinner.stop(label);
      return result;
    } catch (error) {
      spinner.stop(theme.error(`${label} failed.`));
      throw error;
    }
  }

  success(message: string): void {
    clack.log.success(theme.success(terminalText(message)));
  }

  warn(message: string): void {
    clack.log.warn(theme.warn(terminalText(message)));
  }

  error(message: string): void {
    clack.log.error(theme.error(terminalText(message)));
  }

  context(message: string): void {
    clack.log.message(terminalText(message));
  }

  info(message: string): void {
    clack.log.info(theme.info(terminalText(message)));
  }

  showDiff(diff: string, maxLines?: number): void {
    clack.log.info(renderDiff(terminalText(diff), maxLines));
  }
}

async function terminalPrompt<T>(ask: (signal: AbortSignal) => Promise<T | symbol>): Promise<T> {
  const abort = new AbortController();
  const input = process.stdin;
  const cancel = () => abort.abort();
  const onKey = (character: string) => {
    if (character === "\x04") cancel();
  };
  input.on("keypress", onKey);
  input.once("end", cancel);
  try {
    const result = await ask(abort.signal);
    if (clack.isCancel(result)) throw new GoBackSignal();
    return result;
  } finally {
    input.removeListener("keypress", onKey);
    input.removeListener("end", cancel);
  }
}

function safeLabels<T extends { label: string }>(options: readonly T[]): T[] {
  return options.map((option) => ({ ...option, label: terminalText(option.label, true) }));
}
