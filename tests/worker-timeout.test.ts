/**
 * Contract for the `GOATDB_TEST_TIMEOUT_MS` override.
 *
 * WHY: An override above the timer maximum used to be handed straight to
 * `setTimeout`, which clamps it to 1 ms. The run then failed at once while the
 * diagnostic reported the huge requested duration. These tests pin the
 * accepted range, the explicit rejection message, and the real CLI behavior.
 */

import { TEST, type TestFunc } from './mod.ts';
import { assertEquals, assertTrue } from './asserts.ts';
import { isDeno } from '../base/common.ts';
import { parseWorkerTimeoutMs } from '../base/worker-timeout.ts';
import { fromFileUrl, join } from '../base/path.ts';
import { runAcrossPlatforms } from '../base/multi-runner.ts';
import {
  type compileForNodeWithEsbuild,
  nodeRun,
} from '../base/node-runner.ts';

const kDefaultMs = 5 * 60 * 1000;
const kMaxMs = 2_147_483_647;
const kVarName = 'GOATDB_TEST_TIMEOUT_MS';
const kHangEnvVar = 'GOATDB_TEST_WORKER_HANG';
const kHangSuite = 'WorkerTimeoutHang';
const kHangTest = 'hangs until the worker timeout';
// Two worker heartbeat intervals (10s each) must fit before the timeout so a
// loaded CI runner still delivers a heartbeat to the diagnostic.
const kHangTimeoutMs = 25_000;

function rejectionMessage(raw: string): string {
  try {
    parseWorkerTimeoutMs(raw);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`Expected "${raw}" to be rejected`);
}

/** Skips on runtimes without the `deno` binary used to launch the CLI. */
function denoTest(test: TestFunc): TestFunc {
  return (ctx) => isDeno() ? test(ctx) : undefined;
}

interface CliOptions {
  timeoutOverride?: string;
  runtimeArgs?: string[];
  args?: string[];
  env?: Record<string, string>;
  deadlineMs?: number;
}

/**
 * Runs the real test CLI in a child process, as a user would. The child is
 * killed at the deadline so a broken timeout path fails this suite instead of
 * hanging CI forever.
 */
async function runCli(
  opts: CliOptions = {},
): Promise<{ code: number; output: string; timedOut: boolean }> {
  const repoRoot = fromFileUrl(new URL('..', import.meta.url));
  const args = opts.args ?? [
    '--suite=Path',
    ...(opts.runtimeArgs ?? ['--runtime=deno']),
  ];
  const env: Record<string, string> = { ...opts.env };
  if (opts.timeoutOverride !== undefined) {
    env[kVarName] = opts.timeoutOverride;
  }
  const child = new Deno.Command('deno', {
    args: ['run', '-A', 'tests/run.ts', ...args],
    cwd: repoRoot,
    env,
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();

  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    // The child may finish between the timer firing and this call.
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited.
    }
  }, opts.deadlineMs ?? 30_000);
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(deadline);
  return { code: status.code, output: stdout + stderr, timedOut };
}

/** Extracts a seconds value that the timeout diagnostic must report. */
function diagnosticSeconds(output: string, pattern: RegExp): number {
  const match = output.match(pattern);
  if (match === null) {
    throw new Error(`Missing ${pattern} in output:\n${output}`);
  }
  return Number(match[1]);
}

/** Asserts one CLI launch rejects the override before runtime work starts. */
async function assertCliRejectsBeforeRuntimeWork(
  runtimeArgs: string[],
  runtimeMarker: string,
): Promise<void> {
  const { code, output } = await runCli({
    timeoutOverride: String(kMaxMs + 1),
    runtimeArgs,
  });
  assertTrue(code !== 0, `expected failure, output: ${output}`);
  assertTrue(output.includes(kVarName), output);
  assertTrue(output.includes(String(kMaxMs + 1)), output);
  assertTrue(output.includes(String(kMaxMs)), output);
  // The runtime marker proves no branch-specific work (esbuild, Playwright,
  // subprocess spawn) started before validation.
  assertTrue(!output.includes(runtimeMarker), output);
}

/**
 * Registers the hanging test that the timeout diagnostic test launches.
 * Registration is gated in test-registry.ts: an always-on hanging test would
 * stall every normal run for the whole worker timeout.
 */
export function setupWorkerTimeoutHangTests(): void {
  TEST(kHangSuite, kHangTest, () => new Promise<void>(() => {}));
}

/**
 * Runs the real subprocess path (debug/benchmark) against an entry point that
 * exits non-zero, and returns the orchestrator's error message.
 */
async function denoSubprocessFailureMessage(): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    const entry = join(dir, 'exit5.ts');
    await Deno.writeTextFile(entry, 'Deno.exit(5);\n');
    await runAcrossPlatforms({
      entryPointServer: entry,
      entryPointBrowser: '',
      runtimes: ['deno'],
      mode: 'benchmark',
    });
  } catch (error) {
    return (error as Error).message;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
  throw new Error('Expected the failing Deno subprocess to fail the run');
}

/** Runs the real Node path against an entry point that exits non-zero. */
async function nodeSubprocessFailureMessage(): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    const entry = join(dir, 'exit7.ts');
    await Deno.writeTextFile(entry, 'process.exit(7);\n');
    await runAcrossPlatforms({
      entryPointServer: entry,
      entryPointBrowser: '',
      runtimes: ['node'],
      mode: 'benchmark',
    });
  } catch (error) {
    return (error as Error).message;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
  throw new Error('Expected the failing Node subprocess to fail the run');
}

/**
 * Runs Deno and Node against one entry point that both reject: Deno exits
 * non-zero and esbuild cannot parse it. Returns the aggregate message.
 */
async function brokenRuntimeFailureMessage(): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    const entry = join(dir, 'broken.ts');
    await Deno.writeTextFile(entry, 'const = ;\n');
    await runAcrossPlatforms({
      entryPointServer: entry,
      entryPointBrowser: '',
      runtimes: ['deno', 'node'],
      mode: 'benchmark',
    });
  } catch (error) {
    return (error as Error).message;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
  throw new Error('Expected the broken entry point to fail both runtimes');
}

/**
 * Wraps inline JS as an esbuild result so nodeRun exercises the real Node
 * process contract without a bundling step.
 */
function fakeNodeBuildResult(code: string) {
  return {
    outputFiles: [{ contents: new TextEncoder().encode(code) }],
  } as unknown as Awaited<ReturnType<typeof compileForNodeWithEsbuild>>;
}

export default function setupWorkerTimeoutOverrideTests(): void {
  TEST(
    'WorkerTimeoutOverride',
    'unset override uses the 5 minute default',
    () => {
      assertEquals(parseWorkerTimeoutMs(undefined), kDefaultMs);
    },
  );

  TEST('WorkerTimeoutOverride', 'accepts both ends of the timer range', () => {
    assertEquals(parseWorkerTimeoutMs('1'), 1);
    assertEquals(parseWorkerTimeoutMs(String(kMaxMs)), kMaxMs);
  });

  TEST(
    'WorkerTimeoutOverride',
    'overflow is rejected with the value and the accepted range',
    () => {
      const message = rejectionMessage(String(kMaxMs + 1));
      assertTrue(message.includes(kVarName));
      assertTrue(message.includes(String(kMaxMs + 1)));
      assertTrue(message.includes(String(kMaxMs)));
      assertTrue(message.includes(String(kDefaultMs)));
    },
  );

  TEST(
    'WorkerTimeoutOverride',
    'non-positive, fractional, and non-numeric overrides are rejected',
    () => {
      for (const raw of ['0', '-1', '12.5', 'abc', '']) {
        const message = rejectionMessage(raw);
        assertTrue(message.includes(kVarName), `raw: "${raw}"`);
        assertTrue(message.includes(`"${raw}"`), `raw: "${raw}"`);
      }
    },
  );

  TEST(
    'WorkerTimeoutOverride',
    'overflowing override fails the CLI before any test starts',
    denoTest(async () => {
      const { code, output } = await runCli({
        timeoutOverride: String(kMaxMs + 1),
      });
      assertTrue(code !== 0, `expected failure, output: ${output}`);
      assertTrue(output.includes(kVarName), output);
      assertTrue(output.includes(String(kMaxMs + 1)), output);
      assertTrue(output.includes(String(kMaxMs)), output);
      // The clamp warning proves the oversized value reached setTimeout.
      assertTrue(!output.includes('TimeoutOverflowWarning'), output);
    }),
  );

  TEST(
    'WorkerTimeoutOverride',
    'invalid override fails before Node, browser, or debug work starts',
    denoTest(async () => {
      const cases: Array<[string[], string]> = [
        [['--runtime=node'], 'Bundling with esbuild for Node.js'],
        [['--runtime=browser'], 'Running in Browser'],
        [['--runtime=deno', '--deno-inspect-brk'], 'Running in Deno'],
      ];
      for (const [runtimeArgs, marker] of cases) {
        await assertCliRejectsBeforeRuntimeWork(runtimeArgs, marker);
      }
    }),
  );

  TEST(
    'WorkerTimeoutOverride',
    'failing Deno subprocess fails the orchestrator',
    denoTest(async () => {
      const message = await denoSubprocessFailureMessage();
      assertTrue(message.includes('Deno execution failed'), message);
      assertTrue(message.includes('exit code 5'), message);
    }),
  );

  TEST(
    'RunnerFailureReporting',
    'failing Node subprocess fails the orchestrator',
    denoTest(async () => {
      const message = await nodeSubprocessFailureMessage();
      assertTrue(message.includes('Node.js execution failed'), message);
      assertTrue(message.includes('exit code 7'), message);
    }),
  );

  TEST(
    'RunnerFailureReporting',
    'Node bundling failure keeps collected Deno failures',
    denoTest(async () => {
      const message = await brokenRuntimeFailureMessage();
      assertTrue(message.includes('Deno execution failed'), message);
      assertTrue(message.includes('Node.js bundling failed'), message);
    }),
  );

  TEST(
    'RunnerFailureReporting',
    'nodeRun reports -1 when Node cannot start',
    denoTest(async () => {
      const outcome = await nodeRun(
        fakeNodeBuildResult('process.exit(0);'),
        false,
        { PATH: '/nonexistent' },
      );
      assertEquals(outcome.success, false);
      assertEquals(outcome.code, -1);
    }),
  );

  TEST(
    'WorkerTimeoutOverride',
    'timeout names the active test and reports heartbeat age',
    denoTest(async () => {
      const { code, output, timedOut } = await runCli({
        timeoutOverride: String(kHangTimeoutMs),
        args: [`--suite=${kHangSuite}`, '--runtime=deno'],
        env: { [kHangEnvVar]: '1' },
        deadlineMs: 45_000,
      });
      assertTrue(
        !timedOut,
        `CLI did not exit after the worker timeout:\n${output}`,
      );
      assertTrue(code !== 0, `expected failure, output: ${output}`);
      assertTrue(output.includes('Worker timeout after'), output);
      assertTrue(
        output.includes(`Active test: ${kHangSuite} > ${kHangTest}`),
        output,
      );
      const elapsed = diagnosticSeconds(
        output,
        /Active test elapsed: ([\d.]+)s/,
      );
      const heartbeatAge = diagnosticSeconds(
        output,
        /Last heartbeat: ([\d.]+)s ago/,
      );
      // The heartbeat case updates both values. A broken message type or a
      // failed suite/test check would leave elapsed at 0 and the age at the
      // full runtime, so these bounds reject the silent regression.
      assertTrue(elapsed >= 8, `active test elapsed ${elapsed}s:\n${output}`);
      // Two intervals tolerate the final heartbeat being queued behind the
      // timeout task, while a missing heartbeat leaves the age at ~25s.
      assertTrue(
        heartbeatAge < 20,
        `heartbeat age ${heartbeatAge}s:\n${output}`,
      );
    }),
  );
}
