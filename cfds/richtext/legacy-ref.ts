import {
  type CoreValue,
  isReadonlyCoreObject,
} from '../../base/core-types/index.ts';
import { dfs, type ElementNode, isElementNode, type RichText } from './tree.ts';

/**
 * Reject-never-strip guard for legacy rich-text refs.
 *
 * WHY: pre-`isRef` payloads (`RefMarker` leaves / `RefNode` elements) must fail
 * loudly at every ingress instead of being silently stripped by normalization
 * or serialization, so a legacy document is never silently truncated. This
 * module intentionally avoids `model.ts` (whose ref types are deleted) and
 * recognizes the shapes structurally.
 */
export function assertNoLegacyRefs(value: RichText): void {
  if (value === undefined || value === null) return;
  assertNodeIsNotLegacyRef(value);
  const root = (value as { root?: CoreValue }).root;
  if (!isElementNode(root)) return;
  // WHY: dfs yields only descendants, so root itself needs an explicit check.
  assertNodeIsNotLegacyRef(root);
  for (const [node] of dfs(root as ElementNode)) {
    assertNodeIsNotLegacyRef(node);
  }
  // Pointers hold TextNodes outside the tree; a legacy node smuggled here
  // bypasses dfs. Accept Set (live) and Array (decoded) pointer collections.
  const pointers = (value as { pointers?: unknown }).pointers;
  if (pointers instanceof Set || Array.isArray(pointers)) {
    for (const ptr of pointers as Iterable<unknown>) {
      assertNodeIsNotLegacyRef(ptr);
      const target = (ptr as { node?: unknown }).node;
      if (target !== undefined) assertNodeIsNotLegacyRef(target);
    }
  }
}

function assertNodeIsNotLegacyRef(node: unknown): void {
  if (!isLegacyRefNode(node)) return;
  throw new Error(
    'Legacy rich text ref is not supported (RefMarker/RefNode): ' +
      `${JSON.stringify(node)}. Delete the store and re-sync it.`,
  );
}

/** A legacy ref leaf or element, matched structurally (no model.ts types). */
function isLegacyRefNode(node: unknown): boolean {
  if (!isReadonlyCoreObject(node)) return false;
  const obj = node as { ref?: unknown; type?: unknown; tagName?: unknown };
  if (obj.tagName === 'ref') return true;
  return typeof obj.ref === 'string' && typeof obj.type === 'string';
}
