export interface AIProvider {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    requiresKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    requiresKey: true,
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    requiresKey: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    requiresKey: true,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
    requiresKey: true,
  },
  {
    id: "ollama",
    label: "Ollama (local, no key needed)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    requiresKey: false,
  },
  {
    id: "custom",
    label: "Custom…",
    baseUrl: "",
    defaultModel: "",
    requiresKey: true,
  },
];
