import { test, expect, mock, describe } from "bun:test";
import { TagWizard } from "../../src/core/tag-wizard";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const FEAT_COMMITS = [
  { hash: "abc1234", message: "feat: add user auth" },
  { hash: "def5678", message: "fix: correct login redirect" },
];
const FIX_ONLY_COMMITS = [{ hash: "abc1234", message: "fix: correct typo" }];
const BREAKING_COMMITS = [{ hash: "abc1234", message: "feat!: redesign API" }];

// ─── version bump inference ───────────────────────────────────────────────────

describe("version bump suggestion", () => {
  test("suggests minor bump when commits include a feat:", async () => {
    const git = createGitMock({
      getLastTag: mock(() => Promise.resolve("v1.2.3")),
      getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v1.3.0")
        .mockResolvedValueOnce("release v1.3.0"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v1.3.0");
  });

  test("suggests patch bump when commits are fix-only", async () => {
    const git = createGitMock({
      getLastTag: mock(() => Promise.resolve("v1.2.3")),
      getLogSince: mock(() => Promise.resolve(FIX_ONLY_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v1.2.4")
        .mockResolvedValueOnce("release v1.2.4"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v1.2.4");
  });

  test("suggests major bump when commits include feat!:", async () => {
    const git = createGitMock({
      getLastTag: mock(() => Promise.resolve("v1.2.3")),
      getLogSince: mock(() => Promise.resolve(BREAKING_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v2.0.0")
        .mockResolvedValueOnce("release v2.0.0"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v2.0.0");
  });

  test("suggests v0.1.0 when no previous tag exists", async () => {
    const git = createGitMock({
      getLastTag: mock(() => Promise.resolve(null)),
      getLog: mock(() => Promise.resolve(FEAT_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v0.1.0")
        .mockResolvedValueOnce("initial release"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v0.1.0");
  });
});

// ─── tag creation ─────────────────────────────────────────────────────────────

test("creates annotated tag with user-provided version and message", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
    createAnnotatedTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askText: mock()
      .mockResolvedValueOnce("v1.1.0")
      .mockResolvedValueOnce("release v1.1.0"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new TagWizard(git, ui).run();

  expect(git.createAnnotatedTag).toHaveBeenCalledWith("v1.1.0", "release v1.1.0");
});

test("pushes tag when user confirms", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
    createAnnotatedTag: mock(() => Promise.resolve()),
    pushTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askText: mock()
      .mockResolvedValueOnce("v1.1.0")
      .mockResolvedValueOnce("release v1.1.0"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new TagWizard(git, ui).run();

  expect(git.pushTag).toHaveBeenCalledWith("v1.1.0");
});

test("skips pushing tag when user declines", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
    createAnnotatedTag: mock(() => Promise.resolve()),
    pushTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askText: mock()
      .mockResolvedValueOnce("v1.1.0")
      .mockResolvedValueOnce("release v1.1.0"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new TagWizard(git, ui).run();

  expect(git.pushTag).not.toHaveBeenCalled();
});

// ─── info display ─────────────────────────────────────────────────────────────

test("shows commit count and last tag in summary before prompting", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
    createAnnotatedTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askText: mock()
      .mockResolvedValueOnce("v1.1.0")
      .mockResolvedValueOnce("release"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new TagWizard(git, ui).run();

  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("v1.0.0"))).toBe(true);
  expect(infoCalls.some((m) => m.includes("2"))).toBe(true);
});

test("aborts when no commits exist since last tag", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve([])),
    createAnnotatedTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock();

  await new TagWizard(git, ui).run();

  expect(git.createAnnotatedTag).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("No new commits"));
});

// ─── validation and error handling ────────────────────────────────────────────

test("shows error and aborts when user enters invalid semver tag name", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
    createAnnotatedTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askText: mock()
      .mockResolvedValueOnce("not-a-version")
      .mockResolvedValueOnce("release"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new TagWizard(git, ui).run();

  expect(git.createAnnotatedTag).not.toHaveBeenCalled();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("not-a-version"));
});

test("shows error and keeps local tag when pushTag fails", async () => {
  const git = createGitMock({
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
    createAnnotatedTag: mock(() => Promise.resolve()),
    pushTag: mock(() => Promise.reject(new Error("Connection refused"))),
  });
  const ui = createUIMock({
    askText: mock()
      .mockResolvedValueOnce("v1.1.0")
      .mockResolvedValueOnce("release v1.1.0"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new TagWizard(git, ui).run();

  expect(git.createAnnotatedTag).toHaveBeenCalledTimes(1);
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("Push failed"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("git push origin v1.1.0"));
});

// ─── package.json version as base ────────────────────────────────────────────

describe("package.json version as base", () => {
  test("uses package.json version as base when available", async () => {
    const git = createGitMock({
      getPackageVersion: mock(() => Promise.resolve("0.8.0")),
      getLastTag: mock(() => Promise.resolve("v0.8.0")),
      getLogSince: mock(() => Promise.resolve(FIX_ONLY_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v0.8.1")
        .mockResolvedValueOnce("release v0.8.1"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v0.8.1");
  });

  test("prefers package.json over git tag when they differ", async () => {
    const git = createGitMock({
      getPackageVersion: mock(() => Promise.resolve("0.8.0")),
      getLastTag: mock(() => Promise.resolve("v0.7.5")),
      getLogSince: mock(() => Promise.resolve(FEAT_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v0.9.0")
        .mockResolvedValueOnce("release"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v0.9.0");
  });

  test("falls back to last tag when package.json has no version", async () => {
    const git = createGitMock({
      getPackageVersion: mock(() => Promise.resolve(null)),
      getLastTag: mock(() => Promise.resolve("v1.0.0")),
      getLogSince: mock(() => Promise.resolve(FIX_ONLY_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v1.0.1")
        .mockResolvedValueOnce("release"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const [, , initialVersion] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
    expect(initialVersion).toBe("v1.0.1");
  });

  test("shows package.json version in info summary", async () => {
    const git = createGitMock({
      getPackageVersion: mock(() => Promise.resolve("0.8.0")),
      getLastTag: mock(() => Promise.resolve("v0.8.0")),
      getLogSince: mock(() => Promise.resolve(FIX_ONLY_COMMITS)),
      createAnnotatedTag: mock(() => Promise.resolve()),
    });
    const ui = createUIMock({
      askText: mock()
        .mockResolvedValueOnce("v0.8.1")
        .mockResolvedValueOnce("release"),
      askConfirm: mock(() => Promise.resolve(false)),
    });

    await new TagWizard(git, ui).run();

    const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
    expect(infoCalls.some((m) => m.includes("package.json") && m.includes("0.8.0"))).toBe(true);
  });
});

// ─── AI release notes ──────────────────────────────────────────────────────────

test("generates release notes with AI and shows them before asking for tag name", async () => {
  const git = createGitMock({
    getPackageVersion: mock(() => Promise.resolve("1.0.0")),
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve([
      { hash: "abc", message: "feat: add dark mode" },
      { hash: "def", message: "fix: crash on startup" },
    ])),
    createAnnotatedTag: mock(() => Promise.resolve()),
  });
  const aiSummarizer = mock(() => Promise.resolve("• Added dark mode\n• Fixed crash on startup"));
  const ui = createUIMock({
    askText: mock(() => Promise.resolve("v1.1.0")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new TagWizard(git, ui, aiSummarizer).run();

  expect(aiSummarizer).toHaveBeenCalledWith(["feat: add dark mode", "fix: crash on startup"]);
  const infoCalls = (ui.info as ReturnType<typeof mock>).mock.calls.map((c) => c[0] as string);
  expect(infoCalls.some((m) => m.includes("What's in this release"))).toBe(true);
});

test("proceeds normally when no aiSummarizer provided", async () => {
  const git = createGitMock({
    getPackageVersion: mock(() => Promise.resolve("1.0.0")),
    getLastTag: mock(() => Promise.resolve("v1.0.0")),
    getLogSince: mock(() => Promise.resolve([{ hash: "abc", message: "feat: something" }])),
    createAnnotatedTag: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askText: mock(() => Promise.resolve("v1.1.0")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new TagWizard(git, ui).run();

  expect(git.createAnnotatedTag).toHaveBeenCalled();
});
