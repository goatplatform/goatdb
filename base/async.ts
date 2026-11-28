/**
 * Runs `fn` when `p` settles, on both fulfill and reject, without creating an
 * unobserved rejected promise. Unlike a discarded `p.finally(fn)` child,
 * which mirrors `p`'s rejection as an unhandled rejection (the json-log
 * tracked-operation crash, debt/94), `p.then(cleanup, cleanup)` never mirrors
 * `p`'s rejection: the reject handler returns normally, so the derived child
 * resolves. The child settles with void unless `fn` throws; keep `fn`
 * non-throwing or observe the returned promise. The original `p` still
 * delivers its value or rejection to its real observers.
 */
export function onSettled<T>(p: Promise<T>, fn: () => void): Promise<void> {
  return p.then(
    () => {
      fn();
    },
    () => {
      fn();
    },
  );
}
