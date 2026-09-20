export function helpProvider(values: Record<string, string | undefined>) {
  // Explicit selection never silently sends a conversation to another provider.
  const provider = (values.AI_PROVIDER || (values.ANTHROPIC_API_KEY ? 'anthropic' : 'openai')).trim().toLowerCase();
  if (provider === 'anthropic') return {
    provider: 'anthropic' as const, label: 'Anthropic (Claude)',
    apiKey: values.ANTHROPIC_API_KEY, model: values.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  };
  if (provider === 'openai') return {
    provider: 'openai' as const, label: 'OpenAI',
    apiKey: values.OPENAI_API_KEY, model: values.OPENAI_MODEL || 'gpt-4.1-mini',
  };
  return { provider: 'anthropic' as const, label: 'No valid provider selected', apiKey: undefined, model: undefined };
}
