import { defineAgent } from "eve";

import { resolveAgentModel } from "./model-config.js";

export default defineAgent({
  // Keep DM model selection in agent config/env, not in the portfolio site.
  model: resolveAgentModel(),
});
