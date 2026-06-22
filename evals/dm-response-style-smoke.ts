import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const instructions = readFileSync("agent/instructions.md", "utf8");
const examples = readFileSync("docs/dm-response-style-examples.md", "utf8");
const answerQualityEval = readFileSync("evals/dm-answer-quality.eval.ts", "utf8");

for (const pattern of [
  /# Response Style/,
  /Short answer/,
  /Evidence/,
  /Next click/,
  /Honest unknowns/,
  /software systems, automation, guardrails, risk controls, and research discipline/i,
  /cannot provide financial advice or recommendations/i,
  /Do not write as Dylan/i,
]) {
  assert.match(instructions, pattern, `instructions should include ${pattern}`);
}

const requiredSections = [
  "Strongest Project",
  "Hiring Fit",
  "Agent/MCP Work",
  "Trading/Finance Automation",
  "iOS/Product Work",
  "Background",
  "Contact",
  "Unknown Facts",
];

for (const sectionTitle of requiredSections) {
  const section = extractSection(examples, sectionTitle);
  assert.match(section, /Prompt:/, `${sectionTitle} should include a prompt`);
  assert.match(section, /Before:/, `${sectionTitle} should include a before example`);
  assert.match(section, /After:/, `${sectionTitle} should include an after example`);
}

assert.match(extractSection(examples, "Strongest Project"), /agentic-trader[\s\S]*\/projects\/agentic-trader/i);
assert.match(extractSection(examples, "Hiring Fit"), /agentic-trader[\s\S]*Bella's Beads/i);
assert.match(extractSection(examples, "Agent/MCP Work"), /tradingview-mcp[\s\S]*evalgate[\s\S]*harness-arena/i);
assert.match(extractSection(examples, "Trading/Finance Automation"), /cannot provide financial advice[\s\S]*guardrails/i);
assert.match(extractSection(examples, "iOS/Product Work"), /Dog Log[\s\S]*Chore Ladder[\s\S]*Swift\/SwiftUI/i);
assert.match(extractSection(examples, "Background"), /does not include school, employer, or credential details/i);
assert.match(extractSection(examples, "Contact"), /mailto:dylanmccavitt@outlook\.com[\s\S]*\/resume\.pdf[\s\S]*\/hiring/i);
assert.match(extractSection(examples, "Unknown Facts"), /does not include Dylan's salary or GPA/i);

for (const pattern of [
  /grounded next click/,
  /Background answer uses the current-focus context/,
  /requireWordLimit/,
]) {
  assert.match(answerQualityEval, pattern, `answer-quality eval should cover ${pattern}`);
}

console.log(`dm-response-style smoke passed (${requiredSections.length} before/after examples)`);

function extractSection(markdown: string, title: string): string {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`## ${escapedTitle}\\n([\\s\\S]*?)(?=\\n## |$)`));
  assert.ok(match, `Missing section: ${title}`);
  return match[1];
}
