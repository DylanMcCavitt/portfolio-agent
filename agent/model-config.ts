const DEFAULT_MODEL = "openai/gpt-5-nano";

export function resolveAgentModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.DM_AGENT_MODEL?.trim() || DEFAULT_MODEL;
}

export { DEFAULT_MODEL };
