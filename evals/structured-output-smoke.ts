import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import {
  assertStructuredAnswerMatchesGrounding,
  collectGroundingReferences,
  DM_STRUCTURED_ANSWER_OUTPUT_JSON_SCHEMA,
  type DmStructuredAnswerOutput,
} from "../agent/answer-blocks.js";

interface SmokeCase {
  name: string;
  grounding: unknown;
  output: DmStructuredAnswerOutput;
}

const contactGrounding = {
  version: 1,
  source: "portfolio-site-canonical-data",
  focus: "contact",
  projects: [
    {
      id: "agentic-trader",
      links: [["Project page", "/projects/agentic-trader"]],
    },
    {
      id: "bellas-beads",
      links: [["Project page", "/projects/bellas-beads"]],
    },
  ],
  resume: {
    tracks: [{ id: "now" }],
  },
  contact: {
    resumeHref: "/resume.pdf",
    links: [
      ["Email Dylan", "mailto:dylanmccavitt@outlook.com"],
      ["Resume PDF", "/resume.pdf"],
      ["Hiring tour", "/hiring"],
    ],
  },
};

const projectGrounding = {
  version: 1,
  source: "portfolio-site-canonical-data",
  focus: "projects",
  projects: [
    {
      id: "agentic-trader",
      links: [["Project page", "/projects/agentic-trader"]],
    },
    {
      id: "tradingview-mcp",
      links: [["Project page", "/projects/tradingview-mcp"]],
    },
    {
      id: "evalgate",
      links: [["Project page", "/projects/evalgate"]],
    },
  ],
  resume: {
    tracks: [],
  },
};

const resumeGrounding = {
  version: 1,
  source: "portfolio-site-canonical-data",
  focus: "resume",
  projects: [],
  resume: {
    tracks: [{ id: "now" }, { id: "education" }],
  },
};

const smokeCases: SmokeCase[] = [
  {
    name: "recruiter",
    grounding: contactGrounding,
    output: {
      status: "matched",
      answerBlocks: [
        { kind: "text", text: "Dylan's strongest evidence is practical shipped software plus agent-system work." },
        { kind: "projects", ids: ["agentic-trader", "bellas-beads"] },
        { kind: "resume", trackIds: ["now"] },
        { kind: "contact" },
      ],
    },
  },
  {
    name: "project",
    grounding: projectGrounding,
    output: {
      status: "matched",
      answerBlocks: [
        { kind: "text", text: "For agent and MCP work, start with these grounded project artifacts." },
        { kind: "projects", ids: ["agentic-trader", "tradingview-mcp", "evalgate"] },
        { kind: "links", items: [["Project page", "/projects/agentic-trader"]] },
      ],
    },
  },
  {
    name: "resume",
    grounding: resumeGrounding,
    output: {
      status: "matched",
      answerBlocks: [
        { kind: "text", text: "Use the grounded resume tracks for background and current focus." },
        { kind: "resume", trackIds: ["now", "education"] },
      ],
    },
  },
  {
    name: "contact",
    grounding: contactGrounding,
    output: {
      status: "matched",
      answerBlocks: [
        { kind: "contact" },
        {
          kind: "links",
          items: [
            ["Email Dylan", "mailto:dylanmccavitt@outlook.com"],
            ["Resume PDF", "/resume.pdf"],
          ],
        },
      ],
    },
  },
  {
    name: "unknown",
    grounding: {
      version: 1,
      source: "portfolio-site-canonical-data",
      focus: "general",
      projects: [],
      resume: { tracks: [] },
    },
    output: {
      status: "no_match",
      answerBlocks: [],
      reason: "The available portfolio context does not include a supported block for this question.",
    },
  },
];

assert.equal(
  typeof DM_STRUCTURED_ANSWER_OUTPUT_JSON_SCHEMA,
  "object",
  "The structured output contract should be usable as JSON Schema by Eve clients.",
);

for (const smokeCase of smokeCases) {
  assert.doesNotThrow(
    () => assertStructuredAnswerMatchesGrounding(smokeCase.output, smokeCase.grounding),
    `${smokeCase.name} structured answer should validate against its grounding context`,
  );
}

assert.deepEqual(collectGroundingReferences(projectGrounding).projectIds, [
  "agentic-trader",
  "tradingview-mcp",
  "evalgate",
]);

assert.throws(
  () =>
    assertStructuredAnswerMatchesGrounding(
      {
        status: "matched",
        answerBlocks: [{ kind: "projects", ids: ["invented-project"] }],
      },
      projectGrounding,
    ),
  /unknown project ids/,
);

assert.throws(
  () =>
    assertStructuredAnswerMatchesGrounding(
      {
        status: "matched",
        answerBlocks: [{ kind: "resume", trackIds: ["invented-track"] }],
      },
      resumeGrounding,
    ),
  /unknown resume track ids/,
);

assert.throws(
  () =>
    assertStructuredAnswerMatchesGrounding(
      {
        status: "matched",
        answerBlocks: [{ kind: "links", items: [["Unsafe", "javascript:alert(1)"]] }],
      },
      contactGrounding,
    ),
  /unsafe href/,
);

const agentSource = readFileSync("agent/agent.ts", "utf8");
assert.equal(
  /\boutputSchema\b/.test(agentSource),
  false,
  "Plain chat should remain the default; clients must request structured output per turn.",
);

console.log(`structured-output smoke passed (${smokeCases.length} representative cases)`);
