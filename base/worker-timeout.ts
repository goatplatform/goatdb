/**
 * `GOATDB_TEST_TIMEOUT_MS` contract.
 *
 * WHY standalone: the Node test bundle imports this parser. Keeping it free of
 * imports prevents runner-only modules (browser-runner -> playwright, whose
 * optional deps are not installed) from entering that bundle.
 */

/**
 * Default whole-worker timeout. A single hung test still consumes the entire
 * budget, so the runner reports which test was active when it fired.
 */
const kDefaultWorkerTimeoutMs = 5 * 60 * 1000;

/**
 * Largest delay `setTimeout` honors (2^31-1 ms). Hosts clamp larger delays to
 * 1 ms and warn, so an oversized override aborts the run at once while the
 * diagnostic below still claims the huge requested duration.
 */
const kMaxWorkerTimeoutMs = 2_147_483_647;

/**
 * Parses `GOATDB_TEST_TIMEOUT_MS`. Values outside the integer timer range are
 * rejected instead of silently replaced by the default: a fallback hides
 * typos and makes the override mean something other than what the user typed.
 */
export function parseWorkerTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return kDefaultWorkerTimeoutMs;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > kMaxWorkerTimeoutMs) {
    throw new Error(
      `Invalid GOATDB_TEST_TIMEOUT_MS="${raw}": expected an integer between ` +
        `1 and ${kMaxWorkerTimeoutMs} milliseconds (default ${kDefaultWorkerTimeoutMs}).`,
    );
  }
  return parsed;
}
