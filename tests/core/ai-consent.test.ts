import { expect, mock, test } from "bun:test";
import { bindAI } from "../../src/ai/bind";
import { confirmAISend } from "../../src/core/ai-consent";
import { normalizeAIBaseUrl } from "../../src/core/domain/ai-endpoint";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { explainDiff } from "../../src/core/explain-diff";
import { createUIMock } from "../mocks/ui.mock";

test("AI consent names the data and destination and defaults to No", async () => {
  const ai = bindAI({
    provider: "custom",
    baseUrl: "https://ai.example.invalid/v1",
    enabled: true,
    model: "sample",
    apiKey: "",
  });
  const ui = createUIMock();
  expect(await confirmAISend(ui, "the selected diff", ai.commit)).toBe(false);
  expect(ui.askConfirm).toHaveBeenCalledWith(
    "Send the selected diff to https://ai.example.invalid/v1?",
    false,
  );
});

test("Escape declines AI consent and unexpected terminal failures stay visible", async () => {
  const ui = createUIMock({
    askConfirm: mock()
      .mockRejectedValueOnce(new GoBackSignal())
      .mockRejectedValueOnce(new Error("input closed")),
  });
  expect(await confirmAISend(ui, "this diff", {})).toBe(false);
  await expect(confirmAISend(ui, "this diff", {})).rejects.toThrow("input closed");
  expect(ui.askConfirm).toHaveBeenCalledWith(
    "Send this diff to the configured AI provider?",
    false,
  );
});

test("AI destinations require HTTPS except for loopback and reject embedded authorization", () => {
  expect(normalizeAIBaseUrl(" https://service.example.test/v1/// ")).toBe(
    "https://service.example.test/v1",
  );
  expect(normalizeAIBaseUrl("http://[::1]:8080/v1")).toBe("http://[::1]:8080/v1");
  expect(normalizeAIBaseUrl("http://service.example.test/v1")).toBeNull();
  expect(normalizeAIBaseUrl("ftp://localhost/v1")).toBeNull();
  expect(normalizeAIBaseUrl("https://person:secret@service.example.test/v1")).toBeNull();
  expect(normalizeAIBaseUrl("https://service.example.test/v1?key=sample")).toBeNull();
  expect(normalizeAIBaseUrl("https://service.example.test/v1#fragment")).toBeNull();
  expect(normalizeAIBaseUrl("not a URL")).toBeNull();
});

test("diff explanation skips empty data and stays optional when retrieval or the provider fails", async () => {
  const ui = createUIMock({ askConfirm: async () => true });
  const explain = mock().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("");
  await explainDiff(ui, async () => "", "the diff", explain);
  await explainDiff(
    ui,
    async () => {
      throw new Error("missing revision");
    },
    "the diff",
    explain,
  );
  expect(explain).not.toHaveBeenCalled();
  await explainDiff(ui, async () => "sample diff", "the diff", explain);
  await explainDiff(ui, async () => "sample diff", "the diff", explain);
  expect(explain).toHaveBeenCalledTimes(2);
  expect(ui.info).not.toHaveBeenCalled();
});
