/**
 * Updates docs/docs/benchmarks.md data tables from benchmark JSON results.
 *
 * Usage:
 *   deno run -A benchmarks/update-docs.ts [--input-dir=benchmarks/results] [--dry-run]
 *
 * Sentinel format in the MDX file:
 *   {/* BENCH:section:START *\/}
 *   ...data tables...
 *   {/* BENCH:section:END *\/}
 */

import type { RunResult, RunSummary } from '../shared/runner.ts';
import { OPERATION_ORDER } from './mod.ts';
import * as path from '@std/path';

type Runtime = 'deno' | 'node' | 'browser';
type Results = Map<Runtime, RunSummary>;

/**
 * Scale-aware divergence threshold. Millisecond-scale operations are more
 * stable so a smaller ratio is meaningful; sub-millisecond (us) operations
 * need a wider margin to overcome measurement noise.
 */
function divergenceThreshold(minMs: number): number {
  return minMs >= 1.0 ? 1.3 : 1.5;
}

/** CV above which a measurement is considered too noisy for color coding. */
const HIGH_CV_THRESHOLD = 0.33;

// Suite ordering per runtime for detailed stats
const SERVER_SUITES = [
  'GoatDB',
  'GoatDB (Trusted)',
  'GoatDB (Durable)',
  'GoatDB JSONL',
  'SQLite',
  'SQLite Fast-Unsafe',
];
const BROWSER_SUITES = ['GoatDB', 'GoatDB JSONL', 'SQLite'];

async function loadResults(dir: string): Promise<Results> {
  const results: Results = new Map();
  for (const runtime of ['deno', 'node', 'browser'] as Runtime[]) {
    const jsonPath = path.join(dir, `goatdb-bench-${runtime}.json`);
    try {
      const text = await Deno.readTextFile(jsonPath);
      results.set(runtime, JSON.parse(text) as RunSummary);
      console.log(`✓ Loaded ${runtime} results from ${jsonPath}`);
    } catch (e) {
      // Skip missing files — partial update is fine
      console.warn(
        `⚠ Skipping ${runtime}: ${(e as Error).message || 'file not found'}`,
      );
    }
  }
  return results;
}

function escapeMdxCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/[<>{}]/g, (c) => `\\${c}`);
}

function fmtDuration(ms: number): string {
  if (ms < 1.0) {
    if (ms * 1000 < 0.05) return '\\<0.1\u00B5s';
    return `${(ms * 1000).toFixed(1)}\u00B5s`;
  }
  return `${ms.toFixed(1)}ms`;
}

function fmtThroughput(opsPerSec: number): string {
  if (opsPerSec < 0.1) return '—';
  if (opsPerSec >= 1_000_000) {
    return `${(opsPerSec / 1_000_000).toFixed(2)}M ops/s`;
  }
  if (opsPerSec >= 1_000) {
    return `${Math.round(opsPerSec / 1_000)}K ops/s`;
  }
  return `${Math.round(opsPerSec)} ops/s`;
}

function getOpResult(
  summary: RunSummary,
  suite: string,
  opName: string,
): RunResult | undefined {
  return summary.results.find(
    (r) => r.suite === suite && r.name === opName,
  );
}

function getOpMean(
  summary: RunSummary,
  suite: string,
  opName: string,
): number | null {
  const result = getOpResult(summary, suite, opName);
  if (!result?.statistics) return null;
  return result.statistics.trimmedMean ?? result.statistics.mean;
}

/**
 * Returns operations where at least one suite's browser value differs from its
 * server (Deno) value by more than the scale-aware threshold (1.3x–1.5x) — the
 * same threshold used for color coding.
 * These are the operations that tell a meaningfully different story in the browser.
 */
function computeDivergentOps(
  server: RunSummary,
  browser: RunSummary,
  suites: string[],
): string[] {
  return OPERATION_ORDER.filter((op) =>
    suites.some((suite) => {
      const s = getOpMean(server, suite, op);
      const b = getOpMean(browser, suite, op);
      if (s === null || b === null) return false;
      const min = Math.min(s, b);
      const ratio = Math.max(s, b) / min;
      return ratio > divergenceThreshold(min);
    })
  );
}

/**
 * Returns operations where any two suites within the same runtime differ by
 * more than 2× — used to filter variant tables (signing, durable, storage)
 * so only rows that tell a meaningfully different story are shown.
 */
function computeVariantDivergentOps(
  summary: RunSummary,
  suites: string[],
): string[] {
  return OPERATION_ORDER.filter((op) => {
    const means = suites
      .map((s) => getOpMean(summary, s, op))
      .filter((m): m is number => m !== null);
    if (means.length < 2) return false;
    // Exclude ops where ALL suites have high CV (pure noise)
    const cvs = suites
      .map((s) => getOpResult(summary, s, op)?.statistics?.cv)
      .filter((c): c is number => c !== undefined);
    if (cvs.length > 0 && cvs.every((c) => c > HIGH_CV_THRESHOLD)) {
      return false;
    }
    const min = Math.min(...means);
    const max = Math.max(...means);
    return max / min > divergenceThreshold(min);
  });
}

/**
 * Mark the CV-robust winner with a filled-primary hero chip; losers and
 * uncertain ties render plain. Only noteworthy data gets chroma — the
 * traffic-light green/amber semantics was removed from the design system.
 */
function comparisonCell(
  myMs: number,
  myCV: number | undefined,
  allMs: number[],
  allCVs: (number | undefined)[],
): string {
  const val = fmtDuration(myMs);
  if (allMs.length < 2) return val;
  const min = Math.min(...allMs);
  const max = Math.max(...allMs);
  if (max / min <= divergenceThreshold(min)) return val;
  if (myMs !== min && myMs !== max) return val;

  // Robustness check: is the gap clear even at the edges of measurement noise?
  const minIdx = allMs.indexOf(min);
  const maxIdx = allMs.indexOf(max);
  const fastUpper = min * (1 + (allCVs[minIdx] ?? 0));
  const slowLower = max * (1 - Math.min(allCVs[maxIdx] ?? 0, 1));
  if (slowLower <= fastUpper) {
    // Variance makes winner uncertain — plain value, high CV still noted
    const cvNote = myCV !== undefined && myCV > HIGH_CV_THRESHOLD
      ? ` <span className="bench-cv">\u00b1${Math.round(myCV * 100)}%</span>`
      : '';
    return `${val}${cvNote}`;
  }

  if (myMs === min) return `<span className="bench-winner">${val}</span>`;
  return val;
}

/**
 * Generate a comparison table (div-wrapped markdown) for given suites.
 * colLabels allows overriding display names (e.g. Binary/JSONL for storage formats).
 * includeOps, when provided, restricts the table to only those operations.
 */
function genComparisonTable(
  summary: RunSummary,
  suites: string[],
  colLabels: string[],
  includeOps?: string[],
): string {
  const available = suites.filter((s) => summary.summary.suites[s]);
  if (available.length === 0) return '';

  const labels = available.map((s) => colLabels[suites.indexOf(s)]);
  const sep = `|-----------|${labels.map(() => '--------|').join('')}`;
  const header = `| Operation | ${
    labels.map((l) => escapeMdxCell(l)).join(' | ')
  } |`;

  const rows: string[] = [];
  for (const op of OPERATION_ORDER) {
    if (includeOps && !includeOps.includes(op)) continue;
    const opData = available.map((s) => {
      const mean = getOpMean(summary, s, op);
      const cv = mean !== null
        ? getOpResult(summary, s, op)?.statistics?.cv
        : undefined;
      return { mean, cv };
    });
    const means = opData
      .filter((d): d is { mean: number; cv: typeof d.cv } => d.mean !== null)
      .map((d) => d.mean);
    const allCVs = opData
      .filter((d): d is { mean: number; cv: typeof d.cv } => d.mean !== null)
      .map((d) => d.cv);

    const cells = opData.map(({ mean, cv }) => {
      if (mean === null) return '---';
      return comparisonCell(mean, cv, means, allCVs);
    });

    if (cells.every((c) => c === '---')) continue;
    rows.push(`| ${escapeMdxCell(op)} | ${cells.join(' | ')} |`);
  }

  return [
    '<div className="benchmark-table">',
    '',
    header,
    sep,
    ...rows,
    '',
    '</div>',
  ].join('\n');
}

/** Generate a detailed stats table for one suite. */
function genDetailedStatsTable(summary: RunSummary, suiteName: string): string {
  const suiteResults = summary.results.filter((r) => r.suite === suiteName);
  if (suiteResults.length === 0) return '';

  const header =
    '| Operation | Average | Median | Stddev | CV | Samples | Throughput |';
  const sep =
    '|-----------|---------|--------|--------|----|---------|------------|';

  // Sort rows by canonical operation order, unknown ops appended at end
  const ordered = OPERATION_ORDER
    .map((op) => suiteResults.find((r) => r.name === op))
    .filter((r): r is typeof suiteResults[0] => r !== undefined);
  const rest = suiteResults.filter(
    (r) => !OPERATION_ORDER.includes(r.name as typeof OPERATION_ORDER[number]),
  );

  const rows = [...ordered, ...rest]
    .map((r) => {
      const s = r.statistics;
      if (!s) return null;
      const medianStr = s.median !== undefined ? fmtDuration(s.median) : '---';
      const cvStr = s.cv !== undefined
        ? (s.cv > HIGH_CV_THRESHOLD
          ? `**${(s.cv * 100).toFixed(0)}%**`
          : `${(s.cv * 100).toFixed(0)}%`)
        : '---';
      return `| ${escapeMdxCell(r.name)} | ${
        fmtDuration(s.mean)
      } | ${medianStr} | ${fmtDuration(s.stddev)} | ${cvStr} | ${s.samples} | ${
        fmtThroughput(s.throughput)
      } |`;
    })
    .filter((r): r is string => r !== null);

  return [header, sep, ...rows].join('\n');
}

/** Generate the methodology table from systemInfo embedded in results. */
function genMethodologyTable(results: Results): string {
  const lines = [
    '| Platform | Hardware | Runtime |',
    '|----------|----------|---------|',
  ];

  const order: Runtime[] = ['deno', 'node', 'browser'];
  for (const runtime of order) {
    const summary = results.get(runtime);
    if (!summary) continue;
    const si = summary.metadata.systemInfo;
    const platform = runtime === 'deno'
      ? 'Deno'
      : runtime === 'node'
      ? 'Node.js'
      : 'Browser';

    let hw = 'Unknown hardware';
    let rt = 'Unknown runtime';

    if (si) {
      const cpu = si.hardware.cpu || 'Unknown CPU';
      const mem = si.hardware.memory ? `, ${si.hardware.memory} RAM` : '';
      const storage = runtime === 'browser' ? ' (OPFS)' : '';
      hw = `${cpu}${mem}${storage}`;

      if (si.runtime.runtime) {
        rt = `${si.runtime.runtime} ${si.runtime.version || ''} (${
          si.runtime.platform || ''
        })`.trim();
      }
    }

    lines.push(`| ${platform} | ${escapeMdxCell(hw)} | ${escapeMdxCell(rt)} |`);
  }

  return lines.join('\n');
}

/** Replace content between sentinel comments for a given marker. */
function replaceSection(
  mdx: string,
  marker: string,
  content: string,
  missingSentinels: string[],
): string {
  const start = `{/* BENCH:${marker}:START */}`;
  const end = `{/* BENCH:${marker}:END */}`;
  const si = mdx.indexOf(start);
  const ei = mdx.indexOf(end);
  if (si === -1 || ei === -1) {
    missingSentinels.push(marker);
    return mdx;
  }
  return mdx.slice(0, si + start.length) + '\n' + content + '\n' +
    mdx.slice(ei);
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname!, '..');
  let inputDir = path.join(repoRoot, 'benchmarks', 'results');
  let docsPath = path.join(repoRoot, 'docs', 'docs', 'benchmarks.md');
  let dryRun = false;

  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i];
    if (arg.startsWith('--input-dir=')) {
      inputDir = arg.slice('--input-dir='.length);
    } else if (arg === '--input-dir') {
      inputDir = Deno.args[++i];
    } else if (arg.startsWith('--docs-path=')) {
      docsPath = arg.slice('--docs-path='.length);
    } else if (arg === '--docs-path') {
      docsPath = Deno.args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      console.error(
        'Usage: deno run -A benchmarks/update-docs.ts [--input-dir=<dir>] [--docs-path=<file>] [--dry-run]',
      );
      Deno.exit(1);
    }
  }

  const results = await loadResults(inputDir);
  if (results.size === 0) {
    console.error(`No benchmark results found in: ${inputDir}`);
    console.error('Run "deno task bench:json" first.');
    Deno.exit(1);
  }

  let mdx: string;
  try {
    mdx = await Deno.readTextFile(docsPath);
  } catch {
    console.error(`Docs file not found: ${docsPath}`);
    console.error('Run from the repository root or pass --docs-path=<file>.');
    Deno.exit(1);
  }

  const deno = results.get('deno');
  const node = results.get('node');
  const browser = results.get('browser');
  const missingSentinels: string[] = [];

  // Methodology table — include all runtimes we have
  mdx = replaceSection(
    mdx,
    'methodology-table',
    genMethodologyTable(results),
    missingSentinels,
  );

  if (deno) {
    mdx = replaceSection(
      mdx,
      'server-comparison',
      genComparisonTable(deno, ['GoatDB', 'SQLite'], ['GoatDB', 'SQLite']),
      missingSentinels,
    );
    mdx = replaceSection(
      mdx,
      'security-modes',
      genComparisonTable(
        deno,
        ['GoatDB', 'GoatDB (Trusted)'],
        ['GoatDB', 'GoatDB (Trusted)'],
        computeVariantDivergentOps(deno, ['GoatDB', 'GoatDB (Trusted)']),
      ),
      missingSentinels,
    );
    // SQLite included as a reference baseline so readers can see how GoatDB's
    // durable and trusted modes compare against a well-known embedded database.
    const durableSuites = [
      'GoatDB (Durable)',
      'GoatDB',
      'SQLite',
      'SQLite Fast-Unsafe',
    ];
    mdx = replaceSection(
      mdx,
      'durable-mode',
      genComparisonTable(
        deno,
        durableSuites,
        durableSuites,
        computeVariantDivergentOps(deno, durableSuites),
      ),
      missingSentinels,
    );
    mdx = replaceSection(
      mdx,
      'storage-formats',
      genComparisonTable(
        deno,
        ['GoatDB', 'GoatDB JSONL'],
        ['Binary (default)', 'JSONL'],
        computeVariantDivergentOps(deno, ['GoatDB', 'GoatDB JSONL']),
      ),
      missingSentinels,
    );

    const statsDenoContent = SERVER_SUITES
      .filter((s) => deno.summary.suites[s])
      .map((s) => `### ${s}\n\n${genDetailedStatsTable(deno, s)}`)
      .join('\n\n');
    mdx = replaceSection(mdx, 'stats-deno', statsDenoContent, missingSentinels);
  }

  if (node) {
    const statsNodeContent = SERVER_SUITES
      .filter((s) => node.summary.suites[s])
      .map((s) => `### ${s}\n\n${genDetailedStatsTable(node, s)}`)
      .join('\n\n');
    mdx = replaceSection(mdx, 'stats-node', statsNodeContent, missingSentinels);
  }

  if (browser) {
    const divergentOps = deno
      ? computeDivergentOps(deno, browser, ['GoatDB', 'SQLite'])
      : undefined;
    mdx = replaceSection(
      mdx,
      'browser-comparison',
      genComparisonTable(
        browser,
        ['GoatDB', 'SQLite'],
        ['GoatDB', 'SQLite (WASM)'],
        divergentOps,
      ),
      missingSentinels,
    );

    const statsBrowserContent = BROWSER_SUITES
      .filter((s) => browser.summary.suites[s])
      .map((s) => `### ${s}\n\n${genDetailedStatsTable(browser, s)}`)
      .join('\n\n');
    mdx = replaceSection(
      mdx,
      'stats-browser',
      statsBrowserContent,
      missingSentinels,
    );
  }

  if (missingSentinels.length > 0) {
    console.error(
      `❌ Missing sentinels in ${docsPath}: ${missingSentinels.join(', ')}`,
    );
    Deno.exit(1);
  }

  if (dryRun) {
    console.log('\n--- Dry run output ---\n');
    console.log(mdx);
  } else {
    await Deno.writeTextFile(docsPath, mdx);
    console.log(`✅ Updated ${docsPath}`);
  }
}

main();
