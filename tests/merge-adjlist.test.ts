import { TEST } from './mod.ts';
import { AdjacencyList } from '../base/adj-list.ts';
import { assertEquals, assertTrue } from './asserts.ts';

export default function setup() {
  TEST('AdjList', 'add edge and verify in-edges', () => {
    const adj = new AdjacencyList();
    adj.addEdge('child', 'parent', 'parent');
    assertTrue(adj.hasInEdges('parent'), 'parent should have in-edges');
    assertTrue(!adj.hasInEdges('child'), 'child should not have in-edges');
    // Verify the edge data
    const edges = Array.from(adj.inEdges('parent'));
    assertEquals(edges.length, 1);
    assertEquals(edges[0].vertex, 'child');
    assertEquals(edges[0].fieldName, 'parent');
  });

  TEST('AdjList', 'multiple edges to same vertex', () => {
    const adj = new AdjacencyList();
    adj.addEdge('child1', 'parent', 'parent');
    adj.addEdge('child2', 'parent', 'parent');
    assertTrue(adj.hasInEdges('parent'));
    const edges = Array.from(adj.inEdges('parent'));
    assertEquals(edges.length, 2);
    const sources = edges.map((e) => e.vertex).sort();
    assertEquals(sources, ['child1', 'child2']);
  });
}
