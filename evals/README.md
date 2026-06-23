# DM Answer-Quality Evals

Run the local Eve smoke suite with:

```bash
npm run eval
```

Run only the fit-check eval group with:

```bash
npm run eval -- fit-check
```

Run the deterministic DM response-style walkthrough smoke without a live model:

```bash
npm run smoke:dm-style
```

Run the deterministic fit-check policy/context smoke without a live model:

```bash
npm run smoke:fit-check
```

Run the credential-dependent DM latency benchmark with the default candidate set:

```bash
npm run benchmark:dm-latency
```

Compare explicit gateway model ids without changing site code:

```bash
DM_LATENCY_MODELS="anthropic/claude-haiku-4.5,openai/gpt-5.1-instant,google/gemini-2.5-flash-lite" npm run benchmark:dm-latency -- --runs 2
```

The benchmark starts one local Eve dev server per candidate with `DM_AGENT_MODEL` set, sends representative DM prompts derived from `evals/data/grounding-fixtures.json`, and reports only fixture ids, session-start latency, first-token latency, completion latency, terminal latency, HTTP status codes, Eve event names/counts, boundary flags, tool count, sanitized failure codes, and retry counts. It does not print raw prompts, replies, provider response bodies, secrets, or stack traces. Use `--fixtures` to isolate a subset, `--retries` and `--retry-delay-ms` to recover transient no-token model-call failures while keeping reliability visible, `--inter-run-delay-ms` to space live turns during gateway-sensitive comparisons, and `--server-timeout-ms` if a fresh local Eve boot needs longer than the default 60000 ms. To benchmark an existing preview target instead of local candidate models:

```bash
npm run benchmark:dm-latency -- --url "$DEPLOY_URL"
```

For CI, use:

```bash
npm run eval:ci
```

To run the same evals against a deployed Eve preview instead of a local dev server:

```bash
npm run eval -- --url "$DEPLOY_URL"
```

The suite consumes `evals/data/grounding-fixtures.json` as the cross-repo JSON contract from `portfolio-#105`. It validates the fixture `version`, `source`, expected fixture ids, and a 50 KB maximum snapshot size before any eval runs. The evals do not import the `portfolio-` source tree.

The response-style walkthrough lives in `docs/dm-response-style-examples.md`. It covers strongest project, hiring fit, agent/MCP work, trading/finance automation, iOS/product work, background, contact, and unknown-fact prompts with before/after examples grounded in the same fixture snapshot.

## Model tuning recommendation

`anthropic/claude-haiku-4.5` is the default. It was the strongest candidate in the live latency benchmark: fastest first token (~1s) and the best completion rate, roughly 6-13x faster than the previous `openai/gpt-5-nano` reasoning default. `openai/gpt-5.1-instant` (OpenAI-native fast path) and `google/gemini-2.5-flash-lite` (lowest cost) are the tracked comparison candidates. Reasoning-family models (`openai/gpt-5-nano`, `openai/gpt-5-mini`, `anthropic/claude-sonnet-4.6`) are avoided here: they add 6-13x first-token latency and fail intermittently through this path, with no quality benefit for short grounded DM answers. Confirm answer quality with `npm run eval` (DM answer-quality and fit-check) before changing the default. Override the runtime model with `DM_AGENT_MODEL` in the agent environment, not in the portfolio site. Use `DM_LATENCY_MODELS` only for benchmark comparison runs.
