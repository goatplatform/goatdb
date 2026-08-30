/**
 * MDX-compatibility escaping for TypeDoc-generated markdown.
 *
 * Docusaurus compiles .md files as MDX, where bare `<` and `{`/`}` in prose
 * are parsed as JSX tags / expressions and hard-fail the build. These
 * utilities escape such characters outside fenced and inline code.
 */

function escapeLineForMdx(line: string): string {
  let result = '';
  let codeDelimLen = 0; // 0 = not in inline code
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') {
      // Count consecutive backticks to handle multi-backtick delimiters
      let count = 1;
      while (i + count < line.length && line[i + count] === '`') count++;
      if (codeDelimLen === 0) {
        codeDelimLen = count;
      } else if (count >= codeDelimLen) {
        codeDelimLen = 0;
      }
      result += line.slice(i, i + count);
      i += count - 1;
    } else if (
      codeDelimLen === 0 &&
      ch === '{' &&
      (i === 0 || line[i - 1] !== '\\')
    ) {
      result += '\\{';
    } else if (
      codeDelimLen === 0 &&
      ch === '}' &&
      (i === 0 || line[i - 1] !== '\\')
    ) {
      result += '\\}';
    } else if (
      // MDX parses '<' as a JSX tag start only when it is NOT followed by
      // whitespace; escape such '<' to an entity (mirrors useHTMLEncodedBrackets).
      // Preserve the <Anchor id="..."/> JSX emitted by convertAnchorsToJsx.
      codeDelimLen === 0 &&
      ch === '<'
    ) {
      const anchor = line.slice(i).match(/^<Anchor id="[^"]*"\/>/);
      if (anchor) {
        result += anchor[0];
        i += anchor[0].length - 1;
      } else if (i === 0 || line[i - 1] !== '\\') {
        if (i + 1 < line.length && /\s/.test(line[i + 1])) result += ch;
        else result += '&lt;';
      } else {
        // Already backslash-escaped (\<), leave for MDX to render literally.
        result += ch;
      }
    } else {
      result += ch;
    }
  }
  return result;
}

export function escapeMarkdownForMdx(text: string): string {
  const lines = text.split('\n');
  // Frontmatter lines pass through the escaper too; safe because Docusaurus
  // strips frontmatter before MDX compilation.
  let fenceMarker = ''; // opening fence run ('```' or '~~~'), empty = not in fence
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trimStart().match(/^(`{3,}|~{3,})/);
    if (match) {
      if (!fenceMarker) {
        fenceMarker = match[1];
      } else if (
        match[1][0] === fenceMarker[0] && match[1].length >= fenceMarker.length
      ) {
        fenceMarker = '';
      }
      continue;
    }
    if (!fenceMarker) {
      lines[i] = escapeLineForMdx(lines[i]);
    }
  }
  return lines.join('\n');
}

export function convertAnchorsToJsx(text: string): string {
  // Replace <a id="..."></a> with <Anchor id="..."/> so MDX processes them
  // as JSX components (uppercase) rather than raw HTML (lowercase).
  return text.replace(/<a id="([^"]*?)"><\/a>/g, '<Anchor id="$1"/>');
}
