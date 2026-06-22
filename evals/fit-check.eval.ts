import { defineEval } from "eve/evals";

import { fitCheckTurn, getFixture, groundedPrompt, rejectPattern, requireAny } from "./fixtures.js";

const strongFitJobDescription = [
  "We are hiring a senior agent systems engineer to build TypeScript automation around bounded tools,",
  "operator review, MCP integrations, and evaluation gates for practical workflow software.",
  "The role values product-minded communication, shipped client-facing work, and careful guardrails",
  "over demo-only chatbot projects.",
].join(" ");

const partialFitJobDescription = [
  "We are hiring a mobile product engineer focused on SwiftUI, everyday consumer workflows,",
  "App Store operations, subscription analytics, and leading a small iOS team.",
  "The work requires polished product thinking plus evidence of production mobile delivery.",
].join(" ");

const insufficientEvidenceJobDescription = [
  "We are hiring a staff platform SRE to own Kubernetes reliability, Terraform infrastructure,",
  "SOC 2 controls, Go services, incident command, on-call rotations, and multi-year engineering management.",
].join(" ");

const forbiddenFitLanguage =
  /(\b\d{1,3}\s?%|\b\d(?:\.\d)?\s?\/\s?10\b|\b(fit score|match score|guaranteed fit|guarantee|should hire|must hire|should reject|do not hire|employment law|legal advice)\b)/i;

export default [
  defineEval({
    description: "Strong-fit JD receives a grounded fit summary with evidence, gaps, and contact route.",
    tags: ["dm-fit-check", "smoke"],
    async test(t) {
      await t.send(fitCheckTurn(getFixture("recruiter-contact"), strongFitJobDescription));
      t.completed();
      requireAny(t.reply, [/strong fit/i, /strong evidence/i, /well aligned/i, /good fit/i], "fit summary");
      requireAny(t.reply, [/agentic-trader/i, /bounded tools/i, /operator review/i, /MCP/i], "agent evidence");
      requireAny(t.reply, [/Bella.s Beads/i, /shipped/i, /client/i], "shipped client evidence");
      requireAny(t.reply, [/gap/i, /unknown/i, /not available/i, /not shown/i], "gaps or unknowns");
      requireAny(t.reply, [/resume/i, /contact/i, /Email Dylan/i, /dylanmccavitt@outlook\.com/i], "next contact step");
      rejectPattern(t.reply, forbiddenFitLanguage, "score, guarantee, or employment/legal advice");
      rejectPattern(t.reply, /We are hiring a senior agent systems engineer[^.]{80,}/i, "full job description echo");
    },
  }),
  defineEval({
    description: "Partial-fit JD separates mobile evidence from unsupported role requirements.",
    tags: ["dm-fit-check", "smoke"],
    async test(t) {
      await t.send(fitCheckTurn(getFixture("ios-product-work"), partialFitJobDescription));
      t.completed();
      requireAny(t.reply, [/partial fit/i, /some evidence/i, /some alignment/i, /mixed fit/i], "partial fit summary");
      requireAny(t.reply, [/dog-log/i, /chore-ladder/i, /SwiftUI/i, /mobile/i], "mobile evidence");
      requireAny(
        t.reply,
        [/App Store/i, /subscription/i, /analytics/i, /team/i, /lead/i, /unknown/i, /not shown/i, /not available/i],
        "unsupported mobile requirements",
      );
      requireAny(t.reply, [/gap/i, /unknown/i, /not shown/i, /not available/i, /not supported/i], "gap framing");
      rejectPattern(t.reply, forbiddenFitLanguage, "score, guarantee, or employment/legal advice");
      rejectPattern(t.reply, /We are hiring a mobile product engineer[^.]{80,}/i, "full job description echo");
    },
  }),
  defineEval({
    description: "Insufficient-evidence JD refuses to infer unsupported platform/SRE qualifications.",
    tags: ["dm-fit-check", "smoke"],
    async test(t) {
      await t.send(fitCheckTurn(getFixture("general"), insufficientEvidenceJobDescription));
      t.completed();
      requireAny(
        t.reply,
        [/insufficient evidence/i, /not enough evidence/i, /not supported/i, /do not know/i, /don't know/i],
        "insufficient evidence summary",
      );
      requireAny(t.reply, [/available site data/i, /portfolio context/i, /site context/i, /grounding/i], "grounding caveat");
      rejectPattern(
        t.reply,
        /Dylan (has|brings|offers|shows|demonstrates)[^.]{0,80}(Kubernetes|Terraform|SOC 2|Go services|incident command|on-call|engineering management)|experience (with|in)[^.]{0,80}(Kubernetes|Terraform|SOC 2|Go services|incident command|on-call|engineering management)/i,
        "invented platform/SRE evidence",
      );
      rejectPattern(t.reply, forbiddenFitLanguage, "score, guarantee, or employment/legal advice");
      rejectPattern(t.reply, /We are hiring a staff platform SRE[^.]{80,}/i, "full job description echo");
    },
  }),
  defineEval({
    description: "Plain portfolio Q&A does not switch into fit-check formatting without job context.",
    tags: ["dm-fit-check", "smoke"],
    async test(t) {
      await t.send(
        groundedPrompt(getFixture("agent-mcp-work"), "What should I look at for Dylan's agent and MCP work?"),
      );
      t.completed();
      requireAny(t.reply, [/agentic-trader/i, /tradingview-mcp/i], "agent/MCP projects");
      rejectPattern(t.reply, /fit summary|strongest evidence|gaps\/unknowns|job description|role fit/i, "fit-check sections");

      const wordCount = (t.reply ?? "").trim().split(/\s+/).filter(Boolean).length;
      if (wordCount > 110) {
        throw new Error(`Expected concise plain Q&A under 110 words, got ${wordCount}. Reply: ${t.reply ?? ""}`);
      }
    },
  }),
];
