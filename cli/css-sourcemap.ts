/**
 * Composition of source maps for concatenated CSS chunks.
 *
 * The server exposes a single /index.css built by joining per-entry CSS
 * chunks with '\n'. Each chunk may carry its own esbuild-generated source map;
 * those maps must be composed so the combined /index.css.map stays correct.
 *
 * Format: Source Map v3 "indexed" map (ECMA-426 `sections`), which exists
 * specifically for concatenated output. Each chunk starts at column 0 of a new
 * line in the combined file, so composition is a pure line shift: a section
 * carries the chunk's own map verbatim (the spec makes embedded maps fully
 * independent), positioned at its 0-based start line. No VLQ re-encoding is
 * needed because generated columns are untouched and line offsets are encoded
 * in the section offsets, not in the mappings stream.
 */
export function composeCssSourcemap(
  parts: string[],
  maps: (string | undefined)[],
  file = 'index.css',
): string | undefined {
  const offsets = cssLineOffsets(parts);
  const sections: { offset: { line: number; column: 0 }; map: unknown }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const map = maps[i];
    if (!map) {
      // Chunk without a map: its text simply stays unmapped in the combined
      // output (same as the '\n' separators between chunks).
      continue;
    }
    sections.push({
      offset: { line: offsets[i], column: 0 },
      map: JSON.parse(map),
    });
  }
  if (sections.length === 0) {
    return undefined;
  }
  return JSON.stringify({ version: 3, file, sections });
}

/**
 * 0-based start line of each part in `parts.join('\n')`: the number of '\n'
 * characters in the join-prefix that precedes the part. Newline counting is
 * encoding-agnostic and stays correct even when a part ends with '\n' (the
 * resulting empty line between chunks is simply unmapped).
 */
function cssLineOffsets(parts: string[]): number[] {
  const offsets: number[] = [];
  let line = 0;
  for (const part of parts) {
    offsets.push(line);
    line += countNewlines(part) + 1; // +1 for the join separator
  }
  return offsets;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      count++;
    }
  }
  return count;
}
