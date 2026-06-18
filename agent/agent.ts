import { defineAgent } from "eve";

const DEFAULT_MODEL = "openai/gpt-5-nano";

export default defineAgent({
  // Keep the small gateway model as the default for low-cost, low-latency portfolio Q&A.
  model: DEFAULT_MODEL,
});
