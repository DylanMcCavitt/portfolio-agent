import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);

const textBlockSchema = z
  .object({
    kind: z.literal("text"),
    text: nonEmptyText.describe("Short prose suitable for the chat answer or answer panel."),
  })
  .strict();

const projectsBlockSchema = z
  .object({
    kind: z.literal("projects"),
    ids: z
      .array(nonEmptyText)
      .min(1)
      .max(6)
      .describe("Canonical project ids copied from the request grounding context."),
  })
  .strict();

const resumeBlockSchema = z
  .object({
    kind: z.literal("resume"),
    trackIds: z
      .array(nonEmptyText)
      .min(1)
      .max(6)
      .describe("Canonical resume track ids copied from the request grounding context."),
  })
  .strict();

const contactBlockSchema = z
  .object({
    kind: z.literal("contact"),
  })
  .strict();

const linkItemSchema = z.tuple([
  nonEmptyText.describe("Human-readable link label copied from grounding context when possible."),
  nonEmptyText.describe("Safe href copied from grounding context: relative, https, or mailto."),
]);

const linksBlockSchema = z
  .object({
    kind: z.literal("links"),
    items: z
      .array(linkItemSchema)
      .min(1)
      .max(6)
      .describe("Link tuples copied from canonical project or contact links in the grounding context."),
  })
  .strict();

export const DmAnswerBlockSchema = z.discriminatedUnion("kind", [
  textBlockSchema,
  projectsBlockSchema,
  resumeBlockSchema,
  contactBlockSchema,
  linksBlockSchema,
]);

const matchedStructuredAnswerSchema = z
  .object({
    status: z.literal("matched"),
    answerBlocks: z
      .array(DmAnswerBlockSchema)
      .min(1)
      .max(8)
      .describe("Remote answer-block suggestions. The portfolio site validates these before rendering."),
  })
  .strict();

const noMatchStructuredAnswerSchema = z
  .object({
    status: z.literal("no_match"),
    answerBlocks: z
      .array(DmAnswerBlockSchema)
      .max(0)
      .describe("No blocks should be suggested when the grounded context does not support the answer."),
    reason: nonEmptyText.describe("Brief explanation that the available site context did not support a block."),
  })
  .strict();

export const DmStructuredAnswerOutputSchema = z.discriminatedUnion("status", [
  matchedStructuredAnswerSchema,
  noMatchStructuredAnswerSchema,
]);

export const DM_STRUCTURED_ANSWER_OUTPUT_JSON_SCHEMA = z.toJSONSchema(DmStructuredAnswerOutputSchema);

export type DmAnswerBlock = z.infer<typeof DmAnswerBlockSchema>;
export type DmStructuredAnswerOutput = z.infer<typeof DmStructuredAnswerOutputSchema>;

export interface DmAnswerGroundingReferences {
  projectIds: readonly string[];
  resumeTrackIds: readonly string[];
  linkHrefs: readonly string[];
  contactAvailable: boolean;
}

export function assertStructuredAnswerMatchesGrounding(
  output: unknown,
  groundingContext: unknown,
): DmStructuredAnswerOutput {
  const parsed = DmStructuredAnswerOutputSchema.parse(output);
  const references = collectGroundingReferences(groundingContext);
  const projectIds = new Set(references.projectIds);
  const resumeTrackIds = new Set(references.resumeTrackIds);
  const linkHrefs = new Set(references.linkHrefs);

  if (parsed.status === "no_match") {
    return parsed;
  }

  for (const block of parsed.answerBlocks) {
    if (block.kind === "projects") {
      const unknownIds = block.ids.filter((id) => !projectIds.has(id));
      if (unknownIds.length > 0) {
        throw new Error(`Structured answer referenced unknown project ids: ${unknownIds.join(", ")}`);
      }
    }

    if (block.kind === "resume") {
      const unknownIds = block.trackIds.filter((id) => !resumeTrackIds.has(id));
      if (unknownIds.length > 0) {
        throw new Error(`Structured answer referenced unknown resume track ids: ${unknownIds.join(", ")}`);
      }
    }

    if (block.kind === "contact" && !references.contactAvailable) {
      throw new Error("Structured answer referenced contact without contact grounding.");
    }

    if (block.kind === "links") {
      for (const [, href] of block.items) {
        if (!isSafeHref(href)) {
          throw new Error(`Structured answer referenced unsafe href: ${href}`);
        }
        if (!linkHrefs.has(href)) {
          throw new Error(`Structured answer referenced unknown href: ${href}`);
        }
      }
    }
  }

  return parsed;
}

export function collectGroundingReferences(groundingContext: unknown): DmAnswerGroundingReferences {
  const projectIds = new Set<string>();
  const resumeTrackIds = new Set<string>();
  const linkHrefs = new Set<string>();
  let contactAvailable = false;

  const visit = (value: unknown): void => {
    if (!isRecord(value)) return;

    addStringArray(projectIds, value.projectIds);
    addStringArray(resumeTrackIds, value.resumeTrackIds);
    addProjectReferences(value.projects, projectIds, linkHrefs);
    addResumeReferences(value.resume, resumeTrackIds);

    if (isRecord(value.contact)) {
      contactAvailable = true;
      addLinkReferences(value.contact.links, linkHrefs);
      if (typeof value.contact.resumeHref === "string") {
        linkHrefs.add(value.contact.resumeHref);
      }
    }

    if (isRecord(value.context)) visit(value.context);
    if (isRecord(value.packet)) visit(value.packet);
  };

  visit(groundingContext);

  return {
    projectIds: [...projectIds],
    resumeTrackIds: [...resumeTrackIds],
    linkHrefs: [...linkHrefs],
    contactAvailable,
  };
}

function addProjectReferences(value: unknown, projectIds: Set<string>, linkHrefs: Set<string>): void {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id === "string" && item.id.trim()) projectIds.add(item.id);
    addLinkReferences(item.links, linkHrefs);
  }
}

function addResumeReferences(value: unknown, resumeTrackIds: Set<string>): void {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return;

  for (const item of value.tracks) {
    if (isRecord(item) && typeof item.id === "string" && item.id.trim()) {
      resumeTrackIds.add(item.id);
    }
  }
}

function addLinkReferences(value: unknown, linkHrefs: Set<string>): void {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (Array.isArray(item) && typeof item[1] === "string" && item[1].trim()) {
      linkHrefs.add(item[1]);
    }
  }
}

function addStringArray(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;

  for (const item of value) {
    if (typeof item === "string" && item.trim()) target.add(item);
  }
}

function isSafeHref(value: string): boolean {
  const href = value.trim();
  if (!href) return false;
  if (href.startsWith("/")) return !href.startsWith("//") && !href.includes("\\");

  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
