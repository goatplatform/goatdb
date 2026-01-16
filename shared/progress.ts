/**
 * Hierarchical progress tracking for terminal output.
 * Zero dependencies, cross-platform.
 *
 * Provides:
 * - Task: Individual task with state machine (pending → running → done/failed)
 * - ProgressManager: Task registry with hierarchy management
 * - InteractiveRenderer: ANSI multi-line display for TTY
 * - SimpleRenderer: Plain text output for CI/non-TTY
 */

import { isBrowser } from '../base/common.ts';
import { getRuntime, isInteractiveTerminal, terminalSize } from '../base/runtime/index.ts';

// ============================================================================
// Types
// ============================================================================

/** Unique identifier for a task */
export type TaskId = string;

/** Task status in the state machine */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

// ============================================================================
// Task Class
// ============================================================================

/**
 * Represents an individual task with state machine.
 *
 * State transitions:
 *   pending → running (on first update)
 *   running → done | failed (on complete)
 *
 * Invariants:
 *   - depth === 0 iff parentId === null
 *   - 0 <= current <= total (when total is defined)
 *   - Bidirectional: parent.children.includes(id) iff child.parentId === parent.id
 */
export class Task {
  readonly id: TaskId;
  readonly title: string;
  readonly parentId: TaskId | null;
  readonly children: TaskId[] = [];
  readonly depth: number;

  private _current = 0;
  private _total: number | null;
  private _message = '';
  private _status: TaskStatus = 'pending';

  constructor(
    id: TaskId,
    title: string,
    total: number | null,
    parentId: TaskId | null = null,
    depth = 0,
  ) {
    this.id = id;
    this.title = title;
    this._total = total;
    this.parentId = parentId;
    this.depth = depth;
  }

  /** Current progress value */
  get current(): number {
    return this._current;
  }

  /** Target value (null = indeterminate) */
  get total(): number | null {
    return this._total;
  }

  /** Status message */
  get message(): string {
    return this._message;
  }

  /** Current state */
  get status(): TaskStatus {
    return this._status;
  }

  /**
   * Update progress. Transitions pending → running on first call.
   * Clamps current to [0, total] when total is defined.
   */
  update(current: number, message?: string): void {
    if (this._total !== null) {
      if (current < 0) {
        console.warn(`Task ${this.id}: current ${current} clamped to 0`);
        current = 0;
      } else if (current > this._total) {
        console.warn(
          `Task ${this.id}: current ${current} clamped to ${this._total}`,
        );
        current = this._total;
      }
    }
    this._current = current;
    if (message !== undefined) {
      this._message = message;
    }
    if (this._status === 'pending') {
      this._status = 'running';
    }
  }

  /**
   * Complete the task with given status.
   */
  complete(status: 'done' | 'failed' = 'done'): void {
    this._status = status;
    // Set current to total on completion if determinate
    if (status === 'done' && this._total !== null) {
      this._current = this._total;
    }
  }

  /**
   * Add a child task ID to this task's children list.
   */
  addChild(childId: TaskId): void {
    this.children.push(childId);
  }

  /**
   * Compute aggregated progress from children.
   * If some children are indeterminate, returns ratio of completed children.
   * Returns own progress if no children.
   */
  aggregatedProgress(tasks: Map<TaskId, Task>): number | null {
    if (this.children.length === 0) {
      if (this._total === null) return null;
      return this._total === 0 ? 1 : this._current / this._total;
    }

    let sumCurrent = 0;
    let sumTotal = 0;
    let hasIndeterminate = false;
    let completedChildren = 0;

    for (const childId of this.children) {
      const child = tasks.get(childId);
      if (!child) continue;

      if (child.status === 'done' || child.status === 'failed') {
        completedChildren++;
      }

      if (child.total === null) {
        hasIndeterminate = true;
      } else {
        sumCurrent += child.current;
        sumTotal += child.total;
      }
    }

    // If some children are indeterminate, show completion ratio of children
    if (hasIndeterminate) {
      return completedChildren / this.children.length;
    }

    return sumTotal === 0 ? 1 : sumCurrent / sumTotal;
  }
}

// ============================================================================
// Renderer Interface
// ============================================================================

/**
 * Abstract renderer for progress display.
 * Implementations handle different output strategies (ANSI vs plain text).
 */
export interface Renderer {
  /** Render the current task state */
  render(tasks: Map<TaskId, Task>, roots: TaskId[], changed: TaskId[], spinnerFrame: number): void;
  /** Clear all rendered output */
  clear(): void;
  /** Finalize rendering (cleanup) */
  finish(): void;
}

/**
 * Write function type for dependency injection.
 * Allows renderers to be tested without real stdout.
 */
export type WriteFn = (data: string) => void;

// ============================================================================
// InteractiveRenderer
// ============================================================================

/** Spinner frames for indeterminate progress */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Status symbols for visual feedback */
const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  pending: '○',
  running: '⠋',
  done: '✓',
  failed: '✗',
};

/**
 * ANSI-based renderer for interactive terminals.
 * Uses cursor movement and clearing for in-place updates.
 */
export class InteractiveRenderer implements Renderer {
  private previousLineCount = 0;
  private currentSpinnerFrame = 0;
  private enabled = true;
  private cols: number;
  private rows: number;

  constructor(
    private writeFn: WriteFn,
    terminalSize: { cols: number; rows: number } = { cols: 80, rows: 24 },
  ) {
    this.cols = terminalSize.cols;
    this.rows = terminalSize.rows;
  }

  /**
   * Update terminal dimensions (called on resize).
   */
  updateSize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * Collect visible tasks in depth-first order.
   * Ensures parents are always included before children (C-004: never render partial hierarchy).
   */
  private collectVisibleTasks(
    tasks: Map<TaskId, Task>,
    roots: TaskId[],
  ): Task[] {
    // First, collect ALL visible tasks without truncation
    const allVisible: Task[] = [];

    const visit = (taskId: TaskId): void => {
      const task = tasks.get(taskId);
      if (!task) return;

      // Show all tasks with their status symbols (○ pending, ⠋ running, ✓ done, ✗ failed)
      allVisible.push(task);

      for (const childId of task.children) {
        visit(childId);
      }
    };

    for (const rootId of roots) {
      visit(rootId);
    }

    // If within limit, return all
    const maxLines = this.rows - 2; // Leave room for prompt
    if (allVisible.length <= maxLines) {
      return allVisible;
    }

    // Truncate by removing deepest leaf tasks first, preserving ancestors
    // Sort by depth descending, then filter to keep parents
    const result: Task[] = [];
    const included = new Set<TaskId>();

    // Add tasks up to limit, preferring shallower tasks
    // We iterate in original order but skip if we exceed limit
    // and the task has no included descendants
    for (const task of allVisible) {
      if (result.length >= maxLines) {
        // Only add if we already included a child of this task
        const hasIncludedChild = task.children.some((cid) => included.has(cid));
        if (!hasIncludedChild) continue;
      }
      result.push(task);
      included.add(task.id);
    }

    // Re-sort result to maintain depth-first order
    // Since we may have added parents after children during truncation
    const orderMap = new Map(allVisible.map((t, i) => [t.id, i]));
    result.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

    // Final truncation if still over limit - remove from end (deepest)
    while (result.length > maxLines) {
      result.pop();
    }

    return result;
  }

  /**
   * Format a progress bar string.
   */
  private formatBar(progress: number | null, width = 12): string {
    if (progress === null) {
      // Indeterminate: show spinner
      const frame = SPINNER_FRAMES[this.currentSpinnerFrame % SPINNER_FRAMES.length];
      return frame;
    }
    const filled = Math.floor(progress * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  /**
   * Get status symbol, using animated spinner for running tasks.
   */
  private getSymbol(status: TaskStatus): string {
    if (status === 'running') {
      return SPINNER_FRAMES[this.currentSpinnerFrame % SPINNER_FRAMES.length];
    }
    return STATUS_SYMBOLS[status];
  }

  /**
   * Format a single task line.
   * Progress bar and count are only shown when total > 1 (meaningful progress).
   */
  private formatTask(task: Task, tasks: Map<TaskId, Task>): string {
    const indent = '  '.repeat(task.depth);
    const symbol = this.getSymbol(task.status);
    const title = task.title;
    const message = task.message ? ` ${task.message}` : '';

    // Only show progress bar and count when meaningful (total > 1)
    let progressPart = '';
    if (task.total !== null && task.total > 1) {
      const progress = task.aggregatedProgress(tasks);
      const bar = this.formatBar(progress);
      const current = task.children.length > 0
        ? Math.floor((progress ?? 0) * task.total)
        : task.current;
      progressPart = ` [${bar}] ${current}/${task.total}`;
    }

    // Build line and truncate to terminal width
    let line = `${indent}${symbol} ${title}${progressPart}${message}`;
    if (line.length > this.cols) {
      line = line.slice(0, this.cols - 1) + '…';
    }

    return line;
  }

  render(tasks: Map<TaskId, Task>, roots: TaskId[], _changed: TaskId[], spinnerFrame: number): void {
    if (!this.enabled) return;

    this.currentSpinnerFrame = spinnerFrame;
    const visibleTasks = this.collectVisibleTasks(tasks, roots);


    const hiddenCount = tasks.size - visibleTasks.length;

    // Build complete output string for atomic write
    let output = '';

    // Hide cursor
    output += '\x1b[?25l';

    // Position cursor: CR + CUU (cursor up)
    output += '\r';
    if (this.previousLineCount > 0) {
      output += `\x1b[${this.previousLineCount}A`;
    }

    // Clear from cursor to end of screen
    output += '\x1b[0J';

    // Render each visible task
    let lineCount = 0;
    for (const task of visibleTasks) {
      const line = this.formatTask(task, tasks);
      output += line + '\x1b[0K\n';
      lineCount++;
    }

    // Show overflow indicator if tasks are hidden
    if (hiddenCount > 0) {
      output += `[+${hiddenCount} hidden]\x1b[0K\n`;
      lineCount++;
    }

    // Show cursor
    output += '\x1b[?25h';

    // Atomic write
    try {
      this.writeFn(output);
    } catch (e) {
      console.warn('InteractiveRenderer: render failed, disabling', e);
      this.enabled = false;
    }

    this.previousLineCount = lineCount;
  }

  clear(): void {
    if (!this.enabled || this.previousLineCount === 0) return;

    let output = '\r';
    if (this.previousLineCount > 0) {
      output += `\x1b[${this.previousLineCount}A`;
    }
    output += '\x1b[0J';

    try {
      this.writeFn(output);
    } catch (e) {
      console.warn('InteractiveRenderer: clear failed, disabling', e);
      this.enabled = false;
    }

    this.previousLineCount = 0;
  }

  finish(): void {
    this.clear();
  }
}

// ============================================================================
// CompactRenderer
// ============================================================================

/**
 * Compact renderer showing summary + rolling window of running tests.
 * Only displays currently running tests, not completed ones.
 * Format: ⠋ Running Tests [████░░░░░░░░] 8/18 | ✓ 7 | ✗ 0
 */
export class CompactRenderer implements Renderer {
  private previousLineCount = 0;
  private currentSpinnerFrame = 0;
  private enabled = true;
  private cols: number;

  constructor(
    private writeFn: WriteFn,
    terminalSize: { cols: number; rows: number } = { cols: 80, rows: 24 },
  ) {
    this.cols = terminalSize.cols;
  }

  updateSize(cols: number, _rows: number): void {
    this.cols = cols;
  }

  private getSpinner(): string {
    return SPINNER_FRAMES[this.currentSpinnerFrame % SPINNER_FRAMES.length];
  }

  private formatBar(progress: number, width = 12): string {
    const filled = Math.floor(progress * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  /**
   * Build the path to a task (Suite > Test)
   */
  private buildPath(task: Task, tasks: Map<TaskId, Task>): string {
    const parts: string[] = [];
    let current: Task | undefined = task;

    while (current) {
      // Skip root task (depth 0)
      if (current.depth > 0) {
        parts.unshift(current.title);
      }
      current = current.parentId ? tasks.get(current.parentId) : undefined;
    }

    return parts.join(' > ');
  }

  render(tasks: Map<TaskId, Task>, roots: TaskId[], _changed: TaskId[], spinnerFrame: number): void {
    if (!this.enabled) return;

    this.currentSpinnerFrame = spinnerFrame;

    // Count passed, failed, and find running tests
    let passed = 0;
    let failed = 0;
    let total = 0;
    const runningTests: Task[] = [];
    let rootTask: Task | undefined;

    for (const task of tasks.values()) {
      // Root task (depth 0) is the overall container
      if (task.depth === 0) {
        rootTask = task;
        continue;
      }

      // Only count leaf tasks (no children) for accurate counts
      if (task.children.length === 0) {
        total++;
        if (task.status === 'done') passed++;
        else if (task.status === 'failed') failed++;
        else if (task.status === 'running') runningTests.push(task);
      }
    }

    // Build output
    let output = '';

    // Hide cursor
    output += '\x1b[?25l';

    // Position cursor
    output += '\r';
    if (this.previousLineCount > 0) {
      output += `\x1b[${this.previousLineCount}A`;
    }

    // Clear from cursor to end of screen
    output += '\x1b[0J';

    let lineCount = 0;

    // Summary header line
    const spinner = this.getSpinner();
    const progress = total > 0 ? (passed + failed) / total : 0;
    const bar = this.formatBar(progress);
    const rootTitle = rootTask?.title ?? 'Running';

    let header = `${spinner} ${rootTitle} [${bar}] ${passed + failed}/${total}`;
    header += ` | ✓ ${passed}`;
    if (failed > 0) {
      header += ` | ✗ ${failed}`;
    }

    if (header.length > this.cols) {
      header = header.slice(0, this.cols - 1) + '…';
    }
    output += header + '\x1b[0K\n';
    lineCount++;

    // Show running test (max 1)
    if (runningTests.length > 0) {
      output += '\n';
      lineCount++;

      const runningTask = runningTests[0];
      const path = this.buildPath(runningTask, tasks);
      let runningLine = `  ${this.getSpinner()} ${path}`;
      if (runningTask.message) {
        runningLine += ` ${runningTask.message}`;
      }

      if (runningLine.length > this.cols) {
        runningLine = runningLine.slice(0, this.cols - 1) + '…';
      }
      output += runningLine + '\x1b[0K\n';
      lineCount++;
    }

    // Show cursor
    output += '\x1b[?25h';

    try {
      this.writeFn(output);
    } catch (e) {
      console.warn('CompactRenderer: render failed, disabling', e);
      this.enabled = false;
    }

    this.previousLineCount = lineCount;
  }

  clear(): void {
    if (!this.enabled || this.previousLineCount === 0) return;

    let output = '\r';
    if (this.previousLineCount > 0) {
      output += `\x1b[${this.previousLineCount}A`;
    }
    output += '\x1b[0J';

    try {
      this.writeFn(output);
    } catch (e) {
      console.warn('CompactRenderer: clear failed, disabling', e);
      this.enabled = false;
    }

    this.previousLineCount = 0;
  }

  finish(): void {
    this.clear();
  }
}

// ============================================================================
// SimpleRenderer
// ============================================================================

/** Status labels for plain text output */
const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'START',
  running: 'RUN',
  done: 'DONE',
  failed: 'FAIL',
};

/**
 * Plain text renderer for non-TTY and CI environments.
 * Emits one line per state change, no ANSI sequences.
 */
export class SimpleRenderer implements Renderer {
  private enabled = true;
  private lastStatus = new Map<TaskId, TaskStatus>();

  constructor(private writeFn: WriteFn) {}

  render(tasks: Map<TaskId, Task>, _roots: TaskId[], changed: TaskId[], _spinnerFrame: number): void {
    if (!this.enabled) return;

    for (const taskId of changed) {
      const task = tasks.get(taskId);
      if (!task) continue;

      // Only emit when status changes
      const prevStatus = this.lastStatus.get(taskId);
      if (prevStatus === task.status) continue;

      this.lastStatus.set(taskId, task.status);

      const indent = '  '.repeat(task.depth);
      const label = STATUS_LABELS[task.status];
      const progress =
        task.total !== null ? ` (${task.current}/${task.total})` : '';
      const line = `[${label}] ${indent}${task.title}${progress}\n`;

      try {
        this.writeFn(line);
      } catch (e) {
        console.warn('SimpleRenderer: write failed, disabling', e);
        this.enabled = false;
      }
    }
  }

  clear(): void {
    // No-op for simple renderer (output is append-only)
  }

  finish(): void {
    // No-op
  }
}

// ============================================================================
// ProgressManager
// ============================================================================

/** Display mode for interactive renderer */
export type DisplayMode = 'compact' | 'tree';

/** Options for ProgressManager */
export interface ProgressManagerOptions {
  /** Enable/disable progress display (default: true) */
  enabled?: boolean;
  /** Display mode: 'compact' (summary + running) or 'tree' (full hierarchy) */
  mode?: DisplayMode;
}

/** Maximum hierarchy depth */
const MAX_DEPTH = 10;

/** Maximum concurrent tasks */
const MAX_TASKS = 1000;

/** Counter for generating unique task IDs */
let taskIdCounter = 0;

/**
 * Generates a unique task ID.
 */
function generateTaskId(): TaskId {
  return `task-${++taskIdCounter}`;
}

/**
 * Detects CI environment by checking common CI platform variables.
 */
function isCIEnvironment(): boolean {
  try {
    // deno-lint-ignore no-explicit-any
    const deno = (globalThis as any).Deno;
    if (deno?.env?.get) {
      return !!(
        deno.env.get('CI') ||
        deno.env.get('GITHUB_ACTIONS') ||
        deno.env.get('GITLAB_CI') ||
        deno.env.get('CIRCLECI') ||
        deno.env.get('TRAVIS') ||
        deno.env.get('JENKINS_URL') ||
        deno.env.get('BUILDKITE')
      );
    }
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    if (proc?.env) {
      return !!(
        proc.env.CI ||
        proc.env.GITHUB_ACTIONS ||
        proc.env.GITLAB_CI ||
        proc.env.CIRCLECI ||
        proc.env.TRAVIS ||
        proc.env.JENKINS_URL ||
        proc.env.BUILDKITE
      );
    }
  } catch {
    // Ignore errors
  }
  return false;
}

/**
 * Gets stdout write function using the runtime adapter.
 */
function getStdoutWrite(): WriteFn | null {
  const runtimeId = getRuntime().id;
  try {
    if (runtimeId === 'deno') {
      // deno-lint-ignore no-explicit-any
      const deno = (globalThis as any).Deno;
      const encoder = new TextEncoder();
      return (data: string) => deno.stdout.writeSync(encoder.encode(data));
    }
    if (runtimeId === 'node') {
      // deno-lint-ignore no-explicit-any
      const proc = (globalThis as any).process;
      return (data: string) => proc.stdout.write(data);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Sets up a terminal resize handler using the runtime adapter.
 * Returns a cleanup function to remove the listener.
 */
function setupResizeHandler(onResize: () => void): () => void {
  const runtimeId = getRuntime().id;
  try {
    if (runtimeId === 'deno') {
      // deno-lint-ignore no-explicit-any
      const deno = (globalThis as any).Deno;
      deno.addSignalListener('SIGWINCH', onResize);
      return () => {
        try {
          deno.removeSignalListener('SIGWINCH', onResize);
        } catch {
          // Ignore cleanup errors
        }
      };
    }
    if (runtimeId === 'node') {
      // deno-lint-ignore no-explicit-any
      const proc = (globalThis as any).process;
      proc.stdout.on('resize', onResize);
      return () => {
        try {
          proc.stdout.off('resize', onResize);
        } catch {
          // Ignore cleanup errors
        }
      };
    }
  } catch {
    // Ignore setup errors
  }
  return () => {};
}

/**
 * Manages hierarchical task progress with automatic renderer selection.
 *
 * API:
 *   create(title, total, parentId?) → TaskId
 *   update(id, current, message?) → void
 *   complete(id, status?) → void
 *   finish() → void
 */
export class ProgressManager {
  private readonly tasks = new Map<TaskId, Task>();
  private readonly roots: TaskId[] = [];
  private readonly changed: TaskId[] = [];
  private renderer: Renderer | null = null;
  private enabled: boolean;
  private resizeCleanup: (() => void) | null = null;
  private _spinnerFrame = 0;

  constructor(options: ProgressManagerOptions | boolean = {}) {
    // Handle legacy boolean argument
    const opts: ProgressManagerOptions =
      typeof options === 'boolean' ? { enabled: options } : options;

    const enabled = opts.enabled ?? true;
    const mode = opts.mode ?? 'compact';

    // Disable in browser
    if (isBrowser()) {
      this.enabled = false;
      return;
    }

    this.enabled = enabled;
    if (!enabled) return;

    const writeFn = getStdoutWrite();
    if (!writeFn) {
      this.enabled = false;
      return;
    }

    // Select renderer based on environment and mode
    if (!isInteractiveTerminal() || isCIEnvironment()) {
      this.renderer = new SimpleRenderer(writeFn);
    } else if (mode === 'compact') {
      const compactRenderer = new CompactRenderer(writeFn, terminalSize());
      this.renderer = compactRenderer;

      // Set up terminal resize handling
      this.resizeCleanup = setupResizeHandler(() => {
        const size = terminalSize();
        compactRenderer.updateSize(size.cols, size.rows);
      });
    } else {
      const interactiveRenderer = new InteractiveRenderer(
        writeFn,
        terminalSize(),
      );
      this.renderer = interactiveRenderer;

      // Set up terminal resize handling
      this.resizeCleanup = setupResizeHandler(() => {
        const size = terminalSize();
        interactiveRenderer.updateSize(size.cols, size.rows);
      });
    }
  }

  /**
   * Create a new task.
   *
   * @param title Display title (must be non-empty)
   * @param total Target value (must be > 0, or null for indeterminate)
   * @param parentId Optional parent task ID
   * @returns The new task's ID
   */
  create(title: string, total: number | null, parentId?: TaskId): TaskId {
    // Validate title
    if (!title || title.trim() === '') {
      throw new Error('Task title must be a non-empty string');
    }

    // Validate total
    if (total !== null && total <= 0) {
      throw new Error('Task total must be greater than 0, or null for indeterminate');
    }

    if (this.tasks.size >= MAX_TASKS) {
      throw new Error(`Maximum task limit (${MAX_TASKS}) exceeded`);
    }

    let depth = 0;
    let parent: Task | undefined;

    if (parentId) {
      parent = this.tasks.get(parentId);
      if (!parent) {
        throw new Error(`Parent task ${parentId} not found`);
      }
      depth = parent.depth + 1;
      if (depth > MAX_DEPTH) {
        throw new Error(`Maximum hierarchy depth (${MAX_DEPTH}) exceeded`);
      }
    }

    const id = generateTaskId();
    const task = new Task(id, title, total, parentId ?? null, depth);
    this.tasks.set(id, task);

    if (parent) {
      parent.addChild(id);
    } else {
      this.roots.push(id);
    }

    this.changed.push(id);
    this.scheduleRender();

    return id;
  }

  /**
   * Update task progress.
   */
  update(id: TaskId, current: number, message?: string): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    task.update(current, message);
    this.changed.push(id);
    this.scheduleRender();
  }

  /**
   * Complete a task.
   */
  complete(id: TaskId, status: 'done' | 'failed' = 'done'): void {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    task.complete(status);
    this.changed.push(id);
    this.scheduleRender();
  }

  /**
   * Finalize all rendering.
   */
  finish(): void {
    this.renderer?.finish();
    // Clean up resize listener
    if (this.resizeCleanup) {
      this.resizeCleanup();
      this.resizeCleanup = null;
    }
  }

  /**
   * Clear all rendered output.
   */
  clear(): void {
    this.renderer?.clear();
  }

  /**
   * Trigger a re-render without updating any task state.
   * Used for spinner animation in the TUI.
   */
  triggerRender(): void {
    this.scheduleRender();
  }

  /**
   * Returns a read-only view of all tasks.
   * Primarily for testing and debugging.
   */
  getTasks(): ReadonlyMap<TaskId, Task> {
    return this.tasks;
  }

  /**
   * Returns a read-only array of root task IDs.
   * Primarily for testing and debugging.
   */
  getRoots(): readonly TaskId[] {
    return this.roots;
  }

  private renderPending = false;

  private scheduleRender(): void {
    if (!this.enabled || !this.renderer || this.renderPending) return;

    this.renderPending = true;
    // Use queueMicrotask for batching updates
    queueMicrotask(() => {
      this.renderPending = false;
      this._spinnerFrame = (this._spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.renderer?.render(this.tasks, this.roots, [...this.changed], this._spinnerFrame);
      this.changed.length = 0;
    });
  }
}

// ============================================================================
// Legacy ProgressBar (for backwards compatibility)
// ============================================================================

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
  /** Tracks the number of physical lines used by progress bar (accounts for wrapping) */
  private lastLineCount = 0;
  /** Tracks the number of physical lines used by title (accounts for wrapping) */
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
    // Disable progress bar in browser, if explicitly disabled, or if not a TTY
    this.enabled = enabled && !isBrowser() && isInteractiveTerminal();
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
      // In browser or when disabled, don't log anything
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
    const cols = stdout?.columns || 80;

    if (stdout?.write) {
      // Calculate total lines to clear (title + progress line, accounting for wrapping)
      const totalLinesToClear = this.titleLines + this.lastLineCount;

      // Build complete output string for atomic write
      let output = '';

      // Position cursor: CR + optional CUU (cursor up)
      output += '\r';
      if (totalLinesToClear > 1) {
        output += `\x1b[${totalLinesToClear - 1}A`;
      }

      // Clear from cursor to end of screen
      output += '\x1b[0J';

      // Add title if present (calculate physical lines accounting for terminal wrapping)
      if (this.title) {
        output += this.title + '\n';
        this.titleLines = Math.ceil((this.title.length + 1) / cols);
      } else {
        this.titleLines = 0;
      }

      // Add progress line (calculate physical lines accounting for terminal wrapping)
      output += progressLine;
      this.lastLineCount = Math.ceil(progressLine.length / cols);

      if (this.current === this.total) {
        output += '\n';
        this.lastLineCount = 0;
        this.titleLines = 0;
      }

      // Single atomic write
      stdout.write(output);
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
    if (!this.enabled || (this.lastLineCount === 0 && this.titleLines === 0)) return;

    // deno-lint-ignore no-explicit-any
    const stdout = (globalThis as any).process?.stdout ||
      (globalThis as any).Deno?.stdout;

    if (stdout?.write) {
      // Calculate total lines to clear (title + progress line, accounting for wrapping)
      const totalLinesToClear = this.titleLines + this.lastLineCount;

      // Build complete output string for atomic write
      let output = '\r';
      if (totalLinesToClear > 1) {
        output += `\x1b[${totalLinesToClear - 1}A`;
      }
      output += '\x1b[0J';

      // Single atomic write
      stdout.write(output);

      this.lastLineCount = 0;
      this.titleLines = 0;
    }
  }
}
