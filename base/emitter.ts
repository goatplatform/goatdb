import { NextEventLoopCycleTimer, Timer, TimerCallback } from './timer.ts';
import { log } from '../logging/log.ts';

export type EmitterEvent = 'suspended' | 'resumed';

export type EmitterCallback = () => void;

/** @group Events */
export class Emitter<T extends string> {
  readonly alwaysActive: boolean;
  private readonly _callbacks: Map<string, (EmitterCallback | null)[]>;
  private readonly _delayedEmissionTimer?: Timer;
  private _suspendCallbacks: EmitterCallback[];
  private _resumeCallbacks: EmitterCallback[];
  private _pendingEmissions: [event: string, a0: unknown, a1: unknown][];
  private _isMuted = false;
  private _isActive: boolean;
  private _dispatching = 0;
  private _dispatchDirty = false;

  constructor(
    delayedEmissionTimerConstructor?: (callback: TimerCallback) => Timer,
    alwaysActive?: boolean,
  ) {
    this.alwaysActive = Boolean(alwaysActive);
    this._suspendCallbacks = [];
    this._resumeCallbacks = [];
    this._callbacks = new Map();
    if (delayedEmissionTimerConstructor) {
      this._delayedEmissionTimer = delayedEmissionTimerConstructor(() => {
        const emissions = this._pendingEmissions;
        this._pendingEmissions = [];
        for (const [e, a0, a1] of emissions) {
          try {
            this._emitCore(e, a0, a1);
          } catch (err: unknown) {
            log({
              severity: 'ERROR',
              error: 'NotReached',
              message: `Uncaught error in delayed emission: ${err}`,
            });
          }
        }
      });
    }
    this._pendingEmissions = [];
    if (this.alwaysActive) {
      new NextEventLoopCycleTimer(() => this.resume()).schedule();
    }
    this._isActive = this.calcIsActive();
  }

  private calcIsActive(): boolean {
    return this.alwaysActive || this._callbacks.size > 0;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Returns the number of live (non-null) callbacks registered for a given
   * event. Used by lifecycle policies (e.g. auto-close) to derive listener
   * 'pins' from the Emitter's own registrations instead of parallel counters,
   * so detachAll / dedup / missing-detach semantics are always respected.
   * @group Events
   */
  listenerCount(event: T | EmitterEvent): number {
    const arr = this._callbacks.get(event as T);
    if (!arr) return 0;
    let count = 0;
    for (const cb of arr) {
      if (cb !== null) count++;
    }
    return count;
  }

  /**
   * Emits an event to all registered listeners in registration (FIFO) order.
   * This ordering is a stable contract -- chained query listeners depend on it.
   */
  emit<E extends T | EmitterEvent>(
    e: E,
    a0?: unknown,
    a1?: unknown,
  ): void {
    if (this._isMuted) return;
    if (this._delayedEmissionTimer) {
      this._pendingEmissions.push([e, a0, a1]);
      this._delayedEmissionTimer.schedule();
    } else {
      this._emitCore(e, a0, a1);
    }
  }

  // Listeners are dispatched in registration (FIFO) order.
  // This is a stable guarantee — chained query listeners depend on it.
  private _emitCore(e: string, a0: unknown, a1: unknown): void {
    if (this._isMuted) return;
    let callbacks: (EmitterCallback | null)[] | undefined;
    if (e === 'EmitterSuspended') {
      callbacks = this._suspendCallbacks;
    } else if (e === 'EmitterResumed') {
      callbacks = this._resumeCallbacks;
    } else {
      callbacks = this._callbacks.get(e);
    }
    if (!callbacks || callbacks.length === 0) return;
    ++this._dispatching;
    try {
      for (let i = 0; i < callbacks.length; i++) {
        const f = callbacks[i];
        if (f === null) continue;
        try {
          (f as (a0: unknown, a1: unknown) => void)(a0, a1);
        } catch (err: unknown) {
          log({
            severity: 'ERROR',
            error: 'NotReached',
            message: `Uncaught error in event listener: ${err}`,
          });
        }
      }
    } finally {
      if (--this._dispatching === 0 && this._dispatchDirty) {
        this._dispatchDirty = false;
        this._compactCallbacks();
      }
    }
  }

  // deno-lint-ignore ban-types
  attach<C extends Function, E extends T | EmitterEvent>(
    e: E,
    c: C,
  ): () => void {
    const callback = c as unknown as EmitterCallback;
    if (e === 'EmitterSuspended' || e === 'EmitterResumed') {
      const arr = e === 'EmitterSuspended'
        ? this._suspendCallbacks
        : this._resumeCallbacks;
      if (!arr.includes(callback)) {
        arr.push(callback);
      }
      this._isActive = this.calcIsActive();
      return () => this.detach(e, c);
    }
    const wasActive = this.isActive;
    let arr = this._callbacks.get(e as T);
    if (!arr) {
      arr = [];
      this._callbacks.set(e as T, arr);
    }
    if (!arr.includes(callback)) {
      arr.push(callback);
    }
    if (!wasActive) {
      this.resume();
      this.emit('resumed');
    }
    this._isActive = this.calcIsActive();
    return () => this.detach(e, c);
  }

  // deno-lint-ignore ban-types
  detach<C extends Function, E extends T | EmitterEvent>(e: E, c: C): void {
    const callback = c as unknown as EmitterCallback;
    if (e === 'EmitterSuspended' || e === 'EmitterResumed') {
      const arr = e === 'EmitterSuspended'
        ? this._suspendCallbacks
        : this._resumeCallbacks;
      const idx = arr.indexOf(callback);
      if (idx >= 0) {
        arr.splice(idx, 1);
      }
      this._isActive = this.calcIsActive();
      return;
    }
    const arr = this._callbacks.get(e as T);
    if (!arr) {
      return;
    }
    const idx = arr.indexOf(callback);
    if (idx < 0) {
      return;
    }
    if (this._dispatching > 0) {
      (arr as (EmitterCallback | null)[])[idx] = null;
      this._dispatchDirty = true;
      return;
    }
    if (arr.length === 1) {
      this._callbacks.delete(e as T);
      this._isActive = this.calcIsActive();
      if (!this.isActive) {
        this.suspend();
        this.emit('suspended');
      }
    } else {
      arr.splice(idx, 1);
      this._isActive = this.calcIsActive();
    }
  }

  detachAll<E extends T | EmitterEvent>(e?: E): void {
    if (e === undefined) {
      if (this._dispatching > 0) {
        for (const arr of this._callbacks.values()) {
          for (let i = 0; i < arr.length; i++) arr[i] = null;
        }
        for (let i = 0; i < this._suspendCallbacks.length; i++) {
          (this._suspendCallbacks as (EmitterCallback | null)[])[i] = null;
        }
        for (let i = 0; i < this._resumeCallbacks.length; i++) {
          (this._resumeCallbacks as (EmitterCallback | null)[])[i] = null;
        }
        this._dispatchDirty = true;
        return;
      }
      this._suspendCallbacks = [];
      this._resumeCallbacks = [];
      if (this._callbacks.size > 0) {
        this._callbacks.clear();
        this._isActive = this.calcIsActive();
        if (!this.isActive) {
          this.suspend();
          this.emit('suspended');
        }
      }
      return;
    }
    if (e === 'EmitterSuspended' || e === 'EmitterResumed') {
      if (this._dispatching > 0) {
        const arr = this[
          e === 'EmitterSuspended' ? '_suspendCallbacks' : '_resumeCallbacks'
        ];
        for (let i = 0; i < arr.length; i++) {
          (arr as (EmitterCallback | null)[])[i] = null;
        }
        this._dispatchDirty = true;
        return;
      }
      this[
        e === 'EmitterSuspended' ? '_suspendCallbacks' : '_resumeCallbacks'
      ] = [];
      return;
    }
    const callbacks = this._callbacks.get(e);
    if ((callbacks?.length || 0) > 0) {
      if (this._dispatching > 0) {
        for (let i = 0; i < callbacks!.length; i++) callbacks![i] = null;
        this._dispatchDirty = true;
        return;
      }
      this._callbacks.delete(e);
      this._isActive = this.calcIsActive();
      if (!this.isActive) {
        this.suspend();
        this.emit('suspended');
      }
    }
  }

  // deno-lint-ignore ban-types
  once<C extends Function, E extends T | EmitterEvent>(e: E, c: C): () => void {
    const callback = (a0?: unknown, a1?: unknown) => {
      (c as unknown as (a0: unknown, a1: unknown) => void)(a0, a1);
      this.detach(e, callback);
    };
    this.attach(e, callback);
    return () => this.detach(e, callback);
  }

  private _compactCallbacks(): void {
    for (const [event, arr] of this._callbacks) {
      let write = 0;
      for (let read = 0; read < arr.length; read++) {
        if (arr[read] !== null) {
          arr[write++] = arr[read];
        }
      }
      arr.length = write;
      if (write === 0) {
        this._callbacks.delete(event);
      }
    }
    this._suspendCallbacks = this._suspendCallbacks.filter(
      (c) => c !== null,
    );
    this._resumeCallbacks = this._resumeCallbacks.filter((c) => c !== null);
    const wasActive = this._isActive;
    this._isActive = this.calcIsActive();
    if (wasActive && !this._isActive) {
      this.suspend();
      if (!this._isMuted) {
        this._emitCore('suspended', undefined, undefined);
      }
    }
  }

  protected suspend(): void {}

  protected resume(): void {}

  mute(): void {
    this._isMuted = true;
  }

  unmute(): void {
    this._isMuted = false;
  }
}
