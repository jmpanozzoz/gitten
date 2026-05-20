import { mock } from "bun:test";
import type { IUI } from "../../src/core/ports/ui.port";

type LooseUI = {
  askSelect(message: string, options: { value: string; label: string }[]): Promise<string>;
  askMultiSelect(message: string, options: { value: string; label: string }[]): Promise<string[]>;
  askSearchSelect(message: string, options: { value: unknown; label: string; hints?: string[] }[], searchPool?: { value: unknown; label: string; hints?: string[] }[]): Promise<unknown>;
  askSearchMultiSelect(message: string, options: { value: unknown; label: string; hints?: string[] }[]): Promise<unknown[]>;
};

type IUIMockOverrides = Partial<Omit<IUI, keyof LooseUI> & LooseUI>;

export function createUIMock(overrides: IUIMockOverrides = {}): IUI {
  return {
    intro: mock(() => {}),
    outro: mock(() => {}),
    cancel: mock(() => {}),
    askSelect: mock(() => Promise.resolve("" as never)),
    askMultiSelect: mock(() => Promise.resolve([])),
    askSearchSelect: mock(() => Promise.resolve("" as never)),
    askSearchMultiSelect: mock(() => Promise.resolve([])),
    askText: mock(() => Promise.resolve("")),
    askConfirm: mock(() => Promise.resolve(false)),
    spin: mock((_msg: string, task: () => Promise<unknown>) => task()) as IUI["spin"],
    success: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    context: mock(() => {}),
    ...overrides,
  } as IUI;
}
