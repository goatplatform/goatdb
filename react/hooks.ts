/**
 * This module exposes high level React hooks that act as a full state
 * management package on top of GoatDB.
 *
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB/React
 */
import React, {
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { type DBState, GoatDB } from '../db/db.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { ManagedItem } from '../db/managed-item.ts';
import { type MutationPack, mutationPackHasField } from '../db/mutations.ts';
import type { ReadonlyJSONValue } from '../base/interfaces.ts';
import type { Query, QueryConfig } from '../repo/query.ts';
import { getBaseURL } from '../net/rest-api.ts';

export type GoatDBCtxProps = {
  db?: GoatDB;
};

/** Exported so tests and hosts can inject a specific DB instance. */
export const GoatDBContext: React.Context<GoatDBCtxProps> = React.createContext<
  GoatDBCtxProps
>({});

/**
 * Opens a local DB, creating it if necessary. Once opened, the DB is available
 * as a react context. All future calls return the already opened DB rather than
 * opening it again.
 *
 * This hook will trigger a re-render whenever the current user changes.
 *
 * @returns A DB instance.
 */
export function useDB<US extends Schema>(): GoatDB<
  US
> {
  const ctx = useContext(GoatDBContext);
  if (!ctx.db) {
    ctx.db = new GoatDB({ path: '/data/db', peers: getBaseURL() });
  }
  let changeCount = 0;
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      ctx.db?.attach('UserChanged', () => {
        ++changeCount;
        onStoreChange();
      }) || (() => {}),
    [ctx.db],
  );
  const getSnapshot = useCallback(() => changeCount, [ctx.db]);
  useSyncExternalStore(subscribe, getSnapshot);
  return ctx.db as unknown as GoatDB<US>;
}

/**
 * Materializes a referentially stable snapshot for useSyncExternalStore. The
 * returned value keeps the same identity while both `a` and `b` are unchanged,
 * and switches to a fresh object the moment either differs — so DB lifecycle
 * transitions (e.g. close) force a re-render even when the underlying value is
 * otherwise identical.
 */
function cachedSnapshot<T>(
  cacheRef: { current: { a: unknown; b: unknown; value: T } | null },
  a: unknown,
  b: unknown,
  value: T,
): T {
  const cached = cacheRef.current;
  if (!cached || cached.a !== a || cached.b !== b) {
    cacheRef.current = { a, b, value };
    return value;
  }
  return cached.value;
}

/**
 * Options for the {@link useItem} hook.
 */
export type UseItemOpts = {
  /**
   * An optional array of field names to monitor, or single field name.
   * If provided, the {@link useItem} hook will monitor only changes to these
   * fields and ignore other changes.
   *
   * Use this to reduce unneeded re-rendering events.
   */
  keys?: string | string[];
};

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param pathComps A full item path or separate path components.
 *
 * @returns A {@link ManagedItem} instance or undefined if the item doesn't
 *          exist or it's repository hadn't finished loading yet. In the latter
 *          case, the hook will automatically trigger a re-render when the
 *          repository finished loading and the item becomes available.
 */
export function useItem<S extends Schema>(
  ...pathComps: string[]
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param opts      Options object for configuring this hook.
 * @param pathCompsOrOpts A full item path or separate path components.
 *
 * @returns A {@link ManagedItem} instance or undefined if the item doesn't
 *          exist or it's repository hadn't finished loading yet. In the latter
 *          case, the hook will automatically trigger a re-render when the
 *          repository finished loading and the item becomes available.
 */
export function useItem<S extends Schema>(
  opts: UseItemOpts,
  ...pathCompsOrOpts: string[]
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param path A full item path. If the path is undefined, the returned item
 *             will also be undefined.
 * @param opts Options object for configuring this hook.
 *
 * @returns A {@link ManagedItem} instance or undefined if the item doesn't
 *          exist or it's repository hadn't finished loading yet. In the latter
 *          case, the hook will automatically trigger a re-render when the
 *          repository finished loading and the item becomes available.
 */
export function useItem<S extends Schema>(
  path: string | undefined,
  opts: UseItemOpts,
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param path A full item path. If the path is undefined, the returned item
 *             will also be undefined.
 * @param opts Options object for configuring this hook.
 *
 * @returns A {@link ManagedItem} instance or undefined if the item doesn't
 *          exist or it's repository hadn't finished loading yet. In the latter
 *          case, the hook will automatically trigger a re-render when the
 *          repository finished loading and the item becomes available.
 */
export function useItem<S extends Schema>(
  path: undefined,
  opts: UseItemOpts,
): undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param path A full item path. If the path is undefined, the returned item
 *             will also be undefined.
 *
 * @returns A {@link ManagedItem} instance or undefined if the item doesn't
 *          exist or it's repository hadn't finished loading yet. In the latter
 *          case, the hook will automatically trigger a re-render when the
 *          repository finished loading and the item becomes available.
 */
export function useItem<S extends Schema>(
  path: string | undefined,
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param path A full item path. If the path is undefined, the returned item
 *             will also be undefined.
 *
 * @returns A {@link ManagedItem} instance or undefined if the item doesn't
 *          exist or it's repository hadn't finished loading yet. In the latter
 *          case, the hook will automatically trigger a re-render when the
 *          repository finished loading and the item becomes available.
 */
export function useItem<S extends Schema>(
  path: undefined,
): undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param item The item to monitor. If undefined, the returned item will also
 *             be undefined.
 * @param opts Options object for configuring this hook.
 *
 * @returns The given {@link ManagedItem} instance.
 */
export function useItem<S extends Schema>(
  item: ManagedItem<S> | undefined,
  opts: UseItemOpts,
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param item The item to monitor. If undefined, the returned item will also
 *             be undefined.
 *
 * @returns The given {@link ManagedItem} instance.
 */
export function useItem<S extends Schema>(
  item: ManagedItem<S> | undefined,
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param item The item to monitor.
 * @param opts Options object for configuring this hook.
 *
 * @returns The given {@link ManagedItem} instance, or `undefined` once the DB
 *          is closing, closed, or failed (it stays live while booting).
 */
export function useItem<S extends Schema>(
  item: ManagedItem<S>,
  opts: UseItemOpts,
): ManagedItem<S> | undefined;

/**
 * This hook monitors changes to a specific item, triggering a re-render
 * whenever the item's state changes. It returns a mutable {@link ManagedItem}
 * instance that allows direct editing. Any changes to the item are
 * automatically queued for background commit and synchronization with the
 * server. Similar to the {@link useQuery} hook, {@link useItem} reacts to both
 * local and remote updates.
 *
 * @param item The item to monitor.
 *
 * @returns The given {@link ManagedItem} instance, or `undefined` once the DB
 *          is closing, closed, or failed (it stays live while booting).
 */
export function useItem<S extends Schema>(
  item: ManagedItem<S>,
): ManagedItem<S> | undefined;

export function useItem<S extends Schema>(
  ...pathCompsOrOpts: (ManagedItem | string | UseItemOpts | undefined)[]
): ManagedItem<S> | undefined {
  const db = useDB();
  // Handle ManagedItem as first argument
  if (pathCompsOrOpts[0] instanceof ManagedItem) {
    pathCompsOrOpts[0] = pathCompsOrOpts[0].path;
  }
  // Options object may appear either at the beginning or at the end
  const lastArg = pathCompsOrOpts[pathCompsOrOpts.length - 1];
  let opts: UseItemOpts | undefined;
  if (typeof pathCompsOrOpts[0] !== 'string') {
    opts = pathCompsOrOpts.shift() as UseItemOpts;
  } else if (lastArg !== undefined && typeof lastArg !== 'string') {
    opts = pathCompsOrOpts.pop() as UseItemOpts;
  }
  // Resolve the item only while the DB is open; after close the hook
  // returns undefined instead of throwing inside a render. No useMemo: the
  // rest-parameter array has a fresh identity per render, and the
  // ManagedItem branch above already normalized the first argument.
  const item = !db.isOpen || typeof pathCompsOrOpts[0] !== 'string'
    ? undefined
    : db.item<S>(...(pathCompsOrOpts as string[]));
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const detachItem = item?.attach('change', (mutations: MutationPack) => {
        // Skip unneeded updates if a specific set of keys was provided
        if (
          opts?.keys !== undefined &&
          // Always notify on schema change
          !mutationPackHasField(mutations, '__schema')
        ) {
          if (typeof opts.keys === 'string') {
            if (!mutationPackHasField(mutations, opts.keys)) {
              return;
            }
          } else if (!mutationPackHasField(mutations, ...opts.keys)) {
            return;
          }
        }
        onStoreChange();
      }) || (() => {});
      // Lifecycle events must also re-render so close resolves item to undefined.
      const detachDb = db.attach('LifecycleChanged', onStoreChange);
      return () => {
        detachItem();
        detachDb();
      };
    },
    [item, db],
  );
  const snapshotRef = useRef<
    { a: unknown; b: unknown; value: { state: DBState; age?: number } } | null
  >(null);
  const getSnapshot = useCallback(
    () =>
      cachedSnapshot(
        snapshotRef,
        db.state,
        item?.age,
        { state: db.state, age: item?.age },
      ),
    [item, db],
  );
  useSyncExternalStore(subscribe, getSnapshot);
  return typeof item?.schema.ns !== 'string' ? undefined : item;
}

/**
 * Represents the state of the loading process.
 */
export type DBReadyState =
  | 'loading'
  | 'ready'
  | 'error'
  | 'closing'
  | 'closed';

/**
 * A hook for monitoring the DB's loading process. The hook triggers whenever
 * the loading process changes its state.
 *
 * @returns The state of the loading process.
 */
export function useDBReady(): DBReadyState {
  const db = useDB();
  // GoatDB logs bootstrap failures; do not add a second readyPromise() consumer.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // Return detach so useSyncExternalStore unsubscribes.
      return db.attach('LifecycleChanged', onStoreChange);
    },
    [db],
  );
  const getSnapshot = useCallback(() => {
    switch (db.state) {
      case 'closed':
        return 'closed';
      case 'failed':
        return 'error';
      case 'closing':
        return 'closing';
      case 'ready':
        return 'ready';
      default:
        return 'loading';
    }
  }, [db]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Options for the {@link useQuery} hook.
 */
export interface UseQueryOpts<
  IS extends Schema,
  CTX extends ReadonlyJSONValue,
  OS extends IS = IS,
> extends Omit<QueryConfig<IS, OS, CTX>, 'db'> {
  /**
   * If `true`, updates UI during the initial scan. If `false`, waits until
   * scanning is complete.
   */
  showIntermittentResults?: boolean;
}

/**
 * Creates a new query or retrieves an existing one. On first access, GoatDB
 * automatically loads the source repository either from the local disk or by
 * fetching it from the server. The hook triggers UI re-rendering whenever the
 * query results are updated, regardless of whether the changes originate from
 * local or remote edits.
 *
 * When a query is first opened, it performs a linear scan of its source using a
 * {@link Coroutine} without blocking the main thread. During and after this
 * initial scan, the query caches its results to disk, allowing subsequent runs
 * to resume execution from the cached state.
 * For additional details, refer to the [query mechanism documentation](https://goatdb.dev/docs/query).
 *
 * Once the DB is closed/failed/closing the hook returns `undefined` instead of
 * throwing, so mounted consumers keep rendering; combine with
 * {@link useDBReady} to unmount when the DB closes.
 *
 * @param config Configuration of the desired query.
 * @returns A live {@link Query} instance, or `undefined` once the DB is
 *          closing, closed, or failed (it stays live while booting).
 */
export function useQuery<
  IS extends Schema,
  CTX extends ReadonlyJSONValue,
  OS extends IS = IS,
>(config: UseQueryOpts<IS, CTX, OS>): Query<IS, OS, CTX> | undefined {
  const db = useDB();
  const query = useMemo<Query<IS, OS, CTX> | undefined>(
    () => (db.isOpen ? db.query(config) : undefined),
    [db, db.isOpen, config],
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const detachQuery = query?.onResultsChanged(onStoreChange) ?? (() => {});
      // Lifecycle events must also re-render so close resolves query to undefined.
      const detachDb = db.attach('LifecycleChanged', onStoreChange);
      return () => {
        detachQuery();
        detachDb();
      };
    },
    [query, db],
  );
  const snapshotRef = useRef<
    | { a: unknown; b: unknown; value: { state: DBState; results: unknown } }
    | null
  >(null);
  const getSnapshot = useCallback(
    () => {
      const results: unknown = db.isOpen ? query?.results() : undefined;
      return cachedSnapshot(snapshotRef, db.state, results, {
        state: db.state,
        results,
      });
    },
    [query, db],
  );
  useSyncExternalStore(subscribe, getSnapshot);
  return query;
}

/**
 * Convenience props type for components that accept a DB path as input.
 */
export type PropsWithPath = {
  path: string;
};
