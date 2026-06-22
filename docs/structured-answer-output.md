# DM Structured Answer Output

DM can return structured answer-block suggestions when an Eve client explicitly requests an output schema for a turn. Normal chat remains plain prose because `agent/agent.ts` does not set a global `outputSchema`.

Use `DM_STRUCTURED_ANSWER_OUTPUT_JSON_SCHEMA` from `agent/answer-blocks.ts`, or send an equivalent JSON Schema, as the per-turn Eve `outputSchema`. Pass the portfolio site's grounding packet as `clientContext` so DM can copy only canonical project ids, resume track ids, and links supplied by the site.

```ts
const response = await session.send({
  message,
  clientContext: groundingPacket,
  outputSchema: DM_STRUCTURED_ANSWER_OUTPUT_JSON_SCHEMA,
});

const result = await response.result();
const blocks = result.data?.answerBlocks ?? [];
```

The output root is:

```ts
type DmStructuredAnswerOutput =
  | { status: "matched"; answerBlocks: AnswerBlock[] }
  | { status: "no_match"; answerBlocks: []; reason: string };

type AnswerBlock =
  | { kind: "text"; text: string }
  | { kind: "projects"; ids: string[] }
  | { kind: "resume"; trackIds: string[] }
  | { kind: "contact" }
  | { kind: "links"; items: [label: string, href: string][] };
```

The site remains authoritative for rendering and validation. Remote blocks are suggestions only: `portfolio-` should keep skipping unknown, malformed, unsafe, or non-canonical blocks, and it should continue to own canonical ids, fallback artifacts, and UI rendering.

For the current `portfolio-` bridge that calls Eve's HTTP API directly, include `outputSchema` next to `message` and `clientContext` in the `POST /eve/v1/session` body when structured artifacts are desired. While streaming `GET /eve/v1/session/:sessionId/stream`, read `result.completed.data.result`; its `answerBlocks` array can be forwarded through the tolerant site shapes (`data.answerBlocks`, `data.blocks`, or one block at a time). Turns that omit `outputSchema` should continue to consume only the normal message events.
