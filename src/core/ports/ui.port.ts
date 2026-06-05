/** A branch type prefix. Defaults are feat/fix/hotfix/chore/docs, but the set is
 *  configurable (see config `branchPrefixes`), so this is an open string. */
export type BranchType = string;

export interface IUI {
  intro(title: string): void;
  outro(message: string): void;
  cancel(message: string): void;

  askSelect<T extends string>(message: string, options: { value: T; label: string }[]): Promise<T>;
  askMultiSelect<T extends string>(
    message: string,
    options: { value: T; label: string }[],
  ): Promise<T[]>;
  askSearchSelect<T>(
    message: string,
    options: { value: T; label: string; hints?: string[] }[],
    searchPool?: { value: T; label: string; hints?: string[] }[],
  ): Promise<T>;
  askSearchMultiSelect<T>(
    message: string,
    options: { value: T; label: string; hints?: string[] }[],
  ): Promise<T[]>;
  askText(message: string, placeholder?: string, initialValue?: string): Promise<string>;
  askConfirm(message: string): Promise<boolean>;

  spin<T>(message: string, task: () => Promise<T>, stopMessage?: string): Promise<T>;

  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  info(message: string): void;
  context(message: string): void;
}
