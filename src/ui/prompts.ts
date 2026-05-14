import * as clack from "@clack/prompts";
import { theme } from "./theme";
import type { IUI } from "../core/ports/ui.port";

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
    options: { value: T; label: string }[]
  ): Promise<T> {
    const result = await clack.select({ message, options });
    if (clack.isCancel(result)) {
      clack.cancel("Operation cancelled.");
      process.exit(0);
    }
    return result as T;
  }

  async askMultiSelect<T extends string>(
    message: string,
    options: { value: T; label: string }[]
  ): Promise<T[]> {
    const result = await clack.multiselect<{ value: T; label: string }[], T>({
      message,
      options,
      required: false,
    });
    if (clack.isCancel(result)) {
      clack.cancel("Operation cancelled.");
      process.exit(0);
    }
    return result as T[];
  }

  async askText(message: string, placeholder?: string): Promise<string> {
    const result = await clack.text({ message, placeholder });
    if (clack.isCancel(result)) {
      clack.cancel("Operation cancelled.");
      process.exit(0);
    }
    return result as string;
  }

  async askConfirm(message: string): Promise<boolean> {
    const result = await clack.confirm({ message });
    if (clack.isCancel(result)) {
      clack.cancel("Operation cancelled.");
      process.exit(0);
    }
    return result as boolean;
  }

  async spin<T>(message: string, task: () => Promise<T>): Promise<T> {
    const spinner = clack.spinner();
    spinner.start(message);
    try {
      const result = await task();
      spinner.stop(theme.success("Done."));
      return result;
    } catch (err) {
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

  info(message: string): void {
    clack.log.info(theme.info(message));
  }
}
