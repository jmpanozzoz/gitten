import { test, expect, mock } from "bun:test";
import { RemoteManager } from "../../src/core/remote-manager";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const REMOTES = [
  { name: "origin", url: "https://github.com/user/repo.git" },
  { name: "upstream", url: "https://github.com/original/repo.git" },
];

// ── runInit ────────────────────────────────────────────────────────────────────

test("runInit: initializes repo and skips remote when user declines", async () => {
  const git = createGitMock({
    initRepo: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new RemoteManager(git, ui).runInit();

  expect(git.initRepo).toHaveBeenCalledTimes(1);
  expect(git.addRemote).not.toHaveBeenCalled();
});

test("runInit: initializes repo and adds remote when user confirms", async () => {
  const git = createGitMock({
    initRepo: mock(() => Promise.resolve()),
    addRemote: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock()
      .mockResolvedValueOnce("origin")
      .mockResolvedValueOnce("https://github.com/user/repo.git"),
  });

  await new RemoteManager(git, ui).runInit();

  expect(git.initRepo).toHaveBeenCalledTimes(1);
  expect(git.addRemote).toHaveBeenCalledWith("origin", "https://github.com/user/repo.git");
});

// ── add remote ─────────────────────────────────────────────────────────────────

test("add: calls addRemote with name and url", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
    addRemote: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("add" as never)),
    askText: mock()
      .mockResolvedValueOnce("origin")
      .mockResolvedValueOnce("https://github.com/user/repo.git"),
  });

  await new RemoteManager(git, ui).run();

  expect(git.addRemote).toHaveBeenCalledWith("origin", "https://github.com/user/repo.git");
});

test("add: loops on empty remote name until valid", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
    addRemote: mock(() => Promise.resolve()),
  });
  const askText = mock()
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("  ")
    .mockResolvedValueOnce("origin")
    .mockResolvedValueOnce("https://github.com/user/repo.git");
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("add" as never)),
    askText,
  });

  await new RemoteManager(git, ui).run();

  expect(askText).toHaveBeenCalledTimes(4);
  expect(git.addRemote).toHaveBeenCalledWith("origin", "https://github.com/user/repo.git");
});

// ── change url ─────────────────────────────────────────────────────────────────

test("change-url: calls setRemoteUrl with selected remote and new url", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(REMOTES)),
    setRemoteUrl: mock(() => Promise.resolve()),
  });
  const askSelect = mock()
    .mockResolvedValueOnce("change-url")
    .mockResolvedValueOnce("origin");
  const ui = createUIMock({
    askSelect,
    askText: mock(() => Promise.resolve("git@github.com:user/repo.git")),
  });

  await new RemoteManager(git, ui).run();

  expect(git.setRemoteUrl).toHaveBeenCalledWith("origin", "git@github.com:user/repo.git");
});

test("change-url: shows info and exits when no remotes exist", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("change-url" as never)),
  });

  await new RemoteManager(git, ui).run();

  expect(git.setRemoteUrl).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});

// ── remove ─────────────────────────────────────────────────────────────────────

test("remove: calls removeRemote after confirmation", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(REMOTES)),
    removeRemote: mock(() => Promise.resolve()),
  });
  const askSelect = mock()
    .mockResolvedValueOnce("remove")
    .mockResolvedValueOnce("upstream");
  const ui = createUIMock({
    askSelect,
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new RemoteManager(git, ui).run();

  expect(git.removeRemote).toHaveBeenCalledWith("upstream");
});

test("remove: aborts when user declines confirmation", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve(REMOTES)),
    removeRemote: mock(() => Promise.resolve()),
  });
  const askSelect = mock()
    .mockResolvedValueOnce("remove")
    .mockResolvedValueOnce("origin");
  const ui = createUIMock({
    askSelect,
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new RemoteManager(git, ui).run();

  expect(git.removeRemote).not.toHaveBeenCalled();
});

test("remove: shows info and exits when no remotes exist", async () => {
  const git = createGitMock({
    getRemotes: mock(() => Promise.resolve([])),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("remove" as never)),
  });

  await new RemoteManager(git, ui).run();

  expect(git.removeRemote).not.toHaveBeenCalled();
  expect(ui.info).toHaveBeenCalled();
});
