import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_MODEL } from "../agent/model-config.js";
import { getFixture, groundedPrompt, type GroundingFixtureId } from "./fixtures.js";

type StreamEvent = {
  type: string;
  data?: {
    actions?: readonly unknown[];
    code?: string;
  };
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
  toolCount: number;
  status: "completed" | "failed";
  failureCode?: string;
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
};

const REPRESENTATIVE_FIXTURES: readonly GroundingFixtureId[] = [
  "recruiter-contact",
  "project-page-agentic-trader",
  "agent-mcp-work",
  "trading-finance-automation",
  "ios-product-work",
  "general",
];

const DEFAULT_CANDIDATE_MODELS = [DEFAULT_MODEL, "openai/gpt-5-mini"] as const;

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

function printHelp(): void {
  console.log(
    [
      "Usage: npm run benchmark:dm-latency -- [--models model-a,model-b] [--runs 2] [--url https://agent.example.com]",
      "",
      "Without --url, the script starts one local Eve dev server per model with DM_AGENT_MODEL set.",
      "With --url, it benchmarks the provided target once and labels the configured model as remote-target.",
      "Output is sanitized: fixture ids, timing medians, tool counts, and failure codes only.",
    ].join("\n"),
  );
}

function benchmarkCases(): PromptCase[] {
  return REPRESENTATIVE_FIXTURES.map((id) => ({
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

  const cases = benchmarkCases();
  const summaries: CandidateSummary[] = [];

  if (args.url) {
    const measurements = await benchmarkTarget(args.url, cases, args.runs);
    summaries.push(summarizeCandidate("remote-target", "configured-target-model", measurements));
  } else {
    for (const [index, model] of args.models.entries()) {
      const port = args.port + index;
      const url = `http://127.0.0.1:${port}`;
      const server = await startLocalEveServer(model, port);
      try {
        const measurements = await benchmarkTarget(url, cases, args.runs);
        summaries.push(summarizeCandidate(`candidate-${index + 1}`, model, measurements));
      } finally {
        await stopLocalEveServer(server);
      }
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), promptSet: "dm-grounding-fixtures", summaries }, null, 2));
}

async function startLocalEveServer(model: string, port: number): Promise<ChildProcess> {
  const child = spawn("npx", ["eve", "dev", "--no-ui", "--host", "127.0.0.1", "--port", String(port)], {
    env: {
      ...process.env,
      DM_AGENT_MODEL: model,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.resume();
  child.stderr?.resume();

  const healthy = await waitForHealth(`http://127.0.0.1:${port}`, child);
  if (!healthy) {
    await stopLocalEveServer(child);
    throw new Error(`Eve dev server did not become healthy for candidate on port ${port}.`);
  }

  return child;
}

async function waitForHealth(url: string, child: ChildProcess): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (child.exitCode !== null) {
      return false;
    }

    try {
      const response = await fetch(new URL("/eve/v1/health", url));
      if (response.ok) {
        return true;
      }
    } catch {
      // Server is still starting.
    }

    await delay(500);
  }

  return false;
}

async function stopLocalEveServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5000).then(() => child.kill("SIGKILL"))]);
}

async function benchmarkTarget(url: string, cases: readonly PromptCase[], runs: number): Promise<Measurement[]> {
  const measurements: Measurement[] = [];

  for (const testCase of cases) {
    for (let iteration = 1; iteration <= runs; iteration += 1) {
      measurements.push(await measureTurn(url, testCase, iteration));
    }
  }

  return measurements;
}

async function measureTurn(url: string, testCase: PromptCase, iteration: number): Promise<Measurement> {
  const startedAt = performance.now();
  const response = await fetch(new URL("/eve/v1/session", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: testCase.input }),
  });
  const sessionStartMs = elapsedMs(startedAt);

  if (!response.ok) {
    return failedMeasurement(testCase.id, iteration, sessionStartMs, `http-${response.status}`);
  }

  const body = (await response.json()) as { sessionId?: unknown };
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return failedMeasurement(testCase.id, iteration, sessionStartMs, "missing-session-id");
  }

  const streamResult = await collectStream(url, body.sessionId, startedAt);
  const status = streamResult.failureCode ? "failed" : "completed";

  return {
    fixtureId: testCase.id,
    iteration,
    sessionStartMs,
    firstTokenMs: streamResult.firstTokenMs,
    completionMs: streamResult.completionMs,
    toolCount: streamResult.toolCount,
    status,
    failureCode: streamResult.failureCode,
  };
}

function failedMeasurement(
  fixtureId: GroundingFixtureId,
  iteration: number,
  sessionStartMs: number,
  failureCode: string,
): Measurement {
  return {
    fixtureId,
    iteration,
    sessionStartMs,
    firstTokenMs: null,
    completionMs: null,
    toolCount: 0,
    status: "failed",
    failureCode,
  };
}

async function collectStream(
  url: string,
  sessionId: string,
  startedAt: number,
): Promise<{ firstTokenMs: number | null; completionMs: number | null; toolCount: number; failureCode?: string }> {
  const response = await fetch(new URL(`/eve/v1/session/${encodeURIComponent(sessionId)}/stream`, url));
  if (!response.ok || !response.body) {
    return { firstTokenMs: null, completionMs: null, toolCount: 0, failureCode: `stream-http-${response.status}` };
  }

  let firstTokenMs: number | null = null;
  let completionMs: number | null = null;
  let toolCount = 0;
  let failureCode: string | undefined;
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

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

        if (event.type === "message.appended" && firstTokenMs === null) {
          firstTokenMs = elapsedMs(startedAt);
        }

        if (event.type === "actions.requested") {
          toolCount += event.data?.actions?.length ?? 0;
        }

        if (event.type === "step.failed" || event.type === "turn.failed") {
          failureCode = event.data?.code ?? event.type;
        }

        if (event.type === "turn.completed" || event.type === "session.waiting") {
          completionMs = elapsedMs(startedAt);
          return { firstTokenMs, completionMs, toolCount, failureCode };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    firstTokenMs,
    completionMs,
    toolCount,
    failureCode: failureCode ?? "stream-ended-before-turn-completed",
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
  };
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
