import { assert } from './error.ts';
import { unionIter } from './set.ts';
import type { Dictionary } from './collections/dict.ts';
import { HashSet } from './collections/hash-map.ts';

export interface Edge {
  vertex: string;
  fieldName: string;
}

// Called during commit persist/load, not the decode hot path.
function hashEdge(edge: Edge): string {
  return `${edge.vertex}/${edge.fieldName}`;
}

function eqEdges(e1: Edge, e2: Edge): boolean {
  return e1.vertex === e2.vertex && e1.fieldName === e2.fieldName;
}

// AdjacencyList memory model:
// - Grows monotonically; edges are never pruned during a Repository lifetime.
// - Memory is proportional to total persisted commits.
// - hasInEdges(id) and hasInEdges(id, field) are both O(1) Map lookups;
//   the field variant uses a secondary index keyed by (fieldName, vertKey).
export class AdjacencyList {
  private _inEdges: Dictionary<string, HashSet<Edge>>;
  private _outEdges: Dictionary<string, HashSet<Edge>>;
  private _inFieldCounts: Map<string, Map<string, number>>;

  constructor() {
    this._inEdges = new Map();
    this._outEdges = new Map();
    this._inFieldCounts = new Map();
  }

  get isEmpty(): boolean {
    return this._inEdges.size === 0 && this._outEdges.size === 0;
  }

  hasInEdges(vertKey: string, fieldName?: string): boolean {
    if (fieldName === undefined) {
      const set = this._inEdges.get(vertKey);
      return set !== undefined && set.size > 0;
    }
    // O(1) secondary-index lookup
    return (this._inFieldCounts.get(fieldName)?.get(vertKey) ?? 0) > 0;
  }

  addEdge(src: string, dst: string, fieldName: string): boolean {
    let outSet = this._outEdges.get(src);
    if (outSet === undefined) {
      outSet = new HashSet(hashEdge, eqEdges);
      this._outEdges.set(src, outSet);
    }
    const success = outSet.add({
      vertex: dst,
      fieldName,
    });
    let inSet = this._inEdges.get(dst);
    if (inSet === undefined) {
      inSet = new HashSet(hashEdge, eqEdges);
      this._inEdges.set(dst, inSet);
    }
    // Sanity check. Both sides must be in sync
    const inSuccess = inSet.add({ vertex: src, fieldName });
    assert(
      success === inSuccess,
      `addEdge failed. src: ${src}, dest: ${dst}, fieldName: ${fieldName}`,
    );
    if (success) {
      let fieldMap = this._inFieldCounts.get(fieldName);
      if (fieldMap === undefined) {
        fieldMap = new Map();
        this._inFieldCounts.set(fieldName, fieldMap);
      }
      fieldMap.set(dst, (fieldMap.get(dst) ?? 0) + 1);
    }
    return success;
  }

  deleteEdge(src: string, dst: string, fieldName: string): boolean {
    const outSet = this._outEdges.get(src);
    const inSet = this._inEdges.get(dst);
    const success = Boolean(outSet?.delete({ vertex: dst, fieldName }));
    // Sanity check. Both sides must be in sync
    const inSuccess = Boolean(inSet?.delete({ vertex: src, fieldName }));
    assert(
      success === inSuccess,
      `deleteEdge failed. src: ${src}, dest: ${dst}, fieldName: ${fieldName}`,
    );
    if (success) {
      if (outSet && outSet.size === 0) this._outEdges.delete(src);
      if (inSet && inSet.size === 0) this._inEdges.delete(dst);
      const fieldMap = this._inFieldCounts.get(fieldName);
      if (fieldMap !== undefined) {
        const count = (fieldMap.get(dst) ?? 0) - 1;
        if (count <= 0) {
          fieldMap.delete(dst);
          if (fieldMap.size === 0) this._inFieldCounts.delete(fieldName);
        } else {
          fieldMap.set(dst, count);
        }
      }
    }
    return success;
  }

  inEdges(vertKey: string, fieldName?: string): Generator<Edge> {
    return filterEdges(vertKey, fieldName, this._inEdges);
  }

  outEdges(vertKey: string, fieldName?: string): Generator<Edge> {
    return filterEdges(vertKey, fieldName, this._outEdges);
  }

  *uniqueEdges(vertKey: string, fieldName?: string): Generator<string> {
    const seenKeys = new Set<string>();
    for (const { vertex: key } of this.outEdges(vertKey, fieldName)) {
      seenKeys.add(key);
      yield key;
    }
    for (const { vertex: key } of this.inEdges(vertKey, fieldName)) {
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      yield key;
    }
  }

  *uniqueVertexKeys(): Generator<string> {
    for (const key of unionIter(this._inEdges.keys(), this._outEdges.keys())) {
      // If this generator is broken to chunks by a background coroutine, we may
      // return old results here
      if (this.hasVertex(key)) {
        yield key;
      }
    }
  }

  hasVertex(key: string): boolean {
    return this._inEdges.has(key) || this._outEdges.has(key);
  }

  hasEdge(src: string, dst: string, fieldName?: string): boolean {
    if (fieldName) {
      return this._outEdges.get(src)?.has({ vertex: dst, fieldName }) === true;
    }
    for (const edge of this.outEdges(src)) {
      if (edge.vertex === dst) {
        return true;
      }
    }
    return false;
  }
}

function* filterEdges(
  vertKey: string,
  fieldName: string | undefined,
  dict: Dictionary<string, HashSet<Edge>>,
): Generator<Edge> {
  const edges = dict.get(vertKey);
  if (edges === undefined) {
    return;
  }
  for (const edge of edges) {
    if (fieldName === undefined || edge.fieldName === fieldName) {
      yield edge;
    }
  }
}
