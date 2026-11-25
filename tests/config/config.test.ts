import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GittenConfig,
  getBranchPrefixes,
  getLimits,
  mergeConfig,
} from "../../src/core/domain/preferences";
import { runBun } from "../support/run-bun";

test("mergeConfig returns an empty config when both sides are empty", () => {
  expect(mergeConfig({}, {})).toEqual({});
});

test("mergeConfig layers repo limits over global per field", () => {
  const global: GittenConfig = { limits: { cherryPickLogLimit: 50, undoCommitLimit: 10 } };
  const repo: GittenConfig = { limits: { cherryPickLogLimit: 5 } };

  expect(mergeConfig(global, repo).limits).toEqual({
    cherryPickLogLimit: 5, // repo wins
    undoCommitLimit: 10, // inherited from global
  });
});

test("mergeConfig leaves the user connection intact", () => {
  const global: GittenConfig = {
    ai: { enabled: true, provider: "openai", model: "gpt-4o-mini" },
  };
  const repo: GittenConfig = { ai: { model: "claude-haiku-4-5" } };

  expect(mergeConfig(global, repo).ai).toEqual({
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
  });
});

test("mergeConfig only returns profiles from the global configuration", () => {
  const global: GittenConfig = {
    aiProfiles: {
      work: { enabled: true, provider: "openai", baseUrl: "u", apiKey: "k", model: "gpt-4o-mini" },
    },
  };
  const repo: GittenConfig = {
    aiProfiles: {
      local: { enabled: true, provider: "ollama", baseUrl: "u2", apiKey: "", model: "llama3.2" },
    },
  };

  expect(Object.keys(mergeConfig(global, repo).aiProfiles ?? {})).toEqual(["work"]);
});

test("mergeConfig keeps the base when the override is empty", () => {
  const global: GittenConfig = { limits: { bisectLogLimit: 99 } };
  expect(mergeConfig(global, {})).toEqual({ limits: { bisectLogLimit: 99 } });
});

test("mergeConfig uses the override when the base is empty", () => {
  expect(mergeConfig({}, { branchPrefixes: ["release"] })).toEqual({ branchPrefixes: ["release"] });
});

// ─── branch prefixes ──────────────────────────────────────────────────────────

test("getBranchPrefixes returns the defaults when none are configured", () => {
  expect(getBranchPrefixes({})).toEqual(["feat", "fix", "hotfix", "chore", "docs"]);
});

test("getBranchPrefixes returns the configured prefixes when set", () => {
  expect(getBranchPrefixes({ branchPrefixes: ["feat", "release", "spike"] })).toEqual([
    "feat",
    "release",
    "spike",
  ]);
});

test("getBranchPrefixes ignores an empty configured list", () => {
  expect(getBranchPrefixes({ branchPrefixes: [] })).toEqual([
    "feat",
    "fix",
    "hotfix",
    "chore",
    "docs",
  ]);
});

test("mergeConfig replaces branchPrefixes with the override's set", () => {
  const merged = mergeConfig({ branchPrefixes: ["feat", "fix"] }, { branchPrefixes: ["release"] });
  expect(merged.branchPrefixes).toEqual(["release"]);
});

test("mergeConfig keeps base branchPrefixes when the override has none", () => {
  expect(mergeConfig({ branchPrefixes: ["feat", "fix"] }, {}).branchPrefixes).toEqual([
    "feat",
    "fix",
  ]);
});

test("getLimits fills defaults under a merged repo override", () => {
  const merged = mergeConfig(
    { limits: { cherryPickLogLimit: 50 } }, // global
    { limits: { cherryPickLogLimit: 5 } }, // repo wins
  );
  const limits = getLimits(merged);

  expect(limits.cherryPickLogLimit).toBe(5); // repo override
  expect(limits.undoCommitLimit).toBe(10); // DEFAULT_LIMITS fallback
});

function withConfigFiles(run: (home: string, repo: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "gitten-config-test-"));
  try {
    const repo = mkdtempSync(join(home, "repo-"));
    run(home, repo);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function runConfig(home: string, repo: string, code: string): string {
  const source = new URL("../../src/config/config.ts", import.meta.url).href;
  const result = runBun(
    ["-e", `import * as config from ${JSON.stringify(source)}; ${code}`],
    repo,
    { HOME: home, USERPROFILE: home },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

test("reads only validated project preferences and leaves disabled AI disabled", () => {
  withConfigFiles((home, repo) => {
    writeFileSync(
      join(home, ".gitten.json"),
      JSON.stringify({
        ai: { enabled: false, baseUrl: "https://api.example.com/v1", model: "example" },
        limits: { undoCommitLimit: 12, revertLogLimit: 30 },
        branchPrefixes: ["feat"],
      }),
    );
    writeFileSync(
      join(repo, ".gittenrc"),
      JSON.stringify({
        ai: { enabled: true },
        aiProfiles: { other: { enabled: true } },
        limits: { undoCommitLimit: 3, revertLogLimit: "100" },
        branchPrefixes: ["release"],
      }),
    );
    const outputs = JSON.parse(
      runConfig(
        home,
        repo,
        `
      console.log(JSON.stringify([await config.readConfig(), await config.getActiveAIConfig()]));
    `,
      ),
    );
    expect(outputs).toEqual([
      {
        ai: {
          enabled: false,
          provider: "custom",
          baseUrl: "https://api.example.com/v1",
          apiKey: "",
          model: "example",
        },
        limits: { undoCommitLimit: 3, revertLogLimit: 30 },
        branchPrefixes: ["release"],
      },
      null,
    ]);
  });
});

test("environment key follows its explicitly configured connection and stays off Ollama", () => {
  withConfigFiles((home, repo) => {
    const result = runConfig(
      home,
      repo,
      `
      process.env.GITTEN_AI_API_KEY = "env-test";
      process.env.GITTEN_AI_PROVIDER = "custom";
      process.env.GITTEN_AI_BASE_URL = "https://api.example.com/v1/";
      const connection = { provider: "custom", baseUrl: "https://api.example.com/v1",
        apiKey: "saved-test", model: "example", enabled: true };
      const keys = [
        config.resolveAIConnection(connection)?.apiKey,
        config.resolveAIConnection({ ...connection, baseUrl: "https://api.example.com/other" })?.apiKey,
        config.resolveAIConnection({ ...connection, provider: "openai" })?.apiKey,
        config.resolveAIConnection({ ...connection, provider: "ollama" })?.apiKey,
        config.resolveAIConnection({ ...connection, baseUrl: "http://api.example.com/v1" }),
      ];
      delete process.env.GITTEN_AI_BASE_URL;
      keys.push(config.resolveAIConnection(connection)?.apiKey);
      console.log(JSON.stringify(keys));
    `,
    );
    expect(JSON.parse(result)).toEqual([
      "env-test",
      "saved-test",
      "saved-test",
      "",
      null,
      "saved-test",
    ]);
  });
});

test("loads only valid saved profiles and resolves the enabled user connection", () => {
  withConfigFiles((home, repo) => {
    const connection = {
      enabled: true,
      provider: "custom",
      baseUrl: "https://example.test/v1/",
      apiKey: "fixture-key",
      model: " demo ",
    };
    writeFileSync(
      join(home, ".gitten.json"),
      JSON.stringify({
        ai: connection,
        aiProfiles: {
          work: connection,
          malformed: { model: "" },
          unsafe: { ...connection, baseUrl: "http://example.test" },
        },
      }),
    );
    writeFileSync(
      join(repo, ".gittenrc"),
      JSON.stringify({
        aiProfiles: { injected: connection },
        ai: { enabled: false },
      }),
    );
    const outputs = JSON.parse(
      runConfig(
        home,
        repo,
        `
      console.log(JSON.stringify([await config.readConfig(), await config.getActiveAIConfig()]));
    `,
      ),
    );
    const normalized = { ...connection, baseUrl: "https://example.test/v1", model: "demo" };
    expect(outputs).toEqual([{ ai: normalized, aiProfiles: { work: normalized } }, normalized]);
  });
});

test("a failed config write preserves saved bytes and removes temporary files", () => {
  withConfigFiles((home, repo) => {
    const config = join(home, ".gitten.json");
    const previous = '{"branchPrefixes":["original"]}\n';
    writeFileSync(config, previous);
    expect(
      runConfig(
        home,
        repo,
        `
      const invalid = {};
      invalid.cycle = invalid;
      try { await config.writeConfig(invalid); } catch (error) { console.log(error.name); }
    `,
      ),
    ).toBe("TypeError");
    expect(readFileSync(config, "utf8")).toBe(previous);
    expect(readdirSync(home).filter((name) => name.startsWith(".gitten-config-"))).toEqual([]);

    rmSync(config);
    mkdirSync(config);
    const preserved = join(config, "original");
    writeFileSync(preserved, previous);
    expect(
      runConfig(
        home,
        repo,
        `
      try { await config.writeConfig({ branchPrefixes: ["new"] }); } catch (error) { console.log(error.code); }
    `,
      ),
    ).toMatch(/^(EISDIR|ENOTEMPTY|EEXIST|EPERM)$/);
    expect(readFileSync(preserved, "utf8")).toBe(previous);
    expect(readdirSync(home).filter((name) => name.startsWith(".gitten-config-"))).toEqual([]);
  });
});

test("replaces an existing settings file from a private temporary file", () => {
  withConfigFiles((home, repo) => {
    const path = join(home, ".gitten.json");
    writeFileSync(path, "{", { mode: 0o644 });
    expect(
      runConfig(
        home,
        repo,
        `
      console.log(JSON.stringify(await config.readGlobalConfig()));
      await config.writeConfig({ branchPrefixes: ["release"] });
    `,
      ),
    ).toBe("{}");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ branchPrefixes: ["release"] });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(home).filter((name) => name.startsWith(".gitten-config-"))).toEqual([]);
  });
});
