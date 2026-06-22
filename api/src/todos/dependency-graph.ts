// An edge {dependentId -> dependencyId} means "dependent depends on dependency"
// (the dependency must be completed first).
export interface DepEdge {
  dependentId: string;
  dependencyId: string;
}

/**
 * Would adding the edge `dependent -> dependency` create a cycle?
 * A cycle forms iff `dependency` can already reach `dependent` by following
 * existing depends-on edges (i.e. dependency transitively depends on dependent).
 */
export function wouldCreateCycle(
  edges: DepEdge[],
  dependentId: string,
  dependencyId: string,
): boolean {
  if (dependentId === dependencyId) return true;

  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.dependentId) ?? [];
    list.push(e.dependencyId);
    adjacency.set(e.dependentId, list);
  }

  // DFS from `dependency` over depends-on edges; reaching `dependent` ⇒ cycle.
  const stack = [dependencyId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === dependentId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) {
      stack.push(next);
    }
  }
  return false;
}
