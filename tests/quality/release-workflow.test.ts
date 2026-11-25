import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRoot } from "../../scripts/quality/repository";

const assets = [
  "gitten-darwin-arm64",
  "gitten-darwin-x64",
  "gitten-linux-x64",
  "gitten-linux-arm64",
  "gitten-windows-x64.exe",
];

function withReleaseDirectory(run: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), "gitten-release-rehearsal-"));
  try {
    run(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function workflowStep(file: string, job: string, name: string): string {
  const workflow = Bun.YAML.parse(
    readFileSync(join(projectRoot, ".github", "workflows", file), "utf8"),
  ) as { jobs: Record<string, { steps: { name?: string; run?: string }[] }> };
  const script = workflow.jobs[job]?.steps.find((step) => step.name === name)?.run;
  if (!script) throw new Error(`Workflow step is missing: ${file} / ${job} / ${name}`);
  return script;
}

function runStep(script: string, cwd: string, env: Record<string, string | undefined> = {}) {
  return Bun.spawnSync(["bash", "-c", script], { cwd, env: { ...process.env, ...env } });
}

test("release checksums contain the five binaries and reject a missing asset before replacing the manifest", () => {
  withReleaseDirectory((folder) => {
    const script = workflowStep("release.yml", "package", "Generate release checksum manifest");
    const manifest = join(folder, "SHA256SUMS");
    for (const asset of assets.slice(0, -1)) writeFileSync(join(folder, asset), asset);
    expect(runStep(script, folder).exitCode).toBe(1);
    expect(existsSync(manifest)).toBe(false);
    const windows = assets.at(-1)!;
    writeFileSync(join(folder, windows), windows);
    writeFileSync(join(folder, "coverage.xml"), "diagnostic, not an asset");
    expect(runStep(script, folder).exitCode).toBe(0);
    const valid = assets
      .map((asset) => `${createHash("sha256").update(asset).digest("hex")}  ${asset}\n`)
      .join("");
    expect(readFileSync(manifest, "utf8")).toBe(valid);
    writeFileSync(join(folder, windows), "");
    expect(runStep(script, folder).exitCode).toBe(1);
    expect(readFileSync(manifest, "utf8")).toBe(valid);
    expect(readdirSync(folder).filter((item) => item.startsWith(".SHA256SUMS"))).toEqual([]);
  });
});

test("Homebrew verifies the release identity before reading hashes and updates both formula entries atomically", () => {
  withReleaseDirectory((folder) => {
    const bin = join(folder, "bin");
    const manifest = join(folder, "manifest");
    const output = join(folder, "output");
    const formula = join(folder, "Formula", "gitten.rb");
    const arm64 = "a".repeat(64);
    const x64 = "b".repeat(64);
    mkdirSync(bin);
    mkdirSync(join(folder, "Formula"));
    writeFileSync(manifest, `${arm64}  gitten-darwin-arm64\n${x64}  gitten-darwin-x64\n`);
    const original = readFileSync(join(projectRoot, "Formula", "gitten.rb"), "utf8");
    writeFileSync(formula, original);
    writeFileSync(
      join(bin, "curl"),
      '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\ncp "$FIXTURE_MANIFEST" "$2"\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        'test "$1 $2" = "attestation verify" || exit 2',
        'test "$4 $5" = "--repo jmpanozzoz/gitten" || exit 2',
        'test "$6 $7" = "--cert-identity https://github.com/jmpanozzoz/gitten/.github/workflows/release.yml@refs/tags/v9.8.7" || exit 2',
        'test "$8 $9" = "--source-digest $GITHUB_SHA" || exit 2',
        "shift 9",
        'test "$1" = "--deny-self-hosted-runners" || exit 2',
        'test "$FIXTURE_ATTESTATION" = valid',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      TAG: "v9.8.7",
      REHEARSAL: "false",
      GITHUB_REF: "refs/tags/v9.8.7",
      GITHUB_REPOSITORY: "jmpanozzoz/gitten",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_OUTPUT: output,
      FIXTURE_MANIFEST: manifest,
    };
    const read = workflowStep(
      "update-homebrew.yml",
      "update-formula",
      "Verify manifest and read Homebrew checksums",
    );
    expect(runStep(read, folder, { ...env, GITHUB_REF: "refs/tags/v9.8.6" }).exitCode).toBe(1);
    expect(runStep(read, folder, { ...env, FIXTURE_ATTESTATION: "invalid" }).exitCode).toBe(1);
    expect(existsSync(output)).toBe(false);
    expect(runStep(read, folder, { ...env, FIXTURE_ATTESTATION: "valid" }).exitCode).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(`tag=v9.8.7\narm64=${arm64}\nx64=${x64}\n`);
    const update = workflowStep("update-homebrew.yml", "update-formula", "Update formula file");
    const hashes = { ...env, ARM64_SHA: arm64, X64_SHA: x64 };
    expect(runStep(update, folder, hashes).exitCode).toBe(0);
    const updated = readFileSync(formula, "utf8");
    expect(updated).toContain('version "9.8.7"');
    expect(updated).toContain(`gitten-darwin-arm64"\n      sha256 "${arm64}"`);
    expect(updated).toContain(`gitten-darwin-x64"\n      sha256 "${x64}"`);
    const broken = updated.replace(`sha256 "${x64}"`, "# removed checksum");
    writeFileSync(formula, broken);
    expect(runStep(update, folder, hashes).exitCode).toBe(1);
    expect(readFileSync(formula, "utf8")).toBe(broken);
    expect(readdirSync(join(folder, "Formula"))).toEqual(["gitten.rb"]);
  });
});

test("release rehearsal verifies the exact branch and all five binaries before producing a formula", () => {
  withReleaseDirectory((folder) => {
    const staging = join(folder, "gitten-release-rehearsal");
    const bin = join(folder, "bin");
    const output = join(folder, "outputs");
    mkdirSync(staging);
    mkdirSync(bin);
    for (const asset of assets) writeFileSync(join(staging, asset), asset);
    const generate = workflowStep("release.yml", "package", "Generate release checksum manifest");
    expect(runStep(generate, staging).exitCode).toBe(0);
    writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "9.8.7\\n"\n', { mode: 0o755 });
    writeFileSync(join(bin, "curl"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        'test "$1 $2" = "attestation verify" || exit 2',
        'test "$3" = "$RUNNER_TEMP/gitten-release-rehearsal/SHA256SUMS" || exit 2',
        'test "$4 $5" = "--repo $GITHUB_REPOSITORY" || exit 2',
        'test "$6 $7" = "--cert-identity https://github.com/$GITHUB_REPOSITORY/.github/workflows/release.yml@refs/heads/release-rehearsal/check" || exit 2',
        'test "$8 $9" = "--source-digest $GITHUB_SHA" || exit 2',
        "shift 9",
        'test "$1" = "--deny-self-hosted-runners"',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      REHEARSAL: "true",
      GITHUB_REF: "refs/heads/release-rehearsal/check",
      GITHUB_REPOSITORY: "jmpanozzoz/gitten",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: folder,
    };
    const verify = workflowStep(
      "update-homebrew.yml",
      "update-formula",
      "Verify manifest and read Homebrew checksums",
    );
    expect(runStep(verify, folder, { ...env, GITHUB_REF: "refs/heads/dev" }).exitCode).toBe(1);
    expect(existsSync(output)).toBe(false);
    const windows = join(staging, assets.at(-1)!);
    writeFileSync(windows, "tampered binary");
    expect(runStep(verify, folder, env).exitCode).toBe(1);
    expect(existsSync(output)).toBe(false);
    writeFileSync(windows, assets.at(-1)!);
    expect(runStep(verify, folder, env).exitCode).toBe(0);
    const result = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    const formula = join(folder, "Formula", "gitten.rb");
    mkdirSync(join(folder, "Formula"));
    writeFileSync(formula, readFileSync(join(projectRoot, "Formula", "gitten.rb")));
    const update = workflowStep("update-homebrew.yml", "update-formula", "Update formula file");
    expect(
      runStep(update, folder, {
        ...env,
        TAG: result.tag,
        ARM64_SHA: result.arm64,
        X64_SHA: result.x64,
      }).exitCode,
    ).toBe(0);
    const prepared = readFileSync(formula, "utf8");
    expect(prepared).toContain('version "9.8.7"');
    for (const key of ["arm64", "x64"]) {
      const checksum = createHash("sha256").update(`gitten-darwin-${key}`).digest("hex");
      expect(prepared).toContain(`gitten-darwin-${key}"\n      sha256 "${checksum}"`);
    }
  });
});

test("release publication keeps an incomplete draft private and leaves an already published release untouched", () => {
  withReleaseDirectory((folder) => {
    const bin = join(folder, "bin");
    const output = join(folder, "outputs");
    const calls = join(folder, "patches");
    const staged = join(folder, "uploaded");
    mkdirSync(bin);
    for (const asset of assets) writeFileSync(join(folder, asset), asset);
    const generate = workflowStep("release.yml", "package", "Generate release checksum manifest");
    expect(runStep(generate, folder).exitCode).toBe(0);
    const complete = [...assets, "SHA256SUMS"]
      .map((asset) => {
        const digest = createHash("sha256")
          .update(readFileSync(join(folder, asset)))
          .digest("hex");
        return `${asset}\tuploaded\tsha256:${digest}\n`;
      })
      .join("");
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        'test "$1" = api || exit 2',
        'case "$2" in',
        '  --paginate) test "$3" = "repos/$GITHUB_REPOSITORY/releases?per_page=100" || exit 2; printf "%b" "$FIXTURE_LISTING" ;;',
        '  --method) test "$3 $4 $5 $6 $7" = "PATCH repos/$GITHUB_REPOSITORY/releases/42 -F draft=false --silent" || exit 2; printf "published\\n" >> "$FIXTURE_CALLS" ;;',
        '  "repos/$GITHUB_REPOSITORY/releases/42")',
        '    test "$3" = --jq || exit 2',
        '    case "$4" in',
        '      *.assets*) cat "$FIXTURE_ASSETS" ;;',
        '      *.tag_name*) printf "%b\\n" "$FIXTURE_METADATA" ;;',
        "      *) exit 2 ;;",
        "    esac ;;",
        "  *) exit 2 ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "jmpanozzoz/gitten",
      GITHUB_REF_NAME: "v9.8.7",
      GITHUB_OUTPUT: output,
      RELEASE_ID: "42",
      ALREADY_PUBLISHED: "false",
      FIXTURE_CALLS: calls,
      FIXTURE_ASSETS: staged,
      FIXTURE_METADATA: "v9.8.7\ttrue\tfalse",
    };
    const check = workflowStep(
      "release.yml",
      "publish",
      "Check package and look for a published release",
    );
    expect(runStep(check, folder, { ...env, FIXTURE_LISTING: "v9.8.6\t41\n" }).exitCode).toBe(0);
    expect(runStep(check, folder, { ...env, FIXTURE_LISTING: "v9.8.7\t42\n" }).exitCode).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("published=\npublished=42\n");
    const publish = workflowStep(
      "release.yml",
      "publish",
      "Verify uploaded digests and publish the draft",
    );
    writeFileSync(staged, complete.replace(/^SHA256SUMS.*\n/m, ""));
    expect(runStep(publish, folder, env).exitCode).toBe(1);
    expect(existsSync(calls)).toBe(false);
    writeFileSync(
      staged,
      complete.replace(/^SHA256SUMS.*$/m, `SHA256SUMS\tuploaded\tsha256:${"0".repeat(64)}`),
    );
    expect(runStep(publish, folder, env).exitCode).toBe(1);
    expect(existsSync(calls)).toBe(false);
    writeFileSync(staged, complete);
    expect(
      runStep(publish, folder, { ...env, FIXTURE_METADATA: "v9.8.6\ttrue\tfalse" }).exitCode,
    ).toBe(1);
    expect(existsSync(calls)).toBe(false);
    expect(runStep(publish, folder, env).exitCode).toBe(0);
    expect(
      runStep(publish, folder, {
        ...env,
        ALREADY_PUBLISHED: "true",
        FIXTURE_METADATA: "v9.8.7\tfalse\tfalse",
      }).exitCode,
    ).toBe(0);
    expect(readFileSync(calls, "utf8")).toBe("published\n");
  });
});
