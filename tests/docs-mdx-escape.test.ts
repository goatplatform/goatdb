import { assertEquals } from './asserts.ts';
import { TEST } from './mod.ts';
import {
  convertAnchorsToJsx,
  escapeMarkdownForMdx,
} from '../docs/mdx-escape.ts';

export default function setup(): void {
  TEST('DocsMdxEscape', 'escapes prose < outside inline code', () => {
    const cases: [string, string][] = [
      // Bare '<' followed by non-whitespace breaks MDX -> entity
      ['epsilon <2.2e-16 near-zero', 'epsilon &lt;2.2e-16 near-zero'],
      ['1<2', '1&lt;2'],
      ['trailing <', 'trailing &lt;'],
      // '<' followed by whitespace is literal text in MDX, left as-is
      ['a < b', 'a < b'],
      // Already backslash-escaped, left as-is
      ['a \\< b', 'a \\< b'],
      // Inline code content is never touched
      ['epsilon `<2.2e-16` near-zero', 'epsilon `<2.2e-16` near-zero'],
    ];
    for (const [line, want] of cases) {
      assertEquals(escapeMarkdownForMdx(line), want);
    }
  });

  TEST('DocsMdxEscape', 'escapes prose braces outside inline code', () => {
    const cases: [string, string][] = [
      ['{a: 1}', '\\{a: 1\\}'],
      ['x {not code', 'x \\{not code'],
      ['`{literal}`', '`{literal}`'],
    ];
    for (const [line, want] of cases) {
      assertEquals(escapeMarkdownForMdx(line), want);
    }
  });

  TEST('DocsMdxEscape', 'leaves fenced code content untouched', () => {
    const fenced = ['```', '<2 {x}', '```'].join('\n');
    assertEquals(escapeMarkdownForMdx(fenced), fenced);
    const tildes = ['~~~', '<2 {x}', '~~~'].join('\n');
    assertEquals(escapeMarkdownForMdx(tildes), tildes);
    const mixed = ['```ts', '~~~', '<2 {x}', '~~~', '```'].join('\n');
    assertEquals(escapeMarkdownForMdx(mixed), mixed);
  });

  TEST('DocsMdxEscape', 'anchor pipeline preserves JSX, escapes prose', () => {
    const text = 'see <a id="s-1"></a> then 1<2';
    const escaped = escapeMarkdownForMdx(convertAnchorsToJsx(text));
    assertEquals(escaped, 'see <Anchor id="s-1"/> then 1&lt;2');
  });
}
