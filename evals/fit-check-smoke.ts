import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import type { SendTurnPayload } from "eve/client";

import { fitCheckTurn, getFixture } from "./fixtures.js";

const jobDescription = [
  "We are hiring an agent systems engineer for TypeScript automation, MCP tooling,",
  "operator review, evaluation gates, and shipped workflow software.",
].join(" ");

const payload = fitCheckTurn(getFixture("recruiter-contact"), jobDescription);
const objectPayload = payload as SendTurnPayload;

assert.equal(typeof objectPayload.message, "string", "fit-check turn should send a visible message.");
assert.ok(
  !String(objectPayload.message).includes(jobDescription),
  "visible fit-check message should not contain the pasted job description.",
);

const clientContext = objectPayload.clientContext as {
  context?: {
    fitCheck?: {
      kind?: unknown;
      jobDescription?: unknown;
      originalLength?: unknown;
      truncated?: unknown;
    };
  };
};

assert.equal(clientContext.context?.fitCheck?.kind, "job-description");
assert.equal(clientContext.context?.fitCheck?.jobDescription, jobDescription);
assert.equal(clientContext.context?.fitCheck?.originalLength, jobDescription.length);
assert.equal(clientContext.context?.fitCheck?.truncated, false);

const instructions = readFileSync("agent/instructions.md", "utf8");

for (const pattern of [
  /# Fit-Check Requests/,
  /context\.fitCheck/,
  /Fit summary/,
  /Strongest evidence/,
  /Gaps\/unknowns/,
  /Relevant projects\/resume evidence/,
  /Next contact step/,
  /do not echo the full pasted job description/i,
  /Do not assign a numeric score/i,
  /Do not give employment, legal, or compliance advice/i,
  /Outside those turns, keep the normal concise portfolio Q&A behavior/i,
]) {
  assert.match(instructions, pattern, `instructions should include ${pattern}`);
}

console.log("fit-check smoke passed");
