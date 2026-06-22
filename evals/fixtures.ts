import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { SendTurnPayload } from "eve/client";
import { loadJson } from "eve/evals/loaders";
import { z } from "zod";

export const EXPECTED_FIXTURE_IDS = [
  "general",
  "recruiter-contact",
  "agent-mcp-work",
  "trading-finance-automation",
  "ios-product-work",
  "shipped-client-work",
  "project-page-agentic-trader",
] as const;

export type GroundingFixtureId = (typeof EXPECTED_FIXTURE_IDS)[number];

const MAX_FIXTURE_BYTES = 50000;
const MAX_PROJECTS_PER_FIXTURE = 4;

const LinkTupleSchema = z.tuple([z.string().min(1), z.string().min(1)]);

const ProjectSummarySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    area: z.string().min(1),
    status: z.tuple([z.string().min(1), z.string().min(1)]),
    year: z.number().int(),
    activity: z.string(),
    line: z.string().min(1),
    wip: z.boolean(),
    money: z.boolean(),
    links: z.array(LinkTupleSchema),
    metrics: z.array(z.string()),
    about: z.array(z.string()),
    notes: z.array(z.string()),
    stack: z.array(z.string()),
  })
  .strict();

const ResumeTrackSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    role: z.string().min(1),
    when: z.string().min(1),
    current: z.boolean(),
    about: z.array(z.string()),
    notes: z.array(z.string()),
    credits: z.array(LinkTupleSchema),
    era: z.string(),
  })
  .strict();

const GroundingPacketSchema = z
  .object({
    version: z.literal(1),
    source: z.literal("portfolio-site-canonical-data"),
    focus: z.enum(["projects", "resume", "contact", "current", "general"]),
    projects: z.array(ProjectSummarySchema).max(MAX_PROJECTS_PER_FIXTURE),
    resume: z
      .object({
        title: z.string().min(1),
        line: z.string().min(1),
        about: z.string(),
        tracks: z.array(ResumeTrackSchema),
      })
      .strict(),
    remoteCall: z
      .object({
        required: z.boolean(),
        reason: z.string().min(1),
      })
      .strict(),
    contact: z
      .object({
        email: z.string().email(),
        location: z.string().min(1),
        status: z.string().min(1),
        resumeHref: z.string().min(1),
        links: z.array(LinkTupleSchema).min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const GroundingFixtureSchema = z
  .object({
    id: z.enum(EXPECTED_FIXTURE_IDS),
    label: z.string().min(1),
    message: z.string().min(1),
    context: z
      .object({
        projectIds: z.array(z.string()).optional(),
        resumeTrackIds: z.array(z.string()).optional(),
      })
      .strict(),
    route: z.string().optional(),
    packet: GroundingPacketSchema,
  })
  .strict();

const GroundingFixtureSetSchema = z
  .object({
    version: z.literal(1),
    source: z.literal("portfolio-site-canonical-data"),
    generatedFrom: z.tuple([z.literal("src/data/catalog.ts"), z.literal("src/data/resume.ts")]),
    fixtures: z.array(GroundingFixtureSchema).length(EXPECTED_FIXTURE_IDS.length),
  })
  .strict()
  .superRefine((fixtureSet, ctx) => {
    const ids = fixtureSet.fixtures.map((fixture) => fixture.id);
    if (ids.join(",") !== EXPECTED_FIXTURE_IDS.join(",")) {
      ctx.addIssue({
        code: "custom",
        message: `Expected fixture ids ${EXPECTED_FIXTURE_IDS.join(", ")}, got ${ids.join(", ")}`,
      });
    }
  });

export type GroundingFixture = z.infer<typeof GroundingFixtureSchema>;

export interface FitCheckContext {
  kind: "job-description";
  jobDescription: string;
  originalLength: number;
  truncated: boolean;
}

const fixturePath = join(process.cwd(), "evals/data/grounding-fixtures.json");
const fixtureStats = await stat(fixturePath);

if (fixtureStats.size > MAX_FIXTURE_BYTES) {
  throw new Error(`Grounding fixture snapshot is ${fixtureStats.size} bytes; max is ${MAX_FIXTURE_BYTES}.`);
}

const fixtureSet = GroundingFixtureSetSchema.parse(await loadJson("evals/data/grounding-fixtures.json"));

export function getFixture(id: GroundingFixtureId): GroundingFixture {
  const fixture = fixtureSet.fixtures.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Missing grounding fixture: ${id}`);
  }
  return fixture;
}

export function groundedPrompt(fixture: GroundingFixture, question = fixture.message): string {
  const contextJson = JSON.stringify(
    {
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      route: fixture.route,
      context: fixture.context,
      packet: fixture.packet,
    },
    null,
    2,
  );

  return [
    "Use only the following bounded portfolio site context for factual claims.",
    "If the answer is not supported by this context, say you do not know from the available site data.",
    "Keep the answer concise and use Dylan/third-person voice for Dylan's work.",
    "",
    "SITE_CONTEXT_JSON:",
    contextJson,
    "",
    `Visitor question: ${question}`,
  ].join("\n");
}

export function fitCheckTurn(
  fixture: GroundingFixture,
  jobDescription: string,
  question = "How does Dylan fit this role based on the supplied portfolio context?",
): SendTurnPayload {
  const fitCheck: FitCheckContext = {
    kind: "job-description",
    jobDescription,
    originalLength: jobDescription.length,
    truncated: false,
  };

  const clientContext = JSON.parse(
    JSON.stringify({
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      route: fixture.route,
      context: {
        ...fixture.context,
        fitCheck,
      },
      packet: fixture.packet,
    }),
  ) as SendTurnPayload["clientContext"];

  return {
    message: [
      "The visitor is asking for a fit-check against bounded job-description context supplied by the site.",
      "Use only the client context and portfolio grounding for factual claims. Do not echo the pasted job description.",
      `Visitor question: ${question}`,
    ].join("\n"),
    clientContext,
  };
}

export function requireAny(reply: string | null, patterns: readonly RegExp[], label: string): void {
  const text = reply ?? "";
  if (!patterns.some((pattern) => pattern.test(text))) {
    throw new Error(`Expected reply to include ${label}. Reply: ${text}`);
  }
}

export function rejectPattern(reply: string | null, pattern: RegExp, label: string): void {
  const text = reply ?? "";
  if (pattern.test(text)) {
    throw new Error(`Expected reply not to include ${label}. Reply: ${text}`);
  }
}
