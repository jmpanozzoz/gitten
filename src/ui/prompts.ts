import * as clack from "@clack/prompts";
import type { IUI } from "../core/ports/ui.port";
import { GoBackSignal } from "./go-back";
import { searchMultiSelect, searchSelect } from "./search-select";
import { getSpinnerMessages } from "./spinner-vocab";
import { theme } from "./theme";

export class UI implements IUI {
  intro(title: string): void {
    clack.intro(title);
  }

  outro(message: string): void {
    clack.outro(message);
  }

  cancel(message: string): void {
    clack.cancel(message);
  }

  async askSelect<T extends string>(
    message: string,
    options: { value: T; label: string }[],
  ): Promise<T> {
    const result = await clack.select({
      message,
      options: options as unknown as Parameters<typeof clack.select>[0]["options"],
    });
    if (clack.isCancel(result)) throw new GoBackSignal();
    return result as T;
  }

  async askMultiSelect<T extends string>(
    message: string,
    options: { value: T; label: string }[],
  ): Promise<T[]> {
    const result = await clack.multiselect<T>({
      message,
      options: options as unknown as Parameters<typeof clack.multiselect<T>>[0]["options"],
      required: false,
    });
    if (clack.isCancel(result)) throw new GoBackSignal();
    return result as T[];
  }

  async askSearchSelect<T>(
    message: string,
    options: { value: T; label: string; hints?: string[] }[],
    searchPool?: { value: T; label: string; hints?: string[] }[],
  ): Promise<T> {
    return searchSelect(message, options, searchPool);
  }

  async askSearchMultiSelect<T>(
    message: string,
    options: { value: T; label: string; hints?: string[] }[],
  ): Promise<T[]> {
    return searchMultiSelect(message, options);
  }

  async askText(message: string, placeholder?: string, initialValue?: string): Promise<string> {
    const result = await clack.text({ message, placeholder, initialValue });
    if (clack.isCancel(result)) throw new GoBackSignal();
    return result as string;
  }

  async askConfirm(message: string): Promise<boolean> {
    const result = await clack.confirm({ message });
    if (clack.isCancel(result)) throw new GoBackSignal();
    return result as boolean;
  }

  async spin<T>(message: string, task: () => Promise<T>, stopMessage?: string): Promise<T> {
    const spinner = clack.spinner();
    const messages = getSpinnerMessages(message);

    spinner.start(messages[0]);

    let idx = 1;
    const interval = setInterval(() => {
      spinner.message(messages[idx % messages.length]);
      idx++;
    }, 2500);

    try {
      const result = await task();
      clearInterval(interval);
      spinner.stop(stopMessage !== undefined ? stopMessage : theme.success("Done."));
      return result;
    } catch (err) {
      clearInterval(interval);
      spinner.stop(theme.error("Failed."));
      throw err;
    }
  }

  success(message: string): void {
    clack.log.success(theme.success(message));
  }

  warn(message: string): void {
    clack.log.warn(theme.warn(message));
  }

  error(message: string): void {
    clack.log.error(theme.error(message));
  }

  context(message: string): void {
    clack.log.message(message);
  }

  info(message: string): void {
    clack.log.info(theme.info(message));
  }
}
