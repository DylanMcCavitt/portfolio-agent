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
