# DM Answer-Quality Evals

Run the local Eve smoke suite with:

```bash
npm run eval
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
