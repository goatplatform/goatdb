/** Real CLI and browser output guard: skips must never drift into pass/fail. */
import { assertEquals, assertTrue } from './asserts.ts';
import { skipTest, TestsRunner, type TestSummary } from './mod.ts';

const kReason = 'fixture unavailable <offline>';
const kOutcomes = ['passes', 'skips', 'fails'] as const;
type Outcome = typeof kOutcomes[number];

export function displayRunner(): TestsRunner {
  const runner = new TestsRunner();
  const suite = runner.suite('DisplayContract');
  suite.add('passes', () => {});
  suite.add('skips', () => skipTest(kReason));
  suite.add('fails', () => {
    throw new Error('fixture failure');
  });
  return runner;
}

function expectedCounts(name?: Outcome): number[] {
  return name
    ? [1, ...kOutcomes.map((outcome) => Number(outcome === name))]
    : [3, 1, 1, 1];
}

function assertSummary(summary: TestSummary, name?: Outcome): void {
  assertEquals(
    [summary.totalTests, summary.passed, summary.skipped, summary.failed],
    expectedCounts(name),
  );
}

function fixtureSource(name?: Outcome): string {
  return `
    import { displayRunner } from ${JSON.stringify(import.meta.url)};
    import { TestsRunner, summaryExitCode } from './tests/mod.ts';
    const summary = await displayRunner().run(undefined, ${
    JSON.stringify(name)
  });
    TestsRunner.printSummary(summary);
    Deno.exit(summaryExitCode(summary));
  `;
}

async function runDisplayCli(name?: Outcome, strict = false) {
  const result = await new Deno.Command('deno', {
    args: ['eval', fixtureSource(name)],
    env: { CI: 'true', GOATDB_FAIL_ON_SKIP: strict ? '1' : '0' },
    signal: AbortSignal.timeout(30_000),
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code: result.code,
    output: new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr),
  };
}

function assertCliLabels(output: string, name?: Outcome): void {
  const labels = ['DONE', 'SKIP', 'FAIL'];
  for (const outcome of name ? [name] : kOutcomes) {
    const lines = output.split('\n').filter((line) =>
      /^\[(DONE|SKIP|FAIL)\]/.test(line) && line.includes(outcome)
    );
    assertEquals(lines.length, 1, output);
    assertTrue(
      lines[0].startsWith(`[${labels[kOutcomes.indexOf(outcome)]}]`),
      output,
    );
    if (outcome === 'skips') assertTrue(lines[0].includes(kReason), output);
  }
}

function summaryCounts(name?: Outcome) {
  const [, Passed, Skipped, Failed] = expectedCounts(name);
  return { Passed, Skipped, Failed };
}

function assertCliSummary(output: string, name?: Outcome): void {
  const counts = { Total: expectedCounts(name)[0], ...summaryCounts(name) };
  for (const [label, count] of Object.entries(counts)) {
    if (label === 'Total' || label === 'Passed' || count > 0) {
      assertTrue(output.includes(`${label}: ${count}`), output);
    } else {
      assertTrue(!output.includes(`${label}:`), output);
    }
  }
}

async function assertCliCase(name?: Outcome, strict = false): Promise<void> {
  const result = await runDisplayCli(name, strict);
  const fails = !name || name === 'fails' || (strict && name === 'skips');
  assertEquals(result.code, fails ? 1 : 0, result.output);
  assertCliLabels(result.output, name);
  assertCliSummary(result.output, name);
}

export async function assertCliDisplay(): Promise<void> {
  for (const name of [undefined, ...kOutcomes]) await assertCliCase(name);
  await assertCliCase('skips', true);
}

async function displayFrame(): Promise<HTMLIFrameElement> {
  const response = await fetch(location.href);
  assertTrue(response.ok, 'the real browser runner document must load');
  const doc = new DOMParser().parseFromString(
    await response.text(),
    'text/html',
  );
  // Keep the real UI; omit the app bundle so this frame runs only our fixture.
  for (const script of doc.querySelectorAll('script[src]')) script.remove();
  const frame = document.createElement('iframe');
  frame.srcdoc = doc.documentElement.outerHTML;
  const loaded = new Promise<void>((resolve) => frame.onload = () => resolve());
  document.body.appendChild(frame);
  await loaded;
  return frame;
}

async function runBrowserDisplay(frame: HTMLIFrameElement, name?: Outcome) {
  const runner = displayRunner();
  const target = frame.contentWindow!;
  for (const event of ['testStart', 'testComplete'] as const) {
    runner.attach(event, (detail) => {
      target.dispatchEvent(new CustomEvent(event, { detail }));
    });
  }
  const summary = await runner.run(undefined, name);
  target.dispatchEvent(new CustomEvent('testsComplete', { detail: summary }));
  assertSummary(summary, name);
  return frame.contentDocument!;
}

function assertBrowserLabels(doc: Document, name?: Outcome): void {
  const labels = ['passed', 'skipped', 'failed'];
  assertEquals(doc.querySelectorAll('.result-item').length, name ? 1 : 3);
  for (const outcome of name ? [name] : kOutcomes) {
    const label = labels[kOutcomes.indexOf(outcome)];
    const item = doc.querySelector(`.result-item.${label}`);
    assertTrue(item !== null, `missing browser ${label}`);
    assertTrue(item!.textContent!.includes(label.toUpperCase()));
    if (outcome === 'skips') {
      assertEquals(item!.querySelector('.skip-reason')?.textContent, kReason);
      assertEquals(item!.querySelector('.error-message'), null);
    }
  }
}

function assertBrowserSummary(doc: Document, name?: Outcome): void {
  const text = doc.getElementById('results')!.textContent!;
  const counts = summaryCounts(name);
  for (const [label, count] of Object.entries(counts)) {
    assertTrue(text.includes(`${label}: ${count}`), text);
  }
  if (counts.Skipped) assertTrue(!text.includes('All tests passed'), text);
}

export async function assertBrowserDisplay(): Promise<void> {
  for (const name of [undefined, ...kOutcomes]) {
    const frame = await displayFrame();
    try {
      const doc = await runBrowserDisplay(frame, name);
      assertBrowserLabels(doc, name);
      assertBrowserSummary(doc, name);
    } finally {
      frame.remove();
    }
  }
}
