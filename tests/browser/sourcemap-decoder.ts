import { SourceMapConsumer } from 'source-map';

export interface DecodedStackTrace {
  original: string;
  decoded: string;
}

export interface OriginalPosition {
  source: string | null;
  line: number | null;
  column: number | null;
  name: string | null;
}

/**
 * Decodes browser stack traces using sourcemaps to show original source locations.
 */
export class SourceMapDecoder {
  private sourceMapCache = new Map<string, SourceMapConsumer>();

  /**
   * Fetches and caches a sourcemap from the given URL.
   */
  private async getSourceMap(
    sourceMapUrl: string,
  ): Promise<SourceMapConsumer | null> {
    if (this.sourceMapCache.has(sourceMapUrl)) {
      return this.sourceMapCache.get(sourceMapUrl)!;
    }

    try {
      console.log(`Fetching sourcemap: ${sourceMapUrl}`);
      const response = await fetch(sourceMapUrl);
      if (!response.ok) {
        console.warn(
          `Failed to fetch sourcemap: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const sourceMapData = await response.json();
      const consumer = await new SourceMapConsumer(sourceMapData);
      this.sourceMapCache.set(sourceMapUrl, consumer);
      return consumer;
    } catch (error) {
      console.warn(
        `Error loading sourcemap from ${sourceMapUrl}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Decodes a single stack trace line from bundled location to original source.
   */
  async decodeStackTraceLine(
    line: string,
    baseUrl: string,
  ): Promise<string> {
    // Match patterns like: "at https://localhost:<port>/app.js:18423:13"
    // or "https://localhost:<port>/app.js:18423:13"
    const stackTraceRegex =
      /(?:at\s+)?([https:\/\/[a-zA-Z0-9\-\.]+(?::\d{1,5})?[a-zA-Z0-9\-\/\.]*\.js):(\d+):(\d+)/g;

    let decodedLine = line;
    let match;

    while ((match = stackTraceRegex.exec(line)) !== null) {
      const [fullMatch, scriptUrl, lineNum, colNum] = match;
      const sourceMapUrl = `${scriptUrl}.map`;

      try {
        const consumer = await this.getSourceMap(sourceMapUrl);
        if (consumer) {
          const originalPosition = consumer.originalPositionFor({
            line: parseInt(lineNum, 10),
            column: parseInt(colNum, 10),
          });

          if (originalPosition.source && originalPosition.line) {
            // Clean up the source path (remove webpack/bundler prefixes)
            let cleanSource = originalPosition.source;
            if (cleanSource.startsWith('./')) {
              cleanSource = cleanSource.substring(2);
            }
            if (cleanSource.startsWith('/')) {
              cleanSource = cleanSource.substring(1);
            }

            const originalLocation = `${cleanSource}:${originalPosition.line}:${
              originalPosition.column || 0
            }`;
            decodedLine = decodedLine.replace(fullMatch, originalLocation);
          }
        }
      } catch (error) {
        console.warn(
          `Error decoding stack trace line "${fullMatch}":`,
          error.message,
        );
      }
    }

    return decodedLine;
  }

  /**
   * Decodes an entire stack trace, mapping bundled locations to original sources.
   */
  async decodeStackTrace(
    stackTrace: string,
    baseUrl: string,
    sourceMapData?: any,
  ): Promise<DecodedStackTrace> {
    const lines = stackTrace.split('\n');
    const decodedLines: string[] = [];

    // If sourcemap data is provided, use it directly instead of fetching
    if (sourceMapData) {
      const consumer = await new SourceMapConsumer(sourceMapData);

      for (const line of lines) {
        if (line.trim()) {
          const decodedLine = await this.decodeStackTraceLineWithConsumer(
            line.trim(),
            consumer,
          );
          decodedLines.push(decodedLine);
        }
      }

      consumer.destroy();
    } else {
      // Fallback to fetching sourcemap
      for (const line of lines) {
        if (line.trim()) {
          const decodedLine = await this.decodeStackTraceLine(
            line.trim(),
            baseUrl,
          );
          decodedLines.push(decodedLine);
        }
      }
    }

    return {
      original: stackTrace,
      decoded: decodedLines.join('\n'),
    };
  }

  /**
   * Decodes a single stack trace line using a provided SourceMapConsumer.
   */
  private async decodeStackTraceLineWithConsumer(
    line: string,
    consumer: SourceMapConsumer,
  ): Promise<string> {
    const stackTraceRegex =
      /(?:at\s+)?([https:\/\/[a-zA-Z0-9\-\.]+(?::\d{1,5})?[a-zA-Z0-9\-\/\.]*\.js):(\d+):(\d+)/g;

    let decodedLine = line;
    let match;

    while ((match = stackTraceRegex.exec(line)) !== null) {
      const [fullMatch, scriptUrl, lineNum, colNum] = match;

      try {
        const originalPosition = consumer.originalPositionFor({
          line: parseInt(lineNum, 10),
          column: parseInt(colNum, 10),
        });

        if (originalPosition.source && originalPosition.line) {
          // Clean up the source path (remove webpack/bundler prefixes)
          let cleanSource = originalPosition.source;
          if (cleanSource.startsWith('./')) {
            cleanSource = cleanSource.substring(2);
          }
          if (cleanSource.startsWith('/')) {
            cleanSource = cleanSource.substring(1);
          }

          const originalLocation = `${cleanSource}:${originalPosition.line}:${
            originalPosition.column || 0
          }`;
          decodedLine = decodedLine.replace(fullMatch, originalLocation);
        }
      } catch (error) {
        console.warn(
          `Error decoding stack trace line "${fullMatch}":`,
          error.message,
        );
      }
    }

    return decodedLine;
  }

  /**
   * Cleanup method to destroy cached sourcemap consumers.
   */
  destroy(): void {
    for (const consumer of this.sourceMapCache.values()) {
      consumer.destroy();
    }
    this.sourceMapCache.clear();
  }
}

/**
 * Global sourcemap decoder instance.
 */
export const sourceMapDecoder = new SourceMapDecoder();
