import { test, expect, mock } from "bun:test";
import { CherryPicker } from "../../src/core/cherry-picker";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const COMMITS = [
  { hash: "abc1234", message: "feat: add login" },
  { hash: "def5678", message: "fix: typo in header" },
];

test("shows info when there are no other branches", async () => {
  const git = createGitMock({
    getBranches: mock(() => Promise.resolve({ all: ["main"], current: "main" })),
  });
  const ui = createUIMock();

  await new CherryPicker(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("shows info when selected branch has no commits", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat/other" as never)),
  });

  await new CherryPicker(git, ui).run();

  expect(ui.info).toHaveBeenCalled();
  expect(git.cherryPick).not.toHaveBeenCalled();
});

test("excludes current branch from source branch list", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/a", "feat/b"], current: "feat/a" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });

  const askSelect = mock()
    .mockResolvedValueOnce("main")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSelect });

  await new CherryPicker(git, ui).run();

  const firstCallOptions = (askSelect.mock.calls[0] as unknown[])[1] as { value: string }[];
  expect(firstCallOptions.map((o) => o.value)).not.toContain("feat/a");
  expect(firstCallOptions.map((o) => o.value)).toContain("main");
  expect(firstCallOptions.map((o) => o.value)).toContain("feat/b");
});

test("calls cherryPick with the selected commit hash", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.resolve()),
  });
  const askSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("def5678");
  const ui = createUIMock({ askSelect });

  await new CherryPicker(git, ui).run();

  expect(git.cherryPick).toHaveBeenCalledTimes(1);
  expect(git.cherryPick).toHaveBeenCalledWith("def5678");
});

test("on conflict + ENTER: calls cherryPickContinue", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    cherryPickContinue: mock(() => Promise.resolve()),
  });
  const askSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSelect });
  const waitForResolution = mock(() => Promise.resolve(true));

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPickContinue).toHaveBeenCalledTimes(1);
  expect(git.cherryPickAbort).not.toHaveBeenCalled();
});

test("on conflict + ESC: calls cherryPickAbort", async () => {
  const git = createGitMock({
    getBranches: mock(() =>
      Promise.resolve({ all: ["main", "feat/other"], current: "main" })
    ),
    getLog: mock(() => Promise.resolve(COMMITS)),
    cherryPick: mock(() => Promise.reject(new Error("conflict"))),
    cherryPickAbort: mock(() => Promise.resolve()),
  });
  const askSelect = mock()
    .mockResolvedValueOnce("feat/other")
    .mockResolvedValueOnce("abc1234");
  const ui = createUIMock({ askSelect });
  const waitForResolution = mock(() => Promise.resolve(false));

  await new CherryPicker(git, ui, waitForResolution).run();

  expect(git.cherryPickAbort).toHaveBeenCalledTimes(1);
  expect(git.cherryPickContinue).not.toHaveBeenCalled();
});
