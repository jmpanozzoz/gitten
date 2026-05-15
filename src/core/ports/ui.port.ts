export type BranchType = "feat" | "fix" | "hotfix" | "chore" | "docs";

export interface IUI {
  intro(title: string): void;
  outro(message: string): void;
  cancel(message: string): void;

  askSelect<T extends string>(message: string, options: { value: T; label: string }[]): Promise<T>;
  askMultiSelect<T extends string>(message: string, options: { value: T; label: string }[]): Promise<T[]>;
  askText(message: string, placeholder?: string): Promise<string>;
  askConfirm(message: string): Promise<boolean>;

  spin<T>(message: string, task: () => Promise<T>): Promise<T>;

  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  info(message: string): void;
  context(message: string): void;
}
