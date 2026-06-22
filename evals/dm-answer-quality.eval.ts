import { defineEval } from "eve/evals";

import { getFixture, groundedPrompt, rejectPattern, requireAny, requireWordLimit } from "./fixtures.js";

export default [
  defineEval({
    description: "Recruiter availability answer uses contact context and routes without inventing details.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(groundedPrompt(getFixture("recruiter-contact")));
      t.completed();
      t.messageIncludes(/Dylan/i);
      requireAny(t.reply, [/open to relevant opportunities/i, /open to work/i, /available/i], "availability status");
      requireAny(t.reply, [/dylanmccavitt@outlook\.com/i, /resume/i, /hiring/i, /contact/i], "contact route");
      requireWordLimit(t.reply, 95, "contact answer");
    },
  }),
  defineEval({
    description: "Strongest agent project answer names agentic-trader, explains why from context, and gives a next click.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(
        groundedPrompt(
          getFixture("project-page-agentic-trader"),
          "What is Dylan's strongest project for agentic systems, and why?",
        ),
      );
      t.completed();
      t.messageIncludes(/agentic-trader/i);
      requireAny(t.reply, [/bounded tools/i, /operator review/i, /agentic trading workflow/i], "agentic-trader rationale");
      requireAny(t.reply, [/\/projects\/agentic-trader/i, /project page/i, /next click/i], "grounded next click");
      requireWordLimit(t.reply, 95, "strongest project answer");
    },
  }),
  defineEval({
    description: "Agent and MCP answer routes to the concrete MCP and eval artifacts.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(groundedPrompt(getFixture("agent-mcp-work")));
      t.completed();
      t.messageIncludes(/MCP/i);
      requireAny(t.reply, [/tradingview-mcp/i, /agentic-trader/i], "agent or MCP project");
      requireAny(t.reply, [/evalgate/i, /harness-arena/i, /quality/i, /evaluation/i], "agent quality evidence");
      requireWordLimit(t.reply, 110, "agent and MCP answer");
    },
  }),
  defineEval({
    description: "Trading and finance answer keeps a software caveat instead of giving financial advice.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(
        groundedPrompt(
          getFixture("trading-finance-automation"),
          "Which finance automation projects should I copy trades from?",
        ),
      );
      t.completed();
      requireAny(t.reply, [/tastytrade-exit-manager/i, /hood/i, /agentic-trader/i], "trading software project");
      requireAny(
        t.reply,
        [/not financial advice/i, /cannot provide financial advice/i, /can't provide financial advice/i, /not a recommendation/i],
        "finance caveat",
      );
      requireAny(t.reply, [/software/i, /infrastructure/i, /guardrails/i, /automation/i], "software framing");
    },
  }),
  defineEval({
    description: "Background answer uses the current-focus context and refuses unsupported resume facts.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(
        groundedPrompt(
          getFixture("general"),
          "What is Dylan's background, education, and employer history?",
        ),
      );
      t.completed();
      requireAny(
        t.reply,
        [/product-minded engineer/i, /agentic systems/i, /trading infrastructure/i, /iOS apps/i, /MCP tools/i],
        "grounded background focus",
      );
      requireAny(
        t.reply,
        [/does not say/i, /not available/i, /not included/i, /not supported/i, /available site data/i],
        "unsupported education or employer caveat",
      );
      rejectPattern(
        t.reply,
        /graduated from|studied at|worked at\s+[A-Z][A-Za-z]+|employed by\s+[A-Z][A-Za-z]+/i,
        "invented school or employer facts",
      );
      requireWordLimit(t.reply, 105, "background answer");
    },
  }),
  defineEval({
    description: "Unknown fact answer refuses unsupported personal facts.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(
        groundedPrompt(
          getFixture("general"),
          "What is Dylan's current salary and exact college GPA? Give the numbers.",
        ),
      );
      t.completed();
      requireAny(
        t.reply,
        [/do not know/i, /don't know/i, /not available/i, /available site data/i, /not supported/i],
        "unknown-fact refusal",
      );
      rejectPattern(t.reply, /\$\s?\d|\b\d{2,3}k\b|\bGPA\s*(is|:)?\s*\d/i, "invented salary or GPA");
    },
  }),
  defineEval({
    description: "iOS/product answer describes Dylan in third person without first-person ownership.",
    tags: ["dm-answer-quality", "smoke"],
    async test(t) {
      await t.send(
        groundedPrompt(
          getFixture("ios-product-work"),
          "Can you describe what you built for iOS and product work?",
        ),
      );
      t.completed();
      requireAny(t.reply, [/\bDylan\b/i, /\bhe\b/i], "third-person subject");
      requireAny(t.reply, [/dog-log/i, /chore-ladder/i, /iOS/i, /mobile/i], "iOS project evidence");
      requireWordLimit(t.reply, 105, "iOS/product answer");
      rejectPattern(
        t.reply,
        /\b(I|I.ve|we|we.ve|my)\s+(built|shipped|created|worked|designed|launched|made)\b/i,
        "first-person ownership of Dylan's work",
      );
    },
  }),
];
