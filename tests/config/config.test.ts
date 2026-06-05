import { expect, test } from "bun:test";
import { type GittenConfig, getLimits, mergeConfig } from "../../src/config/config";

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

test("mergeConfig layers repo ai over global per field", () => {
  const global: GittenConfig = {
    ai: { enabled: true, provider: "openai", model: "gpt-4o-mini" },
  };
  const repo: GittenConfig = { ai: { model: "claude-haiku-4-5" } };

  expect(mergeConfig(global, repo).ai).toEqual({
    enabled: true,
    provider: "openai",
    model: "claude-haiku-4-5", // repo wins
  });
});

test("mergeConfig keeps the base when the override is empty", () => {
  const global: GittenConfig = { limits: { bisectLogLimit: 99 } };
  expect(mergeConfig(global, {})).toEqual({ limits: { bisectLogLimit: 99 } });
});

test("mergeConfig uses the override when the base is empty", () => {
  const repo: GittenConfig = { ai: { enabled: false } };
  expect(mergeConfig({}, repo)).toEqual({ ai: { enabled: false } });
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
