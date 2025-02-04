import React, { useCallback, useContext, useSyncExternalStore } from 'react';
import { GoatDB } from '../db/db.ts';
import type { Schema } from '../cfds/base/schema.ts';
import type { ManagedItem } from '../db/managed-item.ts';
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
 * @returns A DB instance.
 */
export function useDB(): GoatDB {
  const ctx = useContext(GoatDBContext);
  if (!ctx.db) {
    ctx.db = new GoatDB({ path: '/data/db', peers: getBaseURL() });
  }
  return ctx.db;
}

export type UseItemOpts = {
  keys?: string | string[];
};

export function useItem<S extends Schema>(
  ...pathCompsOrOpts: string[]
): ManagedItem<S> | undefined;

export function useItem<S extends Schema>(
  opts: UseItemOpts,
  ...pathCompsOrOpts: string[]
): ManagedItem<S> | undefined;

export function useItem<S extends Schema>(
  path: string,
  opts: UseItemOpts,
): ManagedItem<S> | undefined;

export function useItem<S extends Schema>(
  ...pathCompsOrOpts: (string | UseItemOpts)[]
): ManagedItem<S> | undefined {
  const db = useDB();
  // Options object may appear either at the beginning or at the end
  let opts: UseItemOpts | undefined;
  if (typeof pathCompsOrOpts[0] !== 'string') {
    opts = pathCompsOrOpts.shift() as UseItemOpts;
  } else if (typeof pathCompsOrOpts[pathCompsOrOpts.length - 1] !== 'string') {
    opts = pathCompsOrOpts.pop() as UseItemOpts;
  }
  const item = db.item<S>(...(pathCompsOrOpts as string[]));
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      item.attach('change', (mutations: MutationPack) => {
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
      }),
    [item],
  );
  const getSnapshot = useCallback(() => item.age, [item]);
  useSyncExternalStore(subscribe, getSnapshot);
  return item.schema.ns === null ? undefined : item;
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

export interface UseQueryOpts<
  IS extends Schema,
  CTX extends ReadonlyJSONValue,
  OS extends IS = IS,
> extends Omit<QueryConfig<IS, OS, CTX>, 'db'> {
  // If set to true, the hook will trigger with intermittent results while the
  // initial scan executes. This results in more frequent UI updates which can
  // lead to more responsive UI.
  showIntermittentResults?: boolean;
}

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

export type PropsWithPath = {
  path: string;
};
