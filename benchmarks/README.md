# Benchmarks

> **Requires Deno** — all `deno task bench*` commands must be run with Deno v2+.

## Run

```bash
# All runtimes (Deno, Node.js, Browser)
deno task bench

# Single runtime
deno task bench --runtime=deno
```

## Save results to JSON

```bash
# Runs all runtimes, writes goatdb-bench-{deno,node,browser}.json
deno task bench:json

# Single runtime
deno task bench:json --runtime=deno
```

Output goes to `benchmarks/results/` (gitignored).

## Update docs

After saving results, patch the data tables in `docs/docs/benchmarks.md`:

```bash
deno task bench:update-docs

# Preview without writing
deno task bench:update-docs --dry-run
```

Only the regions between `{/* BENCH:section:START */}` /
`{/* BENCH:section:END */}` sentinel comments are replaced. All narrative prose
is left untouched.

## Full pipeline

```bash
deno task bench:json && deno task bench:update-docs
```
