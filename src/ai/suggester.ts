import { normalizeAIBaseUrl } from "../core/domain/ai-endpoint";
import type { AIConfig } from "../core/domain/preferences";
import type { BranchType } from "../core/ports/ui.port";
import { shareableDiff } from "./shareable-diff";

const CALL_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

const MAX_TOKENS = {
  branch: 60,
  commit: 120,
  amend: 120,
  review: 500,
  gitignore: 300,
  explain: 80,
  summarize: 200,
  conflict: 200,
  test: 5,
} as const;

const BRANCH_SYSTEM_PROMPT = `You are a git branch name slug generator. Given a branch type and description, output a concise slug.

Rules:
- Output ONLY the slug — no type prefix, no explanation
- Lowercase letters, numbers, and hyphens only
- Maximum 40 characters
- Be concise — remove filler words, abbreviate where obvious
- Example: type=feat, description="add user authentication with google oauth" → "oauth-user-auth"`;

const COMMIT_SYSTEM_PROMPT = `You are a git commit message generator. Given a staged diff, output a single conventional commit message.

Rules:
- Format: type: description  (e.g. "feat: add user login")
- Types: feat, fix, chore, docs, refactor, test, style
- Max 72 characters total
- Lowercase, imperative mood
- No period at the end
- Output ONLY the commit message — nothing else`;

const AMEND_SYSTEM_PROMPT = `You are a git commit message improver. Given an existing commit message, rewrite it to follow conventional commits format.

Rules:
- Format: type: description  (e.g. "feat: add user login")
- Types: feat, fix, chore, docs, refactor, test, style
- Max 72 characters total
- Lowercase, imperative mood
- No period at the end
- Keep the same intent, just fix the format and wording
- Output ONLY the improved commit message — nothing else`;

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Given a staged git diff, identify concrete issues only.

Rules:
- Report only real problems: bugs, hardcoded secrets or values, missing error handling, obvious security issues, forgotten TODOs/FIXMEs
- One finding per line, no numbering, no bullet points
- Max 5 findings
- If nothing is wrong, output exactly: OK
- Be brief — max 10 words per finding`;

const GITIGNORE_SYSTEM_PROMPT = `You are a .gitignore expert. Given a list of tracked files and the current .gitignore content, suggest additional patterns that should be ignored for this project.

Rules:
- Output one pattern per line
- Only suggest patterns not already in the .gitignore
- Focus on secrets, build artifacts, IDE files, OS files
- Output ONLY the patterns — no explanation, no blank lines`;

export async function suggestBranchName(
  type: BranchType,
  description: string,
  config: AIConfig,
): Promise<string | null> {
  return callAI(
    BRANCH_SYSTEM_PROMPT,
    `Type: ${type}\nDescription: ${description}`,
    config,
    MAX_TOKENS.branch,
  );
}

export async function suggestCommitMessage(diff: string, config: AIConfig): Promise<string | null> {
  const truncated = shareableDiff(diff);
  return callAI(
    COMMIT_SYSTEM_PROMPT,
    `Staged diff:\n\`\`\`\n${truncated}\n\`\`\``,
    config,
    MAX_TOKENS.commit,
  );
}

export async function suggestAmendMessage(
  currentMessage: string,
  config: AIConfig,
): Promise<string | null> {
  return callAI(
    AMEND_SYSTEM_PROMPT,
    `Existing message: ${currentMessage}`,
    config,
    MAX_TOKENS.amend,
  );
}

export async function reviewStagedDiff(diff: string, config: AIConfig): Promise<string[]> {
  const truncated = shareableDiff(diff);
  const result = await callAI(
    REVIEW_SYSTEM_PROMPT,
    `Staged diff:\n\`\`\`\n${truncated}\n\`\`\``,
    config,
    MAX_TOKENS.review,
  );
  if (!result) throw new Error("AI returned an empty review");
  if (result === "OK") return [];
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function suggestGitignorePatterns(
  trackedFiles: string[],
  existingPatterns: string[],
  config: AIConfig,
): Promise<string[]> {
  const prompt = `Tracked files:\n${trackedFiles.slice(0, 100).join("\n")}\n\nCurrent .gitignore:\n${existingPatterns.join("\n")}`;
  const result = await callAI(GITIGNORE_SYSTEM_PROMPT, prompt, config, MAX_TOKENS.gitignore);
  if (!result) return [];
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const EXPLAIN_COMMIT_SYSTEM_PROMPT = `You are a git commit analyst. Given a commit diff, explain in one concise sentence what it does and why.

Rules:
- One sentence, max 80 characters
- Start with a verb (e.g. "Fixes", "Adds", "Removes", "Refactors")
- Focus on intent, not mechanics
- Output ONLY the explanation — nothing else`;

const SUMMARIZE_COMMITS_SYSTEM_PROMPT = `You are a changelog generator. Given a list of commit messages, produce a concise bullet-point summary.

Rules:
- Max 5 bullets, using "•" as the bullet character
- Group related changes together
- Focus on user-facing impact
- Omit trivial chore/style commits unless they are the only ones
- Output ONLY the bullet points — no headers, no blank lines`;

export async function explainCommitDiff(diff: string, config: AIConfig): Promise<string | null> {
  const truncated = shareableDiff(diff);
  return callAI(
    EXPLAIN_COMMIT_SYSTEM_PROMPT,
    `Commit diff:\n\`\`\`\n${truncated}\n\`\`\``,
    config,
    MAX_TOKENS.explain,
  );
}

const EXPLAIN_CONFLICT_SYSTEM_PROMPT = `You are a git merge-conflict assistant. Given a diff containing conflict markers (<<<<<<<, =======, >>>>>>>), explain the conflict so the user can resolve it themselves.

Rules:
- Do NOT output resolved code or pick a side for the user
- For each conflicted area: one line on what each side changed
- End with one short line suggesting how to reconcile them
- Max 6 lines total, plain text, no code blocks
- Be concise and concrete`;

export async function explainConflict(diff: string, config: AIConfig): Promise<string | null> {
  const truncated = shareableDiff(diff);
  return callAI(
    EXPLAIN_CONFLICT_SYSTEM_PROMPT,
    `Conflict diff:\n\`\`\`\n${truncated}\n\`\`\``,
    config,
    MAX_TOKENS.conflict,
  );
}

export async function summarizeCommits(
  messages: string[],
  config: AIConfig,
): Promise<string | null> {
  const prompt = messages.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return callAI(
    SUMMARIZE_COMMITS_SYSTEM_PROMPT,
    `Commit messages:\n${prompt}`,
    config,
    MAX_TOKENS.summarize,
  );
}

export async function testAIConnection(config: AIConfig): Promise<void> {
  const reply = await callAI(
    "Reply with exactly: OK",
    "Test",
    { ...config, enabled: true },
    MAX_TOKENS.test,
  );
  if (reply !== "OK") throw new Error("AI did not return the expected test response");
}

async function callAI(
  systemPrompt: string,
  userMessage: string,
  config: AIConfig,
  maxTokens: number,
): Promise<string | null> {
  if (!config.enabled) throw new Error("AI suggestions are disabled.");
  const endpoint = normalizeAIBaseUrl(config.baseUrl);
  if (!endpoint) throw new Error("Invalid AI endpoint");
  const url = `${endpoint}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  try {
    const request = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    };
    const headers = new Headers({ "Content-Type": "application/json" });
    if (config.apiKey) headers.set("Authorization", `Bearer ${config.apiKey}`);
    const response = await requestAI(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers,
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(classifyHttpError(response.status));
    }
    return await readReply(response);
  } catch (err) {
    if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw new Error(`AI request timed out after ${CALL_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function requestAI(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
    throw new Error("Network error while contacting the AI provider");
  }
}

async function readReply(response: Response): Promise<string | null> {
  return parseReply(await readResponseBody(response));
}

async function readResponseBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI provider returned an empty response body");
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("AI response exceeds the size limit");
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return body + decoder.decode();
}

function parseReply(body: string): string | null {
  let data: { choices?: { message?: { content?: unknown } }[]; error?: unknown } | null;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
  if (data?.error) throw new Error("AI provider returned an error");

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI provider returned an invalid response");
  return content.trim() || null;
}

function classifyHttpError(status: number): string {
  if (status >= 300 && status < 400)
    return "AI provider redirected the request. Check its endpoint.";
  switch (status) {
    case 401:
      return "Invalid API key — check your credentials in Settings";
    case 403:
      return "Access denied — verify your API key has the right permissions";
    case 404:
      return "Model not found — check the model name in Settings";
    case 429:
      return "Rate limit hit — wait a moment and try again";
    case 500:
    case 502:
    case 503:
      return `Provider error (${status}) — the AI service may be down`;
    default:
      return `HTTP ${status}`;
  }
}
