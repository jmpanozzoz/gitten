import { mock } from "bun:test";
import type { IUI, BranchType } from "../../src/core/ports/ui.port";

export function createUIMock(overrides: Partial<IUI> = {}): IUI {
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
  };
}
