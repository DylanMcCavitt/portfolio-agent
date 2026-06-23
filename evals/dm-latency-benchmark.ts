import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_MODEL } from "../agent/model-config.js";
import { getFixture, groundedPrompt, type GroundingFixtureId } from "./fixtures.js";

const COUNTED_STREAM_EVENTS = [
  "session.started",
  "turn.started",
  "message.received",
  "step.started",
  "actions.requested",
  "action.result",
  "input.requested",
  "subagent.called",
  "subagent.completed",
  "reasoning.appended",
  "reasoning.completed",
  "message.appended",
  "message.completed",
  "result.completed",
  "compaction.requested",
  "compaction.completed",
  "authorization.required",
  "authorization.completed",
  "step.completed",
  "step.failed",
  "turn.completed",
  "turn.failed",
  "session.waiting",
  "session.failed",
  "session.completed",
] as const;

const COUNTED_STREAM_EVENT_SET = new Set<string>(COUNTED_STREAM_EVENTS);
const EVE_DEV_PID_FILE = ".eve/dev-process.pid";

type CountedStreamEvent = (typeof COUNTED_STREAM_EVENTS)[number];
type EventCounts = Partial<Record<CountedStreamEvent, number>>;
type FailureStage =
  | "server-start"
  | "session-start"
  | "session-response"
  | "stream-start"
  | "stream-read"
  | "stream-ended";

type StreamEvent = {
  type: string;
  data?: {
    actions?: readonly unknown[];
    code?: unknown;
  };
};

type StreamResult = {
  firstTokenMs: number | null;
  completionMs: number | null;
  terminalMs: number | null;
  toolCount: number;
  streamHttpStatus: number | null;
  turnBoundaryArrived: boolean;
  sessionBoundaryArrived: boolean;
  eventCount: number;
  eventCounts: EventCounts;
  lastEventType: string | null;
  failureStage?: FailureStage;
  failureCode?: string;
};

type PromptCase = {
  id: GroundingFixtureId;
  input: string;
};

type Measurement = {
  fixtureId: GroundingFixtureId;
  iteration: number;
  sessionStartMs: number;
  firstTokenMs: number | null;
  completionMs: number | null;
  terminalMs: number | null;
  toolCount: number;
  status: "completed" | "failed";
  sessionHttpStatus: number | null;
  streamHttpStatus: number | null;
  firstTokenArrived: boolean;
  turnBoundaryArrived: boolean;
  sessionBoundaryArrived: boolean;
  eventCount: number;
  eventCounts: EventCounts;
  lastEventType: string | null;
  failureStage?: FailureStage;
  failureCode?: string;
  attempts: number;
  priorFailureCodes: string[];
  serverHealthHttpStatus?: number | null;
  serverExitCode?: number | null;
  serverSignal?: string | null;
};

type CandidateSummary = {
  candidate: string;
  model: string;
  runs: number;
  completed: number;
  failed: number;
  medianSessionStartMs: number | null;
  medianFirstTokenMs: number | null;
  medianCompletionMs: number | null;
  medianToolCount: number | null;
  failureCodes: Record<string, number>;
  retryRecovered: number;
  medianAttempts: number | null;
  diagnostics: readonly Measurement[];
};

const REPRESENTATIVE_FIXTURES: readonly GroundingFixtureId[] = [
  "recruiter-contact",
  "project-page-agentic-trader",
  "agent-mcp-work",
  "trading-finance-automation",
  "ios-product-work",
  "general",
];

const DEFAULT_CANDIDATE_MODELS = [DEFAULT_MODEL, "openai/gpt-5.1-instant", "google/gemini-2.5-flash-lite"] as const;

function parseArgs(argv: readonly string[]) {
  const args = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      index += 1;
    } else {
      args.set(key, true);
    }
  }

  return {
    url: stringArg(args, "url"),
    runs: positiveIntArg(args, "runs", 1),
    port: positiveIntArg(args, "port", 3410),
    serverTimeoutMs: positiveIntArg(args, "server-timeout-ms", 60000),
    interRunDelayMs: nonNegativeIntArg(args, "inter-run-delay-ms", 0),
    retries: nonNegativeIntArg(args, "retries", 0),
    retryDelayMs: nonNegativeIntArg(args, "retry-delay-ms", 5000),
    fixtures: fixtureListArg(args, "fixtures", REPRESENTATIVE_FIXTURES),
    models: listArg(args, "models", process.env.DM_LATENCY_MODELS, DEFAULT_CANDIDATE_MODELS),
    help: args.has("help"),
  };
}

function stringArg(args: Map<string, string | true>, key: string): string | undefined {
  const value = args.get(key);
  if (value === undefined || value === true) {
    return undefined;
  }
  return value;
}

function positiveIntArg(args: Map<string, string | true>, key: string, fallback: number): number {
  const value = stringArg(args, key);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${key} must be a positive integer.`);
  }

  return parsed;
}

function nonNegativeIntArg(args: Map<string, string | true>, key: string, fallback: number): number {
  const value = stringArg(args, key);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${key} must be a non-negative integer.`);
  }

  return parsed;
}

function listArg(
  args: Map<string, string | true>,
  key: string,
  envValue: string | undefined,
  fallback: readonly string[],
): string[] {
  const raw = stringArg(args, key) ?? envValue;
  const values = (raw ? raw.split(",") : [...fallback]).map((value) => value.trim()).filter(Boolean);
  return [...new Set(values)];
}

function fixtureListArg(
  args: Map<string, string | true>,
  key: string,
  fallback: readonly GroundingFixtureId[],
): GroundingFixtureId[] {
  const raw = stringArg(args, key);
  const values = raw ? raw.split(",").map((value) => value.trim()).filter(Boolean) : [...fallback];
  const allowed = new Set<GroundingFixtureId>(REPRESENTATIVE_FIXTURES);
  const fixtures: GroundingFixtureId[] = [];

  for (const value of values) {
    if (!allowed.has(value as GroundingFixtureId)) {
      throw new Error(`--${key} contains an unknown fixture id.`);
    }

    const fixtureId = value as GroundingFixtureId;
    if (!fixtures.includes(fixtureId)) {
      fixtures.push(fixtureId);
    }
  }

  return fixtures;
}

function printHelp(): void {
  console.log(
    [
      "Usage: npm run benchmark:dm-latency -- [--models model-a,model-b] [--runs 2] [--fixtures id-a,id-b] [--retries 1] [--retry-delay-ms 5000] [--inter-run-delay-ms 1000] [--server-timeout-ms 60000] [--url https://agent.example.com]",
      "",
      "Without --url, the script starts one local Eve dev server per model with DM_AGENT_MODEL set.",
      "With --url, it benchmarks the provided target once and labels the configured model as remote-target.",
      "Output is sanitized: fixture ids, event names/counts, boundary flags, HTTP status codes, timing fields, tool counts, and failure codes only.",
    ].join("\n"),
  );
}

function benchmarkCases(fixtureIds: readonly GroundingFixtureId[]): PromptCase[] {
  return fixtureIds.map((id) => ({
    id,
    input: groundedPrompt(getFixture(id)),
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const cases = benchmarkCases(args.fixtures);
  const summaries: CandidateSummary[] = [];

  if (args.url) {
    const measurements = await benchmarkTarget(args.url, cases, args.runs, args.interRunDelayMs, args.retries, args.retryDelayMs);
    summaries.push(summarizeCandidate("remote-target", "configured-target-model", measurements));
  } else {
    for (const [index, model] of args.models.entries()) {
      const candidate = `candidate-${index + 1}`;
      const port = args.port + index;
      const url = `http://127.0.0.1:${port}`;
      const serverStart = await startLocalEveServer(model, port, args.serverTimeoutMs);
      if (!serverStart.ok) {
        summaries.push(summarizeCandidate(candidate, model, failedStartupMeasurements(cases, args.runs, serverStart)));
        continue;
      }

      const server = serverStart.server;
      try {
        const measurements = await benchmarkTarget(url, cases, args.runs, args.interRunDelayMs, args.retries, args.retryDelayMs);
        summaries.push(summarizeCandidate(candidate, model, measurements));
      } finally {
        await stopLocalEveServer(server);
      }
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), promptSet: "dm-grounding-fixtures", summaries }, null, 2));
}

type LocalServerStartResult =
  | { ok: true; server: ChildProcess }
  | {
      ok: false;
      failureCode: string;
      healthHttpStatus: number | null;
      serverExitCode: number | null;
      serverSignal: string | null;
    };

async function startLocalEveServer(model: string, port: number, timeoutMs: number): Promise<LocalServerStartResult> {
  await cleanupStaleDevPidFile();

  const child = spawn("npx", ["eve", "dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port)], {
    env: {
      ...process.env,
      DM_AGENT_MODEL: model,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let spawnFailed = false;
  child.once("error", () => {
    spawnFailed = true;
  });
  child.stdout?.resume();
  child.stderr?.resume();

  const health = await waitForHealth(`http://127.0.0.1:${port}`, child, timeoutMs, () => spawnFailed);
  if (!health.ok) {
    await stopLocalEveServer(child);
    return health;
  }

  return { ok: true, server: child };
}

async function waitForHealth(
  url: string,
  child: ChildProcess,
  timeoutMs: number,
  didSpawnFail: () => boolean,
): Promise<LocalServerStartResult> {
  const startedAt = Date.now();
  let healthHttpStatus: number | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (didSpawnFail()) {
      return {
        ok: false,
        failureCode: "server-spawn-error",
        healthHttpStatus,
        serverExitCode: child.exitCode,
        serverSignal: child.signalCode,
      };
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      return {
        ok: false,
        failureCode: "server-process-exited",
        healthHttpStatus,
        serverExitCode: child.exitCode,
        serverSignal: child.signalCode,
      };
    }

    try {
      const response = await fetch(new URL("/eve/v1/health", url));
      healthHttpStatus = response.status;
      if (response.ok) {
        return { ok: true, server: child };
      }
    } catch {
      // Server is still starting.
    }

    await delay(500);
  }

  return {
    ok: false,
    failureCode: "server-start-timeout",
    healthHttpStatus,
    serverExitCode: child.exitCode,
    serverSignal: child.signalCode,
  };
}

async function stopLocalEveServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await cleanupStaleDevPidFile();
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5000).then(() => child.kill("SIGKILL"))]);
  await cleanupStaleDevPidFile();
}

async function benchmarkTarget(
  url: string,
  cases: readonly PromptCase[],
  runs: number,
  interRunDelayMs: number,
  retries: number,
  retryDelayMs: number,
): Promise<Measurement[]> {
  const measurements: Measurement[] = [];

  for (const testCase of cases) {
    for (let iteration = 1; iteration <= runs; iteration += 1) {
      measurements.push(await measureTurnWithRetries(url, testCase, iteration, retries, retryDelayMs));
      if (interRunDelayMs > 0) {
        await delay(interRunDelayMs);
      }
    }
  }

  return measurements;
}

async function measureTurnWithRetries(
  url: string,
  testCase: PromptCase,
  iteration: number,
  retries: number,
  retryDelayMs: number,
): Promise<Measurement> {
  const priorFailureCodes: string[] = [];

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const measurement = await measureTurn(url, testCase, iteration, attempt, priorFailureCodes);
    if (measurement.status === "completed" || !isRetryableMeasurement(measurement) || attempt > retries) {
      return measurement;
    }

    priorFailureCodes.push(measurement.failureCode ?? "unknown-failure");
    if (retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
  }

  throw new Error("unreachable retry state");
}

async function measureTurn(
  url: string,
  testCase: PromptCase,
  iteration: number,
  attempt: number,
  priorFailureCodes: readonly string[],
): Promise<Measurement> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(new URL("/eve/v1/session", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: testCase.input }),
    });
  } catch {
    return failedMeasurement({
      fixtureId: testCase.id,
      iteration,
      sessionStartMs: elapsedMs(startedAt),
      failureStage: "session-start",
      failureCode: "session-request-error",
      attempts: attempt,
      priorFailureCodes,
    });
  }
  const sessionStartMs = elapsedMs(startedAt);

  if (!response.ok) {
    return failedMeasurement({
      fixtureId: testCase.id,
      iteration,
      sessionStartMs,
      sessionHttpStatus: response.status,
      failureStage: "session-start",
      failureCode: `http-${response.status}`,
      attempts: attempt,
      priorFailureCodes,
    });
  }

  let body: { sessionId?: unknown };
  try {
    body = (await response.json()) as { sessionId?: unknown };
  } catch {
    return failedMeasurement({
      fixtureId: testCase.id,
      iteration,
      sessionStartMs,
      sessionHttpStatus: response.status,
      failureStage: "session-response",
      failureCode: "invalid-session-response",
      attempts: attempt,
      priorFailureCodes,
    });
  }

  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return failedMeasurement({
      fixtureId: testCase.id,
      iteration,
      sessionStartMs,
      sessionHttpStatus: response.status,
      failureStage: "session-response",
      failureCode: "missing-session-id",
      attempts: attempt,
      priorFailureCodes,
    });
  }

  const streamResult = await collectStream(url, body.sessionId, startedAt);
  const status = streamResult.failureCode ? "failed" : "completed";

  return {
    fixtureId: testCase.id,
    iteration,
    sessionStartMs,
    firstTokenMs: streamResult.firstTokenMs,
    completionMs: streamResult.completionMs,
    terminalMs: streamResult.terminalMs,
    toolCount: streamResult.toolCount,
    status,
    sessionHttpStatus: response.status,
    streamHttpStatus: streamResult.streamHttpStatus,
    firstTokenArrived: streamResult.firstTokenMs !== null,
    turnBoundaryArrived: streamResult.turnBoundaryArrived,
    sessionBoundaryArrived: streamResult.sessionBoundaryArrived,
    eventCount: streamResult.eventCount,
    eventCounts: streamResult.eventCounts,
    lastEventType: streamResult.lastEventType,
    failureStage: streamResult.failureStage,
    failureCode: streamResult.failureCode,
    attempts: attempt,
    priorFailureCodes: [...priorFailureCodes],
  };
}

function failedMeasurement({
  fixtureId,
  iteration,
  sessionStartMs,
  failureStage,
  failureCode,
  sessionHttpStatus = null,
  streamHttpStatus = null,
  serverHealthHttpStatus,
  serverExitCode,
  serverSignal,
  attempts = 1,
  priorFailureCodes = [],
}: {
  fixtureId: GroundingFixtureId;
  iteration: number;
  sessionStartMs: number;
  failureStage: FailureStage;
  failureCode: string;
  sessionHttpStatus?: number | null;
  streamHttpStatus?: number | null;
  serverHealthHttpStatus?: number | null;
  serverExitCode?: number | null;
  serverSignal?: string | null;
  attempts?: number;
  priorFailureCodes?: readonly string[];
}): Measurement {
  return {
    fixtureId,
    iteration,
    sessionStartMs,
    firstTokenMs: null,
    completionMs: null,
    terminalMs: null,
    toolCount: 0,
    status: "failed",
    sessionHttpStatus,
    streamHttpStatus,
    firstTokenArrived: false,
    turnBoundaryArrived: false,
    sessionBoundaryArrived: false,
    eventCount: 0,
    eventCounts: {},
    lastEventType: null,
    failureStage,
    failureCode,
    attempts,
    priorFailureCodes: [...priorFailureCodes],
    serverHealthHttpStatus,
    serverExitCode,
    serverSignal,
  };
}

async function collectStream(
  url: string,
  sessionId: string,
  startedAt: number,
): Promise<StreamResult> {
  let response: Response;
  try {
    response = await fetch(new URL(`/eve/v1/session/${encodeURIComponent(sessionId)}/stream`, url));
  } catch {
    return failedStreamResult("stream-start", "stream-request-error");
  }

  if (!response.ok || !response.body) {
    return failedStreamResult("stream-start", `stream-http-${response.status}`, response.status);
  }

  let firstTokenMs: number | null = null;
  let completionMs: number | null = null;
  let terminalMs: number | null = null;
  let toolCount = 0;
  let failureCode: string | undefined;
  let failureStage: FailureStage | undefined;
  let turnBoundaryArrived = false;
  let sessionBoundaryArrived = false;
  let eventCount = 0;
  let lastEventType: string | null = null;
  const eventCounts: EventCounts = {};
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const currentResult = (overrides: Partial<StreamResult> = {}): StreamResult => ({
    firstTokenMs,
    completionMs,
    terminalMs,
    toolCount,
    streamHttpStatus: response.status,
    turnBoundaryArrived,
    sessionBoundaryArrived,
    eventCount,
    eventCounts,
    lastEventType,
    failureStage,
    failureCode,
    ...overrides,
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (!event) {
          continue;
        }
        eventCount += 1;
        lastEventType = sanitizedEventType(event.type);
        bumpEventCount(eventCounts, event.type);

        if (event.type === "message.appended" && firstTokenMs === null) {
          firstTokenMs = elapsedMs(startedAt);
        }

        if (event.type === "actions.requested") {
          toolCount += event.data?.actions?.length ?? 0;
        }

        if (event.type === "step.failed") {
          failureCode = sanitizeFailureCode(event.data?.code, event.type);
          failureStage = "stream-read";
        }

        if (event.type === "turn.failed") {
          turnBoundaryArrived = true;
          terminalMs = elapsedMs(startedAt);
          failureCode = sanitizeFailureCode(event.data?.code, event.type);
          failureStage = "stream-read";
          return currentResult();
        }

        if (event.type === "session.failed") {
          sessionBoundaryArrived = true;
          terminalMs = elapsedMs(startedAt);
          failureCode = sanitizeFailureCode(event.data?.code, event.type);
          failureStage = "stream-read";
          return currentResult();
        }

        if (event.type === "turn.completed") {
          turnBoundaryArrived = true;
          completionMs = elapsedMs(startedAt);
          terminalMs = completionMs;
          return currentResult();
        }

        if (event.type === "session.waiting" || event.type === "session.completed") {
          sessionBoundaryArrived = true;
          completionMs ??= elapsedMs(startedAt);
          terminalMs = completionMs;
          return currentResult();
        }
      }
    }
  } catch {
    terminalMs = elapsedMs(startedAt);
    return currentResult({
      failureStage: "stream-read",
      failureCode: "stream-read-error",
    });
  } finally {
    reader.releaseLock();
  }

  terminalMs = elapsedMs(startedAt);
  return currentResult({
    failureStage: failureStage ?? "stream-ended",
    failureCode: failureCode ?? "stream-ended-before-turn-completed",
  });
}

function failedStreamResult(
  failureStage: FailureStage,
  failureCode: string,
  streamHttpStatus: number | null = null,
): StreamResult {
  return {
    firstTokenMs: null,
    completionMs: null,
    terminalMs: null,
    toolCount: 0,
    streamHttpStatus,
    turnBoundaryArrived: false,
    sessionBoundaryArrived: false,
    eventCount: 0,
    eventCounts: {},
    lastEventType: null,
    failureStage,
    failureCode,
  };
}

function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as StreamEvent;
    return typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function summarizeCandidate(candidate: string, model: string, measurements: readonly Measurement[]): CandidateSummary {
  const completed = measurements.filter((measurement) => measurement.status === "completed");

  return {
    candidate,
    model,
    runs: measurements.length,
    completed: completed.length,
    failed: measurements.length - completed.length,
    medianSessionStartMs: median(completed.map((measurement) => measurement.sessionStartMs)),
    medianFirstTokenMs: median(completed.map((measurement) => measurement.firstTokenMs).filter(isNumber)),
    medianCompletionMs: median(completed.map((measurement) => measurement.completionMs).filter(isNumber)),
    medianToolCount: median(completed.map((measurement) => measurement.toolCount)),
    failureCodes: countFailureCodes(measurements),
    retryRecovered: completed.filter((measurement) => measurement.attempts > 1).length,
    medianAttempts: median(measurements.map((measurement) => measurement.attempts)),
    diagnostics: measurements,
  };
}

function isRetryableMeasurement(measurement: Measurement): boolean {
  if (measurement.status === "completed") {
    return false;
  }

  return (
    measurement.failureStage === "stream-read" &&
    measurement.firstTokenArrived === false &&
    (measurement.failureCode === "MODEL_CALL_FAILED" || measurement.failureCode === "stream-read-error")
  );
}

function failedStartupMeasurements(
  cases: readonly PromptCase[],
  runs: number,
  failure: Exclude<LocalServerStartResult, { ok: true }>,
): Measurement[] {
  const measurements: Measurement[] = [];

  for (const testCase of cases) {
    for (let iteration = 1; iteration <= runs; iteration += 1) {
      measurements.push(
        failedMeasurement({
          fixtureId: testCase.id,
          iteration,
          sessionStartMs: 0,
          failureStage: "server-start",
          failureCode: failure.failureCode,
          attempts: 1,
          priorFailureCodes: [],
          serverHealthHttpStatus: failure.healthHttpStatus,
          serverExitCode: failure.serverExitCode,
          serverSignal: failure.serverSignal,
        }),
      );
    }
  }

  return measurements;
}

function countFailureCodes(measurements: readonly Measurement[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const measurement of measurements) {
    if (measurement.failureCode) {
      counts[measurement.failureCode] = (counts[measurement.failureCode] ?? 0) + 1;
    }
  }

  return counts;
}

function bumpEventCount(counts: EventCounts, eventType: string): void {
  if (!COUNTED_STREAM_EVENT_SET.has(eventType)) {
    return;
  }

  const countedEventType = eventType as CountedStreamEvent;
  counts[countedEventType] = (counts[countedEventType] ?? 0) + 1;
}

function sanitizedEventType(eventType: string): string {
  return COUNTED_STREAM_EVENT_SET.has(eventType) ? eventType : "unknown-event";
}

function sanitizeFailureCode(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(raw) ? raw : fallback;
}

async function cleanupStaleDevPidFile(): Promise<void> {
  let rawPid: string;
  try {
    rawPid = await readFile(EVE_DEV_PID_FILE, "utf8");
  } catch {
    return;
  }

  const pid = Number(rawPid.trim());
  if (!Number.isInteger(pid) || pid < 1 || isProcessAlive(pid)) {
    return;
  }

  try {
    await unlink(EVE_DEV_PID_FILE);
  } catch {
    // Another process may have already cleaned up the stale pid file.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(value);
}

function isNumber(value: number | null): value is number {
  return typeof value === "number";
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

await main().catch((error: unknown) => {
  const failureCode =
    error instanceof Error && (error.message.startsWith("Unknown argument") || error.message.startsWith("--"))
      ? "invalid-arguments"
      : "benchmark-error";
  console.error(JSON.stringify({ status: "failed", failureCode }));
  process.exitCode = 1;
});
