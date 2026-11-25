import { expect, mock, spyOn, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHooks } from "../../scripts/quality/install-hooks";
import { describePrePushFailure, prePush } from "../../scripts/quality/pre-push";
import { localGit, verifySnapshot } from "../../scripts/quality/push-snapshot";
import { parsePushUpdates } from "../../scripts/quality/push-updates";
import { runQualityProcess, stopQualityProcess } from "../../scripts/quality/quality-process";
import { projectRoot } from "../../scripts/quality/repository";
import { bunCommand } from "../support/run-bun";

test("pre-push reports a snapshot error with its cause and tolerates forwarded values", () => {
  expect(
    describePrePushFailure(
      new Error("Snapshot could not be checked", { cause: new Error("missing worktree") }),
    ),
  ).toBe("Snapshot could not be checked\nmissing worktree");
  expect(describePrePushFailure("forwarded failure")).toBe("forwarded failure");
});

test("quality cancellation handles absent processes, independent children, and OS errors", () => {
  const signalChild = mock(() => true);
  const signalGroup = mock(() => true);
  stopQualityProcess({ pid: undefined, kill: signalChild }, true, signalGroup);
  expect(signalGroup).not.toHaveBeenCalled();
  expect(signalChild).not.toHaveBeenCalled();
  stopQualityProcess({ pid: 123, kill: signalChild }, false, signalGroup);
  expect(signalChild).toHaveBeenCalledWith("SIGKILL");
  expect(signalGroup).not.toHaveBeenCalled();

  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    const vanished = Object.assign(new Error("exited"), { code: "ESRCH" });
    const denied = Object.assign(new Error("permission denied"), { code: "EPERM" });
    for (const failure of [vanished, denied]) {
      const kill = mock(() => {
        throw failure;
      });
      stopQualityProcess({ pid: 123, kill: signalChild }, true, kill);
      expect(kill).toHaveBeenCalledWith(-123, "SIGKILL");
    }
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith("Could not stop the quality process.", denied);
  } finally {
    errors.mockRestore();
  }
});

test("parses new SHA-256 refs and ignores valid deletions", () => {
  const oid = "a".repeat(64);
  const zero = "0".repeat(64);
  expect(
    parsePushUpdates(
      `refs/heads/work ${oid} refs/heads/main ${zero}\n(delete) ${zero} refs/heads/old ${oid}\n`,
    ),
  ).toEqual([{ localRef: "refs/heads/work", oid, remoteOid: zero }]);
  expect(() => parsePushUpdates("refs/heads/work invalid refs/heads/main invalid")).toThrow(
    "Invalid",
  );
  expect(() => parsePushUpdates(`(delete) ${oid} refs/heads/main ${zero}`)).toThrow("Inconsistent");
  expect(() => parsePushUpdates("refs/heads/main")).toThrow("Invalid");
  expect(() => parsePushUpdates(`HEAD ${oid} refs/heads/main ${"a".repeat(40)}`)).toThrow(
    "Invalid",
  );
});

test("the pre-push entry point accepts deletions and reports malformed updates on stderr", () => {
  const argv = bunCommand([join(projectRoot, "scripts/quality/pre-push.ts"), "origin", "unused"]);
  const run = (input: string) =>
    Bun.spawnSync(argv, { cwd: projectRoot, stdin: Buffer.from(input) });
  const removed = run(`(delete) ${"0".repeat(40)} refs/heads/work ${"a".repeat(40)}\n`);
  expect(removed.exitCode).toBe(0);
  expect(removed.stdout.toString()).toBe("");
  const malformed = run("refs/heads/work not-an-oid\n");
  expect(malformed.exitCode).toBe(1);
  expect(malformed.stderr.toString()).toContain("Invalid ref update");
});

test("SIGTERM cancels the pre-push entry point even while its input is open", async () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-hook-signal-"));
  const preload = join(root, "ready.ts");
  writeFileSync(
    preload,
    'process.on("newListener", (event) => { if (event === "SIGTERM") setImmediate(() => console.log("ready")); });',
  );
  const child = Bun.spawn(
    bunCommand(["--preload", preload, join(projectRoot, "scripts/quality/pre-push.ts")]),
    { cwd: projectRoot, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const output = child.stdout.getReader();
  const errors = child.stderr.text();
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    expect(Buffer.from((await output.read()).value ?? []).toString()).toBe("ready\n");
    child.kill("SIGTERM");
    expect(await child.exited).toBe(1);
    expect(await errors).toContain("Pre-push cancelled.");
  } finally {
    clearTimeout(deadline);
    output.releaseLock();
    await child.stdin.end();
    rmSync(root, { recursive: true, force: true });
  }
}, 8000);

function copyHookFiles(root: string): void {
  mkdirSync(join(root, ".githooks"), { recursive: true });
  mkdirSync(join(root, "scripts", "quality"), { recursive: true });
  for (const file of [
    ".githooks/pre-push",
    "scripts/quality/pre-push.ts",
    "scripts/quality/push-history.ts",
    "scripts/quality/push-snapshot.ts",
    "scripts/quality/quality-process.ts",
    "scripts/quality/push-updates.ts",
  ]) {
    copyFileSync(join(projectRoot, file), join(root, file));
  }
  chmodSync(join(root, ".githooks", "pre-push"), 0o755);
}

function createFixture(root: string): void {
  localGit(root, ["init", "--quiet", "--initial-branch=main"]);
  localGit(root, ["config", "user.name", "Gitten Test"]);
  localGit(root, ["config", "user.email", "gitten@example.invalid"]);
  copyHookFiles(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "gitten-hook-fixture",
      scripts: { "quality:check": "bun validate.ts" },
      devDependencies: { "local-qa": "file:fixture-dependency" },
    }),
  );
  mkdirSync(join(root, "fixture-dependency"));
  writeFileSync(
    join(root, "fixture-dependency", "package.json"),
    JSON.stringify({
      name: "local-qa",
      version: "1.0.0",
    }),
  );
  writeFileSync(
    join(root, "validate.ts"),
    `
    const outcome = await Bun.file("quality-result.txt").text();
    if (outcome !== "valid") process.exit(1);
  `,
  );
  const install = Bun.spawnSync([process.execPath, "install"], { cwd: root });
  if (!install.success) throw new Error(install.stderr.toString());
}

test("pre-push checks committed snapshots, deduplicates refs and blocks invalid commits", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gitten-push-test-"));
  try {
    const root = join(temporary, "source");
    mkdirSync(root);
    createFixture(root);
    const remote = join(temporary, "remote.git");
    localGit(temporary, ["init", "--bare", remote]);
    installHooks(root);
    installHooks(root);
    localGit(root, ["remote", "add", "origin", remote]);
    const outcome = join(root, "quality-result.txt");
    writeFileSync(outcome, "valid");
    localGit(root, [
      "add",
      ".githooks",
      "scripts",
      "package.json",
      "bun.lock",
      "fixture-dependency",
      "validate.ts",
      "quality-result.txt",
    ]);
    localGit(root, ["commit", "-m", "fixture passes"]);
    const accepted = localGit(root, ["rev-parse", "HEAD"]);

    const push = localGit(root, ["push", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/copy"]);
    expect(push.match(/Checking /g)).toHaveLength(1);
    expect(localGit(remote, ["rev-parse", "refs/heads/main"])).toBe(accepted);

    writeFileSync(outcome, "invalid");
    localGit(root, ["commit", "-am", "fixture fails"]);
    const invalid = localGit(root, ["rev-parse", "--short=12", "HEAD"]);
    writeFileSync(outcome, "valid");
    // A clean tip and unrelated dirt in the primary worktree cannot hide a failing ancestor.
    localGit(root, ["commit", "-am", "the tip passes again"]);
    writeFileSync(outcome, "dirty");
    const rejected = Bun.spawnSync(["git", "push", "origin", "HEAD:refs/heads/main"], {
      cwd: root,
    });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain(`Quality checks failed for HEAD at ${invalid}`);
    expect(rejected.stderr.toString()).toContain("bun run quality:check failed with exit code 1.");
    expect(localGit(remote, ["rev-parse", "refs/heads/main"])).toBe(accepted);
    expect(localGit(root, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(
      1,
    );

    localGit(root, ["push", "origin", ":refs/heads/copy"]);
    expect(localGit(remote, ["branch", "--list"])).not.toContain("copy");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 15_000);

test("pre-push checks each outgoing commit in order and skips history already on another remote ref", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gitten-push-range-"));
  try {
    const root = join(temporary, "source");
    const remote = join(temporary, "remote.git");
    mkdirSync(root);
    createFixture(root);
    localGit(temporary, ["init", "--bare", remote]);
    localGit(root, ["remote", "add", "origin", remote]);
    const baseline = commitFixture(root);
    localGit(root, ["push", "origin", "HEAD:refs/heads/already-published"]);
    installHooks(root);

    localGit(root, ["commit", "--allow-empty", "-m", "first outgoing commit"]);
    const first = localGit(root, ["rev-parse", "HEAD"]);
    localGit(root, ["commit", "--allow-empty", "-m", "second outgoing commit"]);
    const tip = localGit(root, ["rev-parse", "HEAD"]);
    const published = localGit(root, [
      "push",
      "origin",
      "HEAD:refs/heads/new",
      "HEAD:refs/heads/copy",
    ]);
    expect(published.match(/Checking .* at [a-f0-9]{12}/g)).toEqual([
      `Checking HEAD at ${first.slice(0, 12)}`,
      `Checking HEAD at ${tip.slice(0, 12)}`,
    ]);
    expect(published).not.toContain(baseline.slice(0, 12));
    expect(localGit(remote, ["rev-parse", "refs/heads/new"])).toBe(tip);
    expect(localGit(remote, ["rev-parse", "refs/heads/copy"])).toBe(tip);
    assertOnlyOriginalCheckout(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 15_000);

test("pre-push checks a ref target even when the destination already has that commit", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "gitten-push-known-tip-"));
  try {
    const root = join(temporary, "source");
    const remote = join(temporary, "remote.git");
    mkdirSync(root);
    createFixture(root);
    localGit(temporary, ["init", "--bare", remote]);
    const good = commitFixture(root);
    writeFileSync(join(root, "quality-result.txt"), "invalid");
    localGit(root, ["commit", "-am", "unverified fixture"]);
    const unverified = localGit(root, ["rev-parse", "HEAD"]);
    localGit(root, ["push", remote, "HEAD:refs/heads/existing"]);
    const update = `HEAD ${unverified} refs/heads/new ${"0".repeat(40)}`;
    await expect(prePush(root, update, new AbortController().signal, remote)).rejects.toThrow(
      `Quality checks failed for HEAD at ${unverified.slice(0, 12)}`,
    );
    installHooks(root);
    const rejected = Bun.spawnSync(["git", "push", remote, "HEAD:refs/heads/new"], { cwd: root });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain(
      `Quality checks failed for HEAD at ${unverified.slice(0, 12)}`,
    );
    expect(localGit(remote, ["rev-parse", "refs/heads/existing"])).toBe(unverified);
    expect(localGit(remote, ["for-each-ref", "refs/heads/new"])).toBe("");
    expect(localGit(root, ["rev-parse", "HEAD^"])).toBe(good);
    assertOnlyOriginalCheckout(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 15_000);

test("the installed pre-push runs snapshots with tool settings and without ambient credentials", () => {
  const temporary = mkdtempSync(join(tmpdir(), "gitten-push-environment-"));
  try {
    const root = join(temporary, "source");
    const remote = join(temporary, "remote.git");
    mkdirSync(root);
    createFixture(root);
    localGit(temporary, ["init", "--bare", remote]);
    localGit(root, ["remote", "add", "origin", remote]);
    installHooks(root);
    const credentials = {
      GITTEN_AI_KEY: "fixture-ai-key",
      OPENAI_API_KEY: "fixture-provider-key",
      GITHUB_TOKEN: "fixture-github-token",
      NPM_TOKEN: "fixture-registry-token",
    };
    writeFileSync(
      join(root, "validate.ts"),
      `
      if (process.env.TERM !== "fixture-terminal" || !process.env.PATH) process.exit(3);
      for (const key of ${JSON.stringify(Object.keys(credentials))})
        if (Object.hasOwn(process.env, key)) process.exit(4);
      `,
    );
    const commit = commitFixture(root);
    const result = Bun.spawnSync(["git", "push", "origin", "HEAD:refs/heads/main"], {
      cwd: root,
      env: { ...process.env, ...credentials, TERM: "fixture-terminal" },
    });
    expect(result.stderr.toString()).not.toContain("failed");
    expect(result.exitCode).toBe(0);
    expect(localGit(remote, ["rev-parse", "refs/heads/main"])).toBe(commit);
    assertOnlyOriginalCheckout(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 15_000);

test("pre-push accepts a published shallow boundary and rejects an unverified boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gitten-push-shallow-"));
  try {
    const upstream = join(directory, "upstream");
    const shallow = join(directory, "shallow");
    mkdirSync(upstream);
    createFixture(upstream);
    commitFixture(upstream);
    localGit(upstream, ["commit", "--allow-empty", "-m", "published boundary"]);
    const baseline = localGit(upstream, ["rev-parse", "HEAD"]);
    localGit(directory, ["clone", "--quiet", "--depth=1", `file://${upstream}`, shallow]);
    localGit(shallow, [
      "-c",
      "user.name=Gitten",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "outgoing",
    ]);
    const tip = localGit(shallow, ["rev-parse", "HEAD"]);
    const signal = new AbortController().signal;
    const unpublished = `HEAD ${tip} refs/heads/new ${"0".repeat(40)}`;
    await expect(prePush(shallow, unpublished, signal)).rejects.toThrow("Fetch more history");
    await expect(prePush(shallow, unpublished, signal, upstream)).resolves.toBeUndefined();
    const knownOldRef = `HEAD ${tip} refs/heads/main ${baseline}`;
    await expect(
      prePush(shallow, knownOldRef, signal, join(directory, "unavailable")),
    ).resolves.toBeUndefined();
    assertOnlyOriginalCheckout(shallow);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);

function commitFixture(root: string): string {
  writeFileSync(join(root, "quality-result.txt"), "valid");
  localGit(root, ["add", "-A", "--", ".", ":!node_modules"]);
  localGit(root, ["commit", "-m", "fixture commit"]);
  return localGit(root, ["rev-parse", "HEAD"]);
}

function assertOnlyOriginalCheckout(root: string): void {
  expect(localGit(root, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
}

test("pre-push resolves annotated tags to commits and runs the gate once per distinct commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-hook-tags-"));
  try {
    createFixture(root);
    const commit = commitFixture(root);
    localGit(root, ["tag", "-a", "fixture-v1", "-m", "fixture"]);
    const tag = localGit(root, ["rev-parse", "refs/tags/fixture-v1"]);
    const finish = [
      `refs/heads/local ${commit} refs/heads/published ${"0".repeat(40)}`,
      `refs/tags/fixture-v1 ${tag} refs/tags/fixture-v1 ${"0".repeat(40)}`,
    ].join("\n");
    const signal = new AbortController().signal;
    await prePush(root, finish, signal);
    const blob = localGit(root, ["hash-object", "-w", "quality-result.txt"]);
    localGit(root, ["tag", "-a", "a-blob", blob, "-m", "not a commit"]);
    const tagToBlob = localGit(root, ["rev-parse", "refs/tags/a-blob"]);
    await expect(
      prePush(root, `refs/tags/a-blob ${tagToBlob} refs/tags/a-blob ${"0".repeat(40)}`, signal),
    ).rejects.toThrow("The object must resolve to a commit");
    assertOnlyOriginalCheckout(root);
    expect(localGit(root, ["rev-parse", "HEAD"])).toBe(commit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test("a missing dependency in a committed snapshot blocks the gate and removes the checkout", async () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-hook-missing-dependency-"));
  try {
    createFixture(root);
    commitFixture(root);
    localGit(root, ["rm", "fixture-dependency/package.json"]);
    localGit(root, ["commit", "-m", "missing locked dependency"]);
    const commit = localGit(root, ["rev-parse", "HEAD"]);
    const signal = new AbortController().signal;
    await expect(
      prePush(root, `refs/heads/local ${commit} refs/heads/published ${"0".repeat(40)}`, signal),
    ).rejects.toThrow("Quality checks failed");
    assertOnlyOriginalCheckout(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

test("snapshot setup and cancelled pushes leave the original checkout untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "gitten-hook-setup-error-"));
  const controller = new AbortController();
  try {
    createFixture(root);
    const published = commitFixture(root);
    await expect(verifySnapshot(root, "f".repeat(40), controller.signal)).rejects.toThrow(
      /invalid reference|reference is not a tree/i,
    );
    assertOnlyOriginalCheckout(root);
    expect(readdirSync(join(root, ".git"))).not.toContain("worktrees");
    controller.abort(new Error("cancel before push"));
    await expect(
      prePush(root, `HEAD ${published} refs/heads/main ${"0".repeat(40)}`, controller.signal),
    ).rejects.toThrow("cancel before push");
    await expect(verifySnapshot(root, published, controller.signal)).rejects.toThrow(
      "cancel before push",
    );
    expect(localGit(root, ["rev-parse", "HEAD"])).toBe(published);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the quality subprocess reports spawn failures and honours cancellation before launch", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "gitten-quality-spawn-"));
  const controller = new AbortController();
  const options = { cwd: join(temporary, "absent"), env: {}, signal: controller.signal };
  try {
    await expect(runQualityProcess(["--version"], options)).rejects.toMatchObject({
      code: "ENOENT",
    });
    controller.abort(new Error("cancel before spawn"));
    await expect(runQualityProcess(["--version"], options)).rejects.toThrow("cancel before spawn");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("the quality subprocess reports termination by a signal", async () => {
  await expect(
    runQualityProcess(["-e", 'process.kill(process.pid, "SIGTERM")'], {
      cwd: projectRoot,
      env: process.env,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("was terminated by SIGTERM");
});

test("cancelling a running snapshot stops its subprocesses and removes its linked checkout", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gitten-hook-abort-"));
  const root = join(directory, "repository");
  const ready = join(directory, "started");
  const finished = join(directory, "finished");
  const controller = new AbortController();
  try {
    mkdirSync(root);
    createFixture(root);
    const worker = `await Bun.write(${JSON.stringify(ready)}, "started"); await Bun.sleep(1400);
      await Bun.write(${JSON.stringify(finished)}, "finished");`;
    writeFileSync(
      join(root, "validate.ts"),
      `
      const worker = Bun.spawn([process.execPath, "-e", ${JSON.stringify(worker)}]);
      await worker.exited;
    `,
    );
    const commit = commitFixture(root);
    const verification = verifySnapshot(root, commit, controller.signal).then(
      () => "completed",
      (error: unknown) => error,
    );
    const limit = Date.now() + 7_000;
    while (!(await Bun.file(ready).exists()) && Date.now() < limit) await Bun.sleep(10);
    expect(await Bun.file(ready).exists()).toBe(true);
    controller.abort(new Error("cancelled by test"));
    expect(await verification).toEqual(new Error("cancelled by test"));
    assertOnlyOriginalCheckout(root);
    await Bun.sleep(1500);
    expect(await Bun.file(finished).exists()).toBe(false);
  } finally {
    controller.abort();
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
