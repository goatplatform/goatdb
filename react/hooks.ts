/**
 * This module exposes high level React hooks that act as a full state
 * management package on top of GoatDB.
 *
 * Check out https://goatdb.dev for additional docs.
 *
 * @module GoatDB/React
 */
// @deno-types="@types/react"
import React, { useCallback, useContext, useSyncExternalStore } from 'react';
import { GoatDB } from '../db/db.ts';
import type { Schema } from '../cfds/base/schema.ts';
import { ManagedItem } from '../db/managed-item.ts';
import { type MutationPack, mutationPackHasField } from '../db/mutations.ts';
import type { ReadonlyJSONValue } from '../base/interfaces.ts';
import type { Query, QueryConfig } from '../repo/query.ts';
import { getBaseURL } from '../net/rest-api.ts';

type GoatDBCtxProps = {
  db?: GoatDB;
};

const GoatDBContext = React.createContext<GoatDBCtxProps>({});

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
 * @param pathComps A full item path or separate path components.
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
 * @returns The given {@link ManagedItem} instance.
 */
export function useItem<S extends Schema>(
  item: ManagedItem<S>,
  opts: UseItemOpts,
): ManagedItem<S>;

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
 * @returns The given {@link ManagedItem} instance.
 */
export function useItem<S extends Schema>(
  item: ManagedItem<S>,
): ManagedItem<S>;

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
  let item: ManagedItem<S> | undefined = undefined;
  if (pathCompsOrOpts[0] instanceof ManagedItem) {
    item = pathCompsOrOpts[0];
  } else if (typeof pathCompsOrOpts[0] === 'string') {
    item = db.item<S>(...(pathCompsOrOpts as string[]));
  }
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      item?.attach('change', (mutations: MutationPack) => {
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
      }) || (() => {}),
    [item],
  );
  const getSnapshot = useCallback(() => item?.age, [item]);
  useSyncExternalStore(subscribe, getSnapshot);
  return typeof item?.schema.ns !== 'string' ? undefined : item;
}

/**
 * Represents the state of the loading process.
 */
export type DBReadyState = 'loading' | 'ready' | 'error';

/**
 * A hook for monitoring the DB's loading process. The hook triggers whenever
 * the loading process changes its state.
 *
 * @returns The state of the loading process.
 */
export function useDBReady(): DBReadyState {
  const db = useDB();
  let error = false;
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!db.ready) {
        let cancelled = false;
        db.readyPromise()
          .then(() => {
            if (!cancelled) {
              onStoreChange();
            }
          })
          .catch((err) => {
            console.error(err);
            error = true;
            if (!cancelled) {
              onStoreChange();
            }
          });
        return () => {
          cancelled = true;
        };
      }
      return () => {};
    },
    [db],
  );
  const getSnapshot = useCallback(() => {
    if (error) {
      return 'error';
    }
    return db.ready ? 'ready' : 'loading';
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
 * For additional details, refer to the {@link https://goatdb.dev/query|query mechanism documentation}.
 *
 * @param config Configuration of the desired query.
 * @returns A live {@link Query} instance.
 */
export function useQuery<
  IS extends Schema,
  CTX extends ReadonlyJSONValue,
  OS extends IS = IS,
>(config: UseQueryOpts<IS, CTX, OS>): Query<IS, OS, CTX> {
  const db = useDB();
  const query = db.query(config);
  const subscribe = useCallback(
    (onStoreChange: () => void) => query.onResultsChanged(onStoreChange),
    [query],
  );
  const getSnapshot = useCallback(() => query.results(), [query]);
  useSyncExternalStore(subscribe, getSnapshot);
  return query;
}

/**
 * Convenience props type for components that accept a DB path as input.
 */
export type PropsWithPath = {
  path: string;
};
