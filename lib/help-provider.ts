export type HelpProvider = {
  provider: "anthropic" | "openai" | "foundry";
  label: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  apiVersion?: string;
};

export function helpProvider(values: Record<string, string | undefined>): HelpProvider {
  // Explicit selection never silently sends a conversation to another provider.
  const provider = (values.AI_PROVIDER || (values.FOUNDRY_API_KEY ? "foundry" : values.ANTHROPIC_API_KEY ? "anthropic" : "openai")).trim().toLowerCase();
  if (provider === "foundry") {
    return {
      provider: "foundry",
      label: "Microsoft Foundry",
      apiKey: values.FOUNDRY_API_KEY,
      model: values.FOUNDRY_AGENT_ID,
      endpoint: String(values.FOUNDRY_PROJECT_ENDPOINT ?? "").replace(/\/$/, ""),
      apiVersion: values.FOUNDRY_API_VERSION || "2025-05-01",
    };
  }
  if (provider === "anthropic") {
    return {
      provider: "anthropic",
      label: "Anthropic (Claude)",
      apiKey: values.ANTHROPIC_API_KEY,
      model: values.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    };
  }
  if (provider === "openai") {
    return {
      provider: "openai",
      label: "OpenAI",
      apiKey: values.OPENAI_API_KEY,
      model: values.OPENAI_MODEL || "gpt-4.1-mini",
    };
  }
  return { provider: "anthropic", label: "No valid provider selected", apiKey: undefined, model: undefined };
}
