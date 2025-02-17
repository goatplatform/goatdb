import { assert } from './error.ts';
import { easeInExpo, easeInOutSine } from './time.ts';
import { SortedQueue } from './collections/queue.ts';

const MAX_TIMER_PROCESSING_MS = 30;

const gScheduledTimers = new SortedQueue<BaseTimer>(
  (t1: BaseTimer, t2: BaseTimer) => t1.compare(t2),
);
let gTimerTicker: number | undefined;
let gTimerId = 0;

function startTimerTickerIfNeeded(): void {
  if (!gTimerTicker && gScheduledTimers.size > 0) {
    gTimerTicker = setInterval(() => {
      const startTime = performance.now();

      for (
        let now = performance.now();
        now - startTime <= MAX_TIMER_PROCESSING_MS;
        now = performance.now()
      ) {
        if (
          gScheduledTimers.size > 0 &&
          gScheduledTimers.peek!.nextFireTimestamp <= now
        ) {
          const timer = gScheduledTimers.pop();
          assert(timer !== undefined);
          assert(!gScheduledTimers.has(timer!));
          timer!.fire();
        } else {
          break;
        }
      }
    }, 20);
  }
}

function stopTimerTickerIfNeeded() {
  if (gTimerTicker && gScheduledTimers.size <= 0) {
    clearInterval(gTimerTicker);
    gTimerTicker = undefined;
  }
}

/**
 * A callback function that is executed when a timer fires.
 *
 * @param timer The timer that fired and triggered this callback
 * @returns
 * - `true` to reschedule the timer immediately
 * - `undefined` or `void` to let the timer handle rescheduling based on its
 *   configuration
 * - `Promise<void|undefined>` for async callbacks, same semantics as sync
 *   returns
 */
export interface TimerCallback {
  (timer: Timer): boolean | undefined | void | Promise<void | undefined>;
}

/**
 * Interface for a timer that can be scheduled and unscheduled.
 */
export interface Timer {
  /**
   * Schedules this timer to fire based on its configuration.
   * If the timer is already scheduled, this is a no-op.
   * @returns This timer instance for chaining
   */
  schedule(): Timer;

  /**
   * Unschedules this timer if it is currently scheduled.
   * If the timer is not scheduled, this is a no-op.
   * @returns This timer instance for chaining
   */
  unschedule(): Timer;
}

/**
 * An application level timer that internally uses a single setTimeout.
 * This enables holding thousands of active timers without overloading the
 * JS event loop.
 */
export abstract class BaseTimer implements Timer {
  readonly label: string | undefined;
  private readonly _callback: TimerCallback;
  private readonly _id: number;
  private _nextFireTimestamp: number;
  private _isScheduled: boolean;

  /**
   * Creates a new timer instance.
   * @param callback The function to call when the timer fires
   * @param label Optional label for debugging/logging purposes
   */
  constructor(callback: TimerCallback, label?: string | undefined) {
    this.label = label;
    this._callback = callback;
    this._nextFireTimestamp = 0;
    this._id = gTimerId++;
    this._isScheduled = false;
  }

  /**
   * Returns the timestamp in milliseconds when this timer will next fire.
   * If the timer is not scheduled, returns the last fire timestamp.
   */
  get nextFireTimestamp(): number {
    return this._nextFireTimestamp;
  }

  /**
   * Returns whether this timer is currently scheduled to fire.
   * A timer becomes scheduled when schedule() is called and unscheduled
   * when either unschedule() is called or it fires and doesn't reschedule.
   */
  get isScheduled(): boolean {
    return this._isScheduled;
  }

  /**
   * Calculates the next timestamp in milliseconds when this timer should fire.
   * This is called internally by schedule() to determine when to fire the
   * timer.
   *
   * @returns The next fire timestamp in milliseconds since epoch
   * @override Subclasses must implement this method to define their timing
   *           behavior
   */
  protected abstract calcNextFireDate(): number;

  /**
   * Compares this timer with another timer to determine their relative order.
   * Used for sorting timers in the scheduler queue.
   *
   * @param other The timer to compare against
   * @returns A negative number if this timer should fire before the other
   *          timer, zero if they are the same timer, or a positive number if
   *          this timer should fire after the other timer
   */
  compare(other: BaseTimer): number {
    if (other === this) {
      return 0;
    }
    const dt = other._nextFireTimestamp - this._nextFireTimestamp;
    return dt === 0 ? this._id - other._id : dt;
  }

  /**
   * Schedules this timer to fire at the next appropriate time.
   * If the timer is already scheduled, this is a no-op.
   * @returns This timer instance for chaining
   */
  schedule(): Timer {
    if (gScheduledTimers.has(this)) {
      assert(this._isScheduled);
      return this;
    }
    this._nextFireTimestamp = this.calcNextFireDate();
    gScheduledTimers.push(this);
    assert(!this._isScheduled);
    this._isScheduled = true;
    startTimerTickerIfNeeded();
    return this;
  }

  /**
   * Unschedules this timer if it is currently scheduled.
   * If the timer is not scheduled, this is a no-op.
   * @returns This timer instance for chaining
   */
  unschedule(): Timer {
    if (gScheduledTimers.delete(this)) {
      this._isScheduled = false;
    }
    stopTimerTickerIfNeeded();
    return this;
  }

  /**
   * Resets the timer to fire at the next appropriate time.
   * If the timer is not currently scheduled, this is a no-op.
   * @returns This timer instance for chaining
   */
  reset(): Timer {
    if (this._isScheduled) {
      this.unschedule();
      this.schedule();
    }
    return this;
  }

  /**
   * Fires the timer and handles rescheduling if necessary.
   * This method is called internally by the timer system when the timer's
   * scheduled time has elapsed.
   *
   * @warning This is an internal method and should not be called directly.
   * Use schedule() and unschedule() to control timer execution.
   */
  fire(): void {
    assert(this._isScheduled);
    this._isScheduled = false;
    if (this.run()) {
      this.schedule();
    } else {
      stopTimerTickerIfNeeded();
    }
  }

  /**
   * Executes the timer's callback and handles rescheduling if necessary.
   * @returns `true` if the timer should be rescheduled, `false` otherwise
   */
  protected run(): boolean {
    return this._callback(this) === true;
  }
}

/**
 * A simple fixed timer. It'll fire either once or repeatedly until explicitly
 * unscheduled.
 */
export class SimpleTimer extends BaseTimer {
  private readonly _intervalMs: number;
  private readonly _repeat: boolean;

  static once(
    delayMs: number,
    callback: TimerCallback,
    name?: string,
  ): SimpleTimer {
    return new SimpleTimer(
      delayMs,
      false,
      callback,
      name,
    ).schedule() as SimpleTimer;
  }

  constructor(
    intervalMs: number,
    repeat: boolean,
    callback: TimerCallback,
    name?: string,
  ) {
    super(callback, name);
    this._intervalMs = intervalMs;
    this._repeat = repeat;
  }

  get intervalMs(): number {
    return this._intervalMs;
  }

  protected calcNextFireDate(): number {
    return performance.now() + this._intervalMs;
  }

  protected override run(): boolean {
    const result = super.run();
    return this._repeat || result;
  }
}

/**
 * Base timer for timers that dynamically change their fire interval between
 * a specified range.
 */
export abstract class BaseDynamicTimer extends BaseTimer {
  private readonly _durationMs: number;
  private readonly _minFreqMs: number;
  private readonly _maxFreqMs: number;
  private _repeat: boolean;
  private _lastResetTime: number;
  private _lastFireTime: number;

  constructor(
    minFreqMs: number,
    maxFreqMs: number,
    durationMs: number,
    callback: TimerCallback,
    repeat = false,
    name?: string,
    startAtMax?: boolean,
  ) {
    super(callback, name);
    this._lastResetTime = startAtMax === true ? 0 : performance.now();
    this._durationMs = durationMs;
    this._lastFireTime = 0;
    this._minFreqMs = minFreqMs;
    this._maxFreqMs = maxFreqMs;
    this._repeat = repeat;
  }

  abstract timingFunc(f: number): number;

  get minFreqMs(): number {
    return this._minFreqMs;
  }

  get maxFreqMs(): number {
    return this._maxFreqMs;
  }

  get lastTriggerTime(): number {
    return this._lastFireTime;
  }

  get durationMs(): number {
    return this._durationMs;
  }

  get lastResetTime(): number {
    return this._lastResetTime;
  }

  get repeat(): boolean {
    return this._repeat;
  }

  set repeat(flag: boolean) {
    this._repeat = flag;
  }

  override reset(): Timer {
    const scheduled = this.isScheduled;
    if (scheduled) {
      this.unschedule();
    }
    this._lastResetTime = performance.now();
    if (scheduled) {
      this.schedule();
    }
    return this;
  }

  override schedule(): BaseDynamicTimer {
    return super.schedule() as BaseDynamicTimer;
  }

  override unschedule(): BaseDynamicTimer {
    return super.unschedule() as BaseDynamicTimer;
  }

  protected override run(): boolean {
    const { durationMs, lastResetTime } = this;
    const now = performance.now();
    if (!this.repeat && now - lastResetTime > durationMs) {
      return false;
    }
    this._lastFireTime = now;
    return super.run() || this.repeat;
  }

  protected calcNextFireDate(): number {
    const now = performance.now();
    const { minFreqMs, maxFreqMs, durationMs } = this;
    const f = Math.min(1, (now - this.lastResetTime) / durationMs);
    // Sleep duration between syncs moves gradually from MIN to MAX
    const freqDiff = maxFreqMs - minFreqMs;
    const sleepDur = minFreqMs + this.timingFunc(f) * freqDiff;
    return now + sleepDur;
  }
}

/**
 * A dynamic timer that uses a sine function to adjust its fire interval.
 */
export class EaseInOutSineTimer extends BaseDynamicTimer {
  timingFunc(f: number): number {
    return easeInOutSine(f);
  }
}

export class EaseInExpoTimer extends BaseDynamicTimer {
  timingFunc(f: number): number {
    return easeInExpo(f);
  }
}

/**
 * A timer like implementation of a micro task. This timer fires at the end of
 * the current event loop. The exact fire timing between two micro task timers
 * is undefined.
 */
export class MicroTaskTimer implements Timer {
  private readonly _callback: TimerCallback;
  private _hasScheduledMicrotask: boolean;
  private _scheduled: boolean;

  constructor(callback: TimerCallback) {
    this._callback = callback;
    this._hasScheduledMicrotask = false;
    this._scheduled = false;
  }

  schedule(): Timer {
    if (this._scheduled) {
      return this;
    }
    this._scheduled = true;
    // The caller is allowed to do crazy calls like
    //     schedule();
    //     unschedule();
    //     schedule();
    // Instead of blindly queueing a microtask, we keep track of whether we
    // have a queued task or not and enqueue it only when needed.
    if (!this._hasScheduledMicrotask) {
      queueMicrotask(() => {
        this._hasScheduledMicrotask = false;
        // Trigger our callback only if we're still scheduled by the time this
        // microtask executes.
        if (this._scheduled) {
          this._scheduled = false;
          if (this._callback(this) === true) {
            this.schedule();
          }
        }
      });
      this._hasScheduledMicrotask = true;
    }
    return this;
  }

  unschedule(): Timer {
    // At the time of this writing there's no API for cancelling a queued
    // microtask. To simulate it, we simply flip off our scheduled flag. When
    // the microtask it'll simply be a NOP.
    this._scheduled = false;
    return this;
  }
}

let gScheduledNextEventLoopCycleTimers: NextEventLoopCycleTimer[] = [];
let gScheduledTimeoutHandler: number | undefined;

function processPendingNextEventLoopTimers(): void {
  const scheduledTimers = gScheduledNextEventLoopCycleTimers;
  gScheduledNextEventLoopCycleTimers = [];
  gScheduledTimeoutHandler = undefined;
  for (const timer of scheduledTimers) {
    timer._fire();
  }
}

/**
 * A timer like implementation of a micro task. This timer fires at the end of
 * the current event loop. The exact fire timing between two micro task timers
 * is fuzzy.
 *
 * Prefer to use a CoroutineTimer timer instead of this class as it allows the
 * scheduler to better balance the app's work.
 */
export class NextEventLoopCycleTimer implements Timer {
  private readonly _callback: TimerCallback;
  private _running = false;
  private _scheduleAfterRun = false;

  static run(callback: TimerCallback): () => void {
    const timer = new this(callback);
    timer.schedule();
    return () => timer.unschedule();
  }

  constructor(callback: TimerCallback) {
    this._callback = callback;
  }

  schedule(): Timer {
    if (this._running) {
      this._scheduleAfterRun = true;
      return this;
    }
    this._scheduleAfterRun = false;
    if (gScheduledNextEventLoopCycleTimers.indexOf(this) < 0) {
      gScheduledNextEventLoopCycleTimers.push(this);
      if (gScheduledTimeoutHandler === undefined) {
        gScheduledTimeoutHandler = setTimeout(
          processPendingNextEventLoopTimers,
        );
      }
    }
    return this;
  }

  unschedule(): Timer {
    this._scheduleAfterRun = false;
    const idx = gScheduledNextEventLoopCycleTimers.indexOf(this);
    if (idx >= 0) {
      gScheduledNextEventLoopCycleTimers.splice(idx, 1);
      if (
        gScheduledNextEventLoopCycleTimers.length === 0 &&
        gScheduledTimeoutHandler !== undefined
      ) {
        clearTimeout(gScheduledTimeoutHandler);
        gScheduledTimeoutHandler = undefined;
      }
    }
    return this;
  }

  _fire(): void {
    this._running = true;
    try {
      const res = this._callback(this);
      this._running = false;
      if (res === true || this._scheduleAfterRun) {
        this.schedule();
      }
    } finally {
      this._running = false;
      this._scheduleAfterRun = false;
    }
  }
}
