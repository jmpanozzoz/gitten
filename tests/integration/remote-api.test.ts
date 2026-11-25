import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localGit } from "../../scripts/quality/push-snapshot";
import { BranchCleaner } from "../../src/core/branch-cleaner";
import { PullFlow } from "../../src/core/pull-flow";
import { PushBranch } from "../../src/core/push-branch";
import { createGitClient } from "../../src/git/git-client";
import { createUIMock } from "../mocks/ui.mock";
import { runBun } from "../support/run-bun";

async function withRemotes(
  run: (fixture: {
    root: string;
    source: string;
    bare: string;
    other: string;
    client: ReturnType<typeof createGitClient>;
  }) => Promise<void>,
) {
  const root = mkdtempSync(join(tmpdir(), "gitten-remote-api-"));
  try {
    const source = join(root, "source");
    const bare = join(root, "first remote.git");
    const other = join(root, "second.git");
    mkdirSync(source);
    localGit(source, ["init", "-q", "--initial-branch=main"]);
    localGit(source, ["config", "user.name", "Gitten fixture"]);
    localGit(source, ["config", "user.email", "fixture@example.invalid"]);
    localGit(root, ["init", "--bare", "-q", bare]);
    localGit(root, ["init", "--bare", "-q", other]);
    await run({ root, source, bare, other, client: createGitClient(source) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function commit(source: string) {
  localGit(source, ["commit", "-qm", "initial", "--allow-empty"]);
  return localGit(source, ["rev-parse", "HEAD"]);
}

test("remote settings add, update, fetch, and remove local destinations", async () => {
  await withRemotes(async ({ source, bare, other, client }) => {
    await client.addRemote("origin", bare);
    expect(await client.getRemotes()).toEqual([{ name: "origin", url: bare }]);
    const head = commit(source);
    localGit(source, ["push", "-u", "origin", "HEAD:refs/heads/main"]);
    localGit(source, ["update-ref", "-d", "refs/remotes/origin/main"]);
    await client.fetchRemote();
    expect(localGit(source, ["rev-parse", "refs/remotes/origin/main"])).toBe(head);
    await client.setRemoteUrl("origin", other);
    expect(await client.getRemotes()).toEqual([{ name: "origin", url: other }]);
    await client.removeRemote("origin");
    expect(await client.getRemotes()).toEqual([]);
    expect(await client.getRemoteResetTarget()).toBeNull();
  });
});

test("remote settings keep option-like names and paths literal", async () => {
  await withRemotes(async ({ source, client }) => {
    const name = "-team";
    const address = "-initial path 日本語.git";
    await client.addRemote(name, address);
    expect(localGit(source, ["config", "--get", `remote.${name}.url`])).toBe(address);
    await client.setRemoteUrl(name, "--push");
    expect(await client.getRemotes()).toEqual([{ name, url: "--push" }]);
    await client.removeRemote(name);
    expect(await client.getRemotes()).toEqual([]);
  });
});

test("remote settings refuse unsafe addresses and preserve the existing configuration", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    await client.addRemote("origin", bare);
    const config = join(source, ".git", "config");
    const before = readFileSync(config);
    for (const address of ["   ", `${bare}\nnext`, `${bare}\u001b`, `${bare}\u202e`]) {
      await expect(client.addRemote("new", address)).rejects.toThrow(
        "non-empty remote URL or path",
      );
      await expect(client.setRemoteUrl("origin", address)).rejects.toThrow(
        "without control characters",
      );
    }
    expect(readFileSync(config)).toEqual(before);
    expect(await client.getRemotes()).toEqual([{ name: "origin", url: bare }]);
  });
});

test("publication refuses a push address made ambiguous by a Git URL rewrite", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    commit(source);
    const address = "publish://fixture";
    await client.addRemote("origin", address);
    localGit(source, ["config", `url.${bare}.pushInsteadOf`, address]);
    const plan = await client.previewBranchPush("origin");
    expect(plan.urls).toEqual([bare]);
    localGit(source, ["config", "--unset", `url.${bare}.pushInsteadOf`]);
    const ambiguous = `${bare}\u202e`;
    localGit(source, ["config", `url.${ambiguous}.pushInsteadOf`, address]);
    expect(localGit(source, ["remote", "get-url", "--push", "origin"])).toBe(ambiguous);
    await expect(client.pushBranch(plan)).rejects.toThrow("cannot be reviewed safely");
    expect(localGit(bare, ["for-each-ref"])).toBe("");
  });
});

test("publication requires configured URLs and preserves spaces in a push-only destination", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    const head = commit(source);
    localGit(source, ["config", "remote.push-only.pushurl", bare]);
    localGit(source, ["config", "remote.empty.url", ""]);
    localGit(source, ["config", "remote.linebreak.url", `${bare}\nother`]);
    expect(await client.getRemotes()).toEqual([
      { name: "empty", url: "" },
      { name: "linebreak", url: `${bare}\nother` },
      { name: "push-only", url: bare },
    ]);
    await expect(client.previewBranchPush("empty")).rejects.toThrow("no push URLs");
    await expect(client.previewBranchPush("linebreak")).rejects.toThrow(
      "cannot be reviewed safely",
    );
    expect(localGit(bare, ["for-each-ref"])).toBe("");

    const plan = await client.previewBranchPush("push-only");
    expect(plan.urls).toEqual([bare]);
    await client.pushBranch(plan);
    expect(localGit(bare, ["rev-parse", "refs/heads/main"])).toBe(head);
  });
});

test("a push preview resolves Git's push URL rewrite to the actual destination", async () => {
  await withRemotes(async ({ source, bare, other, client }) => {
    const head = commit(source);
    const alias = "publish://release";
    await client.addRemote("mirror", alias);
    localGit(source, ["config", "--add", "remote.mirror.url", other]);
    localGit(source, ["config", `url.${bare}.pushInsteadOf`, alias]);
    expect(await client.getRemotes()).toEqual([{ name: "mirror", url: alias }]);
    const plan = await client.previewBranchPush("mirror");
    expect(plan.urls).toEqual([bare]);
    await client.pushBranch(plan);
    expect(localGit(bare, ["rev-parse", "refs/heads/main"])).toBe(head);
    expect(localGit(other, ["for-each-ref"])).toBe("");
  });
});

test("Git verification fails closed on configuration or index subprocess errors", async () => {
  await withRemotes(async ({ root, source, bare, client }) => {
    const head = commit(source);
    await client.addRemote("origin", bare);
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'if [ "$GITTEN_FIXTURE_FAIL_COMMAND" = "get-url" ] && [ "$1" = "remote" ] && [ "$2" = "get-url" ]; then',
        '  printf "\\n"; exit 0',
        "fi",
        'if [ "$1" = "$GITTEN_FIXTURE_FAIL_COMMAND" ]; then',
        '  if [ "$1" = "stash" ]; then printf "oid\\000invalid-stash\\000subject\\000date\\000"; exit 0; fi',
        '  if [ "$1" = "status" ]; then exit 0; fi',
        '  if [ -n "$GITTEN_FIXTURE_GIT_ERROR" ]; then printf "%s\\n" "$GITTEN_FIXTURE_GIT_ERROR" >&2; fi',
        "  exit 17",
        "fi",
        'exec "$GITTEN_FIXTURE_NATIVE_GIT" "$@"',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const nativeGit = Bun.which("git");
    expect(nativeGit).toBeTruthy();
    const module = new URL("../../src/git/git-client.ts", import.meta.url).href;
    const cases = [
      [
        "config",
        "fixture configuration error",
        'previewBranchPush("origin")',
        "fixture configuration error",
      ],
      ["config", "", 'previewBranchPush("origin")', "Git could not read the push configuration."],
      ["diff", "", "hasStagedConflictMarkers()", "Could not check the index."],
      ["stash", "", "getStashes()", "Git returned an invalid stash entry."],
      [
        "get-url",
        "",
        'previewBranchPush("origin")',
        "Git supplied push URLs that cannot be reviewed safely.",
      ],
    ] as const;
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITTEN_FIXTURE_NATIVE_GIT: nativeGit ?? undefined,
    };
    for (const [command, error, action, diagnostic] of cases) {
      const result = runBun(
        [
          "-e",
          `import { createGitClient } from ${JSON.stringify(module)}; await createGitClient().${action};`,
        ],
        source,
        {
          ...env,
          GITTEN_FIXTURE_FAIL_COMMAND: command,
          GITTEN_FIXTURE_GIT_ERROR: error,
        },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain(diagnostic);
    }
    const status = runBun(
      [
        "-e",
        `import { createGitClient } from ${JSON.stringify(module)};
        const git = createGitClient();
        console.log(JSON.stringify([await git.getCurrentBranch(), (await git.getRepoContext()).branch, (await git.describeStatus()).branch]));`,
      ],
      source,
      { ...env, GITTEN_FIXTURE_FAIL_COMMAND: "status" },
    );
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout.toString())).toEqual(["", "", "Branch unavailable"]);
    expect(localGit(source, ["rev-parse", "HEAD"])).toBe(head);
    expect(localGit(bare, ["for-each-ref"])).toBe("");
  });
});

test("a removed tracking commit clears the resolved upstream without changing HEAD", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    const head = commit(source);
    await client.addRemote("team", bare);
    localGit(source, ["push", "-u", "team", "HEAD:refs/heads/main"]);
    expect((await client.getRemoteResetTarget())?.commit).toBe(head);
    localGit(source, ["update-ref", "-d", "refs/remotes/team/main"]);
    expect(await client.getRemoteResetTarget()).toBeNull();
    expect(localGit(source, ["rev-parse", "HEAD"])).toBe(head);
  });
});

test("upstream setup reports changes made during a successful push", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    const head = commit(source);
    await client.addRemote("team", bare);
    const plan = await client.previewBranchPush("team");
    writeFileSync(
      join(source, ".git", "hooks", "pre-push"),
      "#!/bin/sh\ngit config branch.main.remote other\n",
      { mode: 0o755 },
    );
    await expect(client.pushBranch(plan, true)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "Branch settings changed after the push." }),
    });
    expect(localGit(bare, ["rev-parse", "refs/heads/main"])).toBe(head);
    expect(localGit(source, ["config", "--get", "branch.main.remote"])).toBe("other");
  });
});

test("the first Pull counts files when it gives an unborn checkout its initial commit", async () => {
  await withRemotes(async ({ root, source, bare }) => {
    writeFileSync(join(source, "README.md"), "first tracked file");
    localGit(source, ["add", "README.md"]);
    const head = commit(source);
    localGit(source, ["push", bare, "HEAD:refs/heads/main"]);
    const empty = join(root, "empty");
    mkdirSync(empty);
    localGit(empty, ["init", "-q", "--initial-branch=main"]);
    localGit(empty, ["remote", "add", "origin", bare]);
    localGit(empty, ["config", "branch.main.remote", "origin"]);
    localGit(empty, ["config", "branch.main.merge", "refs/heads/main"]);
    const client = createGitClient(empty);
    const target = await client.getPullTarget();
    expect(target).toEqual({
      branch: "main",
      head: null,
      remote: "origin",
      refs: ["refs/heads/main"],
      url: bare,
    });
    expect(await client.pull(target!)).toEqual({ headChanged: true, filesChanged: 1 });
    expect(localGit(empty, ["rev-parse", "HEAD"])).toBe(head);
    expect(localGit(empty, ["show", "HEAD:README.md"])).toBe("first tracked file");
  });
});

function publishPullUpdate(root: string, source: string, bare: string): string {
  commit(source);
  localGit(source, ["remote", "add", "origin", bare]);
  localGit(source, ["push", "-u", "origin", "HEAD:refs/heads/main"]);
  const writer = join(root, "writer");
  localGit(root, ["clone", "--quiet", "--branch", "main", bare, writer]);
  localGit(writer, ["config", "user.name", "Gitten writer"]);
  localGit(writer, ["config", "user.email", "writer@example.invalid"]);
  writeFileSync(join(writer, "incoming.txt"), "remote update");
  localGit(writer, ["add", "incoming.txt"]);
  const published = commit(writer);
  localGit(writer, ["push", "origin", "HEAD:refs/heads/main"]);
  return published;
}

test("Pull previews the effective fetch URL and refuses a changed destination before fetching", async () => {
  await withRemotes(async ({ root, source, bare, other, client }) => {
    const published = publishPullUpdate(root, source, bare);
    const original = localGit(source, ["rev-parse", "HEAD"]);
    const alias = "fixture://pull";
    localGit(source, ["remote", "set-url", "origin", alias]);
    localGit(source, ["config", `url.${bare}.insteadOf`, alias]);
    const changed = createUIMock({
      askSelect: async () => {
        localGit(source, ["remote", "set-url", "origin", other]);
        return "merge";
      },
    });
    await new PullFlow(client, changed).run();
    expect(changed.info).toHaveBeenCalledWith(`Pull source: 'origin' (${bare}) · refs/heads/main`);
    expect(changed.warn).toHaveBeenCalledWith(
      expect.stringContaining("changed. Review Pull again"),
    );
    expect(changed.success).not.toHaveBeenCalled();
    expect(localGit(source, ["rev-parse", "HEAD", "refs/remotes/origin/main"]).split("\n")).toEqual(
      [original, original],
    );

    localGit(source, ["remote", "set-url", "origin", alias]);
    const approved = createUIMock({ askSelect: async () => "rebase" });
    await new PullFlow(client, approved).run();
    expect(approved.success).toHaveBeenCalledWith("Pulled successfully. 1 file(s) changed.");
    expect(localGit(source, ["rev-parse", "HEAD"])).toBe(published);
  });
});

test("Pull requires one reviewable upstream and supports a local upstream", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    const head = commit(source);
    const configure = (...options: string[]) => localGit(source, ["config", ...options]);
    expect(await client.getPullTarget()).toBeNull();
    await client.addRemote("origin", bare);
    configure("branch.main.remote", "origin");
    expect(await client.getPullTarget()).toBeNull();
    configure("branch.main.merge", "not-a-full-ref");
    await expect(client.getPullTarget()).rejects.toThrow("one reviewable Pull upstream");
    configure("branch.main.merge", "refs/heads/bad\nref");
    await expect(client.getPullTarget()).rejects.toThrow("one reviewable Pull upstream");
    configure("branch.main.merge", "refs/heads/main:refs/heads/other");
    await expect(client.getPullTarget()).rejects.toThrow();
    configure("branch.main.merge", "refs/heads/local-source");
    configure("remote.origin.url", `${bare}\nother`);
    await expect(client.getPullTarget()).rejects.toThrow("without control characters");
    configure("remote.origin.url", bare);
    configure("--add", "branch.main.remote", ".");
    await expect(client.getPullTarget()).rejects.toThrow("one reviewable Pull upstream");
    configure("--replace-all", "branch.main.remote", ".");
    localGit(source, ["tag", "main"]);
    const target = await client.getPullTarget();
    expect(target).toEqual({
      branch: "main",
      head,
      remote: ".",
      refs: ["refs/heads/local-source"],
      url: ".",
    });
    configure("--replace-all", "branch.main.remote", "missing");
    await expect(client.pull(target!)).rejects.toThrow("Review Pull again");
    localGit(source, ["switch", "--detach", head]);
    expect(await client.getPullTarget()).toBeNull();
    await expect(client.pull(target!)).rejects.toThrow("Review Pull again");
  });
});

test("Pull leaves an operation started during strategy selection pending", async () => {
  await withRemotes(async ({ root, source, bare, client }) => {
    publishPullUpdate(root, source, bare);
    const head = localGit(source, ["rev-parse", "HEAD"]);
    const marker = join(source, ".git", "MERGE_HEAD");
    const ui = createUIMock({
      askSelect: async () => {
        writeFileSync(marker, `${head}\n`);
        return "merge";
      },
    });
    await new PullFlow(client, ui).run();
    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("changed. Review Pull again"));
    expect(ui.waitForConflictResolution).not.toHaveBeenCalled();
    expect(localGit(source, ["rev-parse", "HEAD"])).toBe(head);
    expect(readFileSync(marker, "utf8")).toBe(`${head}\n`);
  });
});

test("Pull reports a completed fetch and checkout when a hook removes HEAD", async () => {
  await withRemotes(async ({ root, source, bare, client }) => {
    const published = publishPullUpdate(root, source, bare);
    writeFileSync(
      join(source, ".git", "hooks", "post-merge"),
      "#!/bin/sh\ngit update-ref -d refs/heads/main\n",
      { mode: 0o755 },
    );
    await expect(client.pull()).rejects.toThrow("Pull completed, but HEAD could not be resolved.");
    expect(localGit(source, ["rev-parse", "refs/remotes/origin/main"])).toBe(published);
    expect(localGit(source, ["for-each-ref", "refs/heads/main"])).toBe("");
    expect(readFileSync(join(source, "incoming.txt"), "utf8")).toBe("remote update");
  });
});

test("Pull reports an updated HEAD and the original error when counting changed paths fails", async () => {
  await withRemotes(async ({ root, source, bare, client }) => {
    const published = publishPullUpdate(root, source, bare);
    writeFileSync(
      join(source, ".git", "hooks", "post-merge"),
      "#!/bin/sh\ngit config diff.algorithm invalid-fixture-name\n",
      { mode: 0o755 },
    );
    await expect(client.pull()).rejects.toMatchObject({
      message: "Pull updated HEAD, but Git could not count the changed files.",
      cause: expect.objectContaining({ message: expect.stringContaining("diff.algorithm") }),
    });
    expect(localGit(source, ["rev-parse", "HEAD"])).toBe(published);
    expect(readFileSync(join(source, "incoming.txt"), "utf8")).toBe("remote update");
  });
});

test("publication rejects an unborn or detached HEAD, a missing remote, and an ambiguous upstream", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    await expect(client.previewBranchPush("team")).rejects.toThrow("initial commit");
    const head = commit(source);
    await expect(client.previewBranchPush("team")).rejects.toThrow("remote no longer exists");
    await client.addRemote("team", bare);
    localGit(source, ["config", "branch.main.remote", "team"]);
    localGit(source, ["config", "--add", "branch.main.merge", "refs/heads/first"]);
    localGit(source, ["config", "--add", "branch.main.merge", "refs/heads/second"]);
    await expect(client.previewBranchPush("team")).rejects.toThrow("one remote branch");
    localGit(source, ["switch", "-q", "--detach", head]);
    await expect(client.previewBranchPush("team")).rejects.toThrow("local branch");
    expect(await client.getRemoteResetTarget()).toBeNull();
    expect(localGit(bare, ["for-each-ref"])).toBe("");
  });
});

test("remote tracking ignores symbolic and orphan refs and refuses a moved push URL", async () => {
  await withRemotes(async ({ source, bare, other, client }) => {
    const head = commit(source);
    await client.addRemote("team/other", bare);
    await client.addRemote("team/nested", other);
    localGit(source, ["push", "team/nested", "HEAD:refs/heads/topic"]);
    localGit(source, ["update-ref", "refs/remotes/orphan/old", head]);
    localGit(source, [
      "symbolic-ref",
      "refs/remotes/team/nested/HEAD",
      "refs/remotes/team/nested/topic",
    ]);
    const tracking = await client.getTrackingBranches();
    expect(tracking).toEqual([
      { remote: "team/nested", name: "topic", ref: "refs/remotes/team/nested/topic", head },
    ]);
    const topic = tracking[0]!;
    await expect(client.checkoutTrackingBranch(topic, "-invalid")).rejects.toThrow(
      "valid local branch",
    );
    const plan = await client.previewRemoteBranchDeletion(topic);
    localGit(source, ["config", "remote.team/nested.pushurl", bare]);
    await expect(client.deleteRemoteBranch(plan)).rejects.toThrow("remote configuration changed");
    expect(localGit(other, ["rev-parse", "refs/heads/topic"])).toBe(head);
    expect(localGit(bare, ["for-each-ref"])).toBe("");
    localGit(source, [
      "config",
      "remote.team/nested.fetch",
      "+refs/tags/*:refs/remotes/team/nested/*",
    ]);
    await expect(client.previewRemoteBranchDeletion(topic)).rejects.toThrow("source branch");
  });
});

test("Push Branch reports a partial multi-URL failure after publishing to the first destination", async () => {
  await withRemotes(async ({ root, source, bare, client }) => {
    const head = commit(source);
    await client.addRemote("team", bare);
    localGit(source, ["config", "--add", "remote.team.pushurl", bare]);
    localGit(source, ["config", "--add", "remote.team.pushurl", join(root, "missing.git")]);
    const ui = createUIMock({ askConfirm: async () => true });
    await new PushBranch(client, ui).run();
    expect(localGit(bare, ["rev-parse", "refs/heads/main"])).toBe(head);
    expect(ui.error).toHaveBeenCalledWith(
      expect.stringContaining("Some reviewed push destinations may already have changed"),
    );
    expect(ui.success).not.toHaveBeenCalled();
  });
});

test("upstream setup reports when publication succeeded without a matching fetch ref", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    const head = commit(source);
    await client.addRemote("team", bare);
    localGit(source, ["config", "remote.team.fetch", "+refs/heads/never:refs/remotes/team/never"]);
    const plan = await client.previewBranchPush("team");
    await expect(client.pushBranch(plan, true)).rejects.toThrow(
      "remote branch was updated, but its upstream could not be set",
    );
    expect(localGit(bare, ["rev-parse", "refs/heads/main"])).toBe(head);
    expect(await client.getRemoteResetTarget()).toBeNull();
  });
});

test("a pending merge blocks publication of a previously reviewed branch", async () => {
  await withRemotes(async ({ source, bare, client }) => {
    const head = commit(source);
    await client.addRemote("team", bare);
    const plan = await client.previewBranchPush("team");
    writeFileSync(join(source, ".git", "MERGE_HEAD"), `${head}\n`);
    await expect(client.pushBranch(plan)).rejects.toThrow("Finish the pending Git operation");
    expect(localGit(bare, ["for-each-ref"])).toBe("");
  });
});

test("branch cleanup keeps an unmerged local branch that advanced during force confirmation", async () => {
  await withRemotes(async ({ source, client }) => {
    const base = commit(source);
    localGit(source, ["checkout", "-qb", "topic"]);
    const previous = commit(source);
    const tree = localGit(source, ["rev-parse", "HEAD^{tree}"]);
    const later = localGit(source, [
      "commit-tree",
      tree,
      "-p",
      previous,
      "-m",
      "new unmerged work",
    ]);
    localGit(source, ["checkout", "-q", "main"]);
    const ui = createUIMock({
      askSearchMultiSelect: async (_message, options) => [options[0]!.value],
      askConfirm: async () => {
        localGit(source, ["update-ref", "refs/heads/topic", later, previous]);
        return true;
      },
    });
    await new BranchCleaner(client, ui).run();
    expect(localGit(source, ["rev-parse", "refs/heads/topic"])).toBe(later);
    expect(localGit(source, ["rev-parse", "HEAD"])).toBe(base);
    expect(ui.warn).toHaveBeenCalledWith(
      'Local branch "topic" changed. Review it again before deleting.',
    );
  });
});
