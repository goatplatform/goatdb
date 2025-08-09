/**
 * Simple progress bar for terminal output.
 * Zero dependencies, cross-platform.
 */

import { isBrowser } from '../base/common.ts';

/**
 * ProgressBar provides a simple, cross-platform progress bar for terminal
 * output. It is designed to work in both Node.js and Deno environments, and
 * automatically disables itself in browser contexts.
 *
 * Usage:
 *   const bar = new ProgressBar(100);
 *   for (let i = 1; i <= 100; i++) {
 *     bar.update(i, `Processing item ${i}`);
 *   }
 *   bar.finish();
 */
export class ProgressBar {
  /** Current progress value */
  private current = 0;
  /** Total value to reach for completion */
  private total: number;
  /** Optional message to display alongside the progress bar */
  private message = '';
  /** Optional title to display above the progress bar */
  private title = '';
  /** Tracks the length of the last rendered line for clearing */
  private lastLineLength = 0;
  /** Tracks the number of lines used by title */
  private titleLines = 0;
  /** Whether the progress bar is enabled (not in browser and not explicitly disabled) */
  private enabled: boolean;

  /**
   * Create a new ProgressBar.
   * @param total The total value representing 100% progress.
   * @param enabled Whether to enable the progress bar (default: true). Automatically disabled in browsers.
   */
  constructor(total: number, enabled = true) {
    this.total = total;
    // Disable progress bar in browser or if explicitly disabled
    this.enabled = enabled && !isBrowser();
  }

  /**
   * Update the progress bar to a new value and message.
   * @param current The current progress value.
   * @param message Optional message to display.
   * @param title Optional title to display above the progress bar.
   */
  update(current: number, message: string, title?: string) {
    this.current = current;
    this.message = message;
    if (title !== undefined) {
      this.title = title;
    }
    this.render();
  }

  /**
   * Render the progress bar to the terminal or log output.
   * Handles both Node.js and Deno, and falls back to console.log if necessary.
   * In browser or when disabled, only logs at the start and end.
   */
  private render() {
    if (!this.enabled) {
      // In browser or when disabled, just log the message once at start or end
      if (this.current === 1 || this.current === this.total) {
        const titlePart = this.title ? `${this.title}: ` : '';
        console.log(`${titlePart}${this.current}/${this.total} ${this.message}`);
      }
      return;
    }

    const percent = Math.floor((this.current / this.total) * 100);
    const width = 40;
    const filled = Math.floor((percent / 100) * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

    const progressLine = `[${bar}] ${this.current}/${this.total} ${this.message}`;

    // deno-lint-ignore no-explicit-any
    const stdout = (globalThis as any).process?.stdout ||
      (globalThis as any).Deno?.stdout;

    if (stdout?.write) {
      // Calculate total lines to clear (title + progress line)
      const totalLinesToClear = this.titleLines + (this.lastLineLength > 0 ? 1 : 0);
      
      // Move cursor to beginning of current line
      stdout.write('\r');
      
      // Move cursor up to the start of our output block
      if (totalLinesToClear > 1) {
        stdout.write(`\x1b[${totalLinesToClear - 1}A`);
      }
      
      // Clear from cursor to end of screen
      stdout.write('\x1b[0J');
      
      // Write title if present
      if (this.title) {
        stdout.write(this.title + '\n');
        this.titleLines = 1;
      } else {
        this.titleLines = 0;
      }
      
      // Write progress line
      stdout.write(progressLine);
      this.lastLineLength = progressLine.length;

      if (this.current === this.total) {
        stdout.write('\n');
        this.lastLineLength = 0;
        this.titleLines = 0;
      }
    } else {
      // Fallback to console.log
      if (this.title) {
        console.log(this.title);
      }
      console.log(progressLine);
    }
  }

  /**
   * Finish the progress bar and clear the line.
   * @param message Optional message to display after finishing (not shown, line is cleared).
   */
  finish(message?: string) {
    this.clear();
    if (message) {
      console.log(message);
    }
  }

  /**
   * Clear the progress bar and title from the terminal.
   * Does nothing if not enabled or if nothing was rendered.
   */
  clear() {
    if (!this.enabled || (this.lastLineLength === 0 && this.titleLines === 0)) return;

    // deno-lint-ignore no-explicit-any
    const stdout = (globalThis as any).process?.stdout ||
      (globalThis as any).Deno?.stdout;

    if (stdout?.write) {
      // Calculate total lines to clear (title + progress line)
      const totalLinesToClear = this.titleLines + (this.lastLineLength > 0 ? 1 : 0);
      
      // Move cursor to beginning of current line
      stdout.write('\r');
      
      // Move cursor up to the start of our output block
      if (totalLinesToClear > 1) {
        stdout.write(`\x1b[${totalLinesToClear - 1}A`);
      }
      
      // Clear from cursor to end of screen
      stdout.write('\x1b[0J');
      
      this.lastLineLength = 0;
      this.titleLines = 0;
    }
  }
}
