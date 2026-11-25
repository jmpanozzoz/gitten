import { expect, mock, test } from "bun:test";
import { resolveAIConnection } from "../../src/config/config";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { Settings } from "../../src/core/settings";
import { createUIMock } from "../mocks/ui.mock";

const MOCK_READ = mock(() => Promise.resolve({}));
const MOCK_WRITE = mock(() => Promise.resolve());
const MOCK_TEST_CONNECTION = mock(() => Promise.resolve());

const dependencies = {
  read: MOCK_READ,
  readRepository: async () => ({}),
  write: MOCK_WRITE,
  resolveConnection: resolveAIConnection,
  testConnection: MOCK_TEST_CONNECTION,
};

// ─── top-level menu ───────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on top-level menu", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new Settings(ui, dependencies).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(MOCK_WRITE).not.toHaveBeenCalled();
});

// ─── configure ────────────────────────────────────────────────────────────────

test("saves full config when user fills in all fields (openai provider)", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai") // top-level menu
      .mockResolvedValueOnce("configure") // ai action
      .mockResolvedValueOnce("openai"), // provider
    askText: mock().mockResolvedValueOnce("gpt-4o-mini"),
    askSecret: mock().mockResolvedValueOnce("sk-test-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-key",
        model: "gpt-4o-mini",
        enabled: true,
      }),
    }),
  );
});

test("keeps the existing API key when left blank and never displays it in full", async () => {
  MOCK_WRITE.mockClear();
  MOCK_READ.mockResolvedValueOnce({
    ai: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-secret-1234567890",
      model: "gpt-4o-mini",
      enabled: true,
    },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai") // top-level menu
      .mockResolvedValueOnce("configure") // ai action
      .mockResolvedValueOnce("openai"), // provider
    askText: mock().mockResolvedValueOnce("gpt-4o-mini"),
    askSecret: mock().mockResolvedValueOnce("   "),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new Settings(ui, dependencies).run();

  // The stored key is preserved untouched.
  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({ apiKey: "sk-secret-1234567890" }),
    }),
  );

  expect(ui.askSecret).toHaveBeenCalledWith("API key (leave blank to keep current):");
});

test("saves config without API key for Ollama (local, no key required)", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("ollama"),
    askText: mock().mockResolvedValueOnce("llama3.2"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2",
        enabled: true,
      }),
    }),
  );
});

test("saves config with custom base URL when Custom provider selected", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("custom"),
    askText: mock()
      .mockResolvedValueOnce("https://my-llm.example.com/v1")
      .mockResolvedValueOnce("my-model"),
    askSecret: mock().mockResolvedValueOnce("my-api-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "custom",
        baseUrl: "https://my-llm.example.com/v1",
        model: "my-model",
        apiKey: "my-api-key",
        enabled: true,
      }),
    }),
  );
});

// ─── toggle ───────────────────────────────────────────────────────────────────

test("disables AI when user chooses disable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: true, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("disable"),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: false }) }),
  );
});

test("enables AI when user chooses enable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: false, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("enable"),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: true }) }),
  );
});

test("shows Enable option when AI is configured but disabled", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: false, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        const values = options.map((o) => o.value);
        expect(values).toContain("enable");
        expect(values).not.toContain("disable");
        return Promise.resolve("enable");
      }),
  });

  await new Settings(ui, dependencies).run();
});

test("shows Disable option when AI is enabled", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: true, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        const values = options.map((o) => o.value);
        expect(values).toContain("disable");
        expect(values).not.toContain("enable");
        return Promise.resolve("disable");
      }),
  });

  await new Settings(ui, dependencies).run();
});

test("shows only Configure option when no config exists yet", async () => {
  MOCK_READ.mockResolvedValueOnce({});

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        expect(options.map((o) => o.value)).toEqual(["configure"]);
        return Promise.resolve("configure");
      })
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o"),
    askSecret: mock().mockResolvedValueOnce("sk-key"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new Settings(ui, dependencies).run();
});

// ─── connection test ──────────────────────────────────────────────────────────

test("runs connection test and shows success when user opts in", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  MOCK_TEST_CONNECTION.mockResolvedValueOnce(undefined);
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o"),
    askSecret: mock().mockResolvedValueOnce("sk-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_TEST_CONNECTION).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Connection successful!");
});

test("shows warning when connection test fails", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  MOCK_TEST_CONNECTION.mockRejectedValueOnce(
    new Error("Invalid API key — check your credentials in Settings"),
  );
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o"),
    askSecret: mock().mockResolvedValueOnce("bad-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui, dependencies).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid API key"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("may not work"));
});

test("skips connection test when user declines", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o"),
    askSecret: mock().mockResolvedValueOnce("sk-key"),
    askConfirm: mock().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_TEST_CONNECTION).not.toHaveBeenCalled();
});

// ─── limits ───────────────────────────────────────────────────────────────────

test("saves updated limits when user enters valid values", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("limits")),
    askText: mock()
      .mockResolvedValueOnce("20") // undo limit
      .mockResolvedValueOnce("50") // cherry-pick limit
      .mockResolvedValueOnce("40") // bisect limit
      .mockResolvedValueOnce("25"), // revert limit
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      limits: {
        undoCommitLimit: 20,
        cherryPickLogLimit: 50,
        bisectLogLimit: 40,
        revertLogLimit: 25,
      },
    }),
  );
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("20"));
});

test("keeps current value when user enters invalid input for a limit", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("limits")),
    askText: mock()
      .mockResolvedValueOnce("abc") // invalid → keeps default 10
      .mockResolvedValueOnce("30")
      .mockResolvedValueOnce("30"),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      limits: expect.objectContaining({ undoCommitLimit: 10 }),
    }),
  );
});

test("rejects values above 500 and keeps current limit", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("limits")),
    askText: mock()
      .mockResolvedValueOnce("999") // > 500 → keeps default 10
      .mockResolvedValueOnce("30")
      .mockResolvedValueOnce("30"),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      limits: expect.objectContaining({ undoCommitLimit: 10 }),
    }),
  );
});

// ─── AI profiles ────────────────────────────────────────────────────────────

const FULL_AI = {
  enabled: true,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};

test("saves the current AI config as a named profile", async () => {
  MOCK_WRITE.mockClear();
  MOCK_READ.mockResolvedValueOnce({ ai: FULL_AI });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("save"),
    askText: mock(() => Promise.resolve("work")),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      aiProfiles: expect.objectContaining({
        work: expect.objectContaining({ model: "gpt-4o-mini", provider: "openai" }),
      }),
    }),
  );
});

test("switching a profile loads it into the active config and enables AI", async () => {
  MOCK_WRITE.mockClear();
  MOCK_READ.mockResolvedValueOnce({
    ai: { ...FULL_AI, enabled: false },
    aiProfiles: {
      groq: {
        enabled: false,
        provider: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: "gk",
        model: "llama-3.3-70b-versatile",
      },
    },
  });
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("switch")
      .mockResolvedValueOnce("groq"),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        enabled: true,
      }),
    }),
  );
});

test("removes the selected profile(s)", async () => {
  MOCK_WRITE.mockClear();
  MOCK_READ.mockResolvedValueOnce({
    ai: FULL_AI,
    aiProfiles: {
      work: FULL_AI,
      home: { ...FULL_AI, provider: "groq", model: "llama-3.3-70b-versatile" },
    },
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("remove"),
    askMultiSelect: mock(() => Promise.resolve(["work"])),
  });

  await new Settings(ui, dependencies).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      aiProfiles: { home: expect.objectContaining({ provider: "groq" }) },
    }),
  );
});

test("effective settings identify user, repository and default values without exposing credentials", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({ askSelect: async () => "effective" });
  await new Settings(ui, {
    ...dependencies,
    read: async () => ({
      limits: { undoCommitLimit: 20, cherryPickLogLimit: 45 },
      branchPrefixes: ["work"],
      ai: {
        enabled: true,
        model: "test-model",
        baseUrl: "https://example.test/v1",
        apiKey: "never-display-this",
      },
    }),
    readRepository: async () => ({ limits: { cherryPickLogLimit: 99 }, branchPrefixes: [] }),
  }).run();
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("Undo history: 20 (user configuration)"),
  );
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("Cherry-pick history: 99 (.gittenrc)"),
  );
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("Bisect history: 30 (built-in default)"),
  );
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("Branch prefixes: feat, fix, hotfix, chore, docs (built-in default)"),
  );
  expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining("never-display-this"));
  expect(MOCK_WRITE).not.toHaveBeenCalled();
});

test("editing a custom endpoint retries invalid input and does not reuse credentials for a new endpoint", async () => {
  const existing = { ...FULL_AI, provider: "custom", baseUrl: "https://old.example.test/v1" };
  const write = mock(async () => {});
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValue("custom"),
    askText: mock()
      .mockResolvedValueOnce("https://user:password@example.test/v1")
      .mockResolvedValueOnce("https://new.example.test/v1/")
      .mockResolvedValueOnce("model"),
    askSecret: mock().mockResolvedValue(" "),
    askConfirm: mock().mockResolvedValue(false),
  });
  await new Settings(ui, { ...dependencies, read: async () => ({ ai: existing }), write }).run();
  expect(ui.askText).toHaveBeenCalledWith(
    "Base URL:",
    "https://api.example.com/v1",
    existing.baseUrl,
  );
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("without credentials"));
  expect(ui.askSecret).toHaveBeenCalledWith("API key:");
  expect(write).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        baseUrl: "https://new.example.test/v1",
        apiKey: "",
        enabled: false,
      }),
    }),
  );
});

test("an invalid connection or non-Error failure never reports a successful connection test", async () => {
  for (const connection of [null, FULL_AI]) {
    const testConnection = mock().mockRejectedValue("offline");
    const ui = createUIMock({
      askSelect: mock()
        .mockResolvedValueOnce("ai")
        .mockResolvedValueOnce("configure")
        .mockResolvedValue("openai"),
      askText: mock().mockResolvedValue("model"),
      askSecret: mock().mockResolvedValue(""),
      askConfirm: mock().mockResolvedValue(true),
    });
    await new Settings(ui, {
      ...dependencies,
      resolveConnection: () => connection,
      testConnection,
    }).run();
    expect(testConnection).toHaveBeenCalledTimes(connection ? 1 : 0);
    expect(ui.warn).toHaveBeenCalledWith(
      connection ? "Connection failed: unknown error" : "Connection failed: Invalid AI connection",
    );
    expect(ui.success).not.toHaveBeenCalledWith("Connection successful!");
  }
});

test("ignores unavailable providers and profiles and does not write when selection is empty", async () => {
  for (const [action, choice] of [
    ["configure", "missing"],
    ["switch", "constructor"],
    ["remove", ""],
    ["save", ""],
  ]) {
    const write = mock(async () => {});
    const ui = createUIMock({
      askSelect: mock()
        .mockResolvedValueOnce("ai")
        .mockResolvedValueOnce(action)
        .mockResolvedValue(choice),
      askText: mock().mockResolvedValue("  "),
      askMultiSelect: mock().mockResolvedValue([]),
    });
    await new Settings(ui, { ...dependencies, read: async () => ({ ai: FULL_AI }), write }).run();
    expect(write).not.toHaveBeenCalled();
  }
});

test("requires a configured AI connection before saving a profile", async () => {
  const write = mock(async () => {});
  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("save"),
  });
  await new Settings(ui, { ...dependencies, read: async () => ({}), write }).run();
  expect(ui.warn).toHaveBeenCalledWith("Configure an AI provider before saving it as a profile.");
  expect(ui.askText).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test("effective settings identify a project-specific branch prefix", async () => {
  const ui = createUIMock({ askSelect: async () => "effective" });
  await new Settings(ui, {
    ...dependencies,
    read: async () => ({ branchPrefixes: ["work"] }),
    readRepository: async () => ({ branchPrefixes: ["team"] }),
  }).run();
  expect(ui.info).toHaveBeenCalledWith(
    expect.stringContaining("Branch prefixes: team (.gittenrc)"),
  );
});
