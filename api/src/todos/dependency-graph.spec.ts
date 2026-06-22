import { wouldCreateCycle, DepEdge } from './dependency-graph';

describe('wouldCreateCycle', () => {
  it('rejects a self-dependency', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('allows an edge with no existing reverse path', () => {
    expect(wouldCreateCycle([], 'a', 'b')).toBe(false);
  });

  it('detects a direct 2-cycle (a->b then b->a)', () => {
    const edges: DepEdge[] = [{ dependentId: 'a', dependencyId: 'b' }];
    // adding b -> a would close a<->b
    expect(wouldCreateCycle(edges, 'b', 'a')).toBe(true);
  });

  it('detects a transitive cycle (a->b->c then c->a)', () => {
    const edges: DepEdge[] = [
      { dependentId: 'a', dependencyId: 'b' },
      { dependentId: 'b', dependencyId: 'c' },
    ];
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true);
  });

  it('allows a diamond (no cycle): a->b, a->c, then b->d and c->d', () => {
    const edges: DepEdge[] = [
      { dependentId: 'a', dependencyId: 'b' },
      { dependentId: 'a', dependencyId: 'c' },
      { dependentId: 'b', dependencyId: 'd' },
    ];
    expect(wouldCreateCycle(edges, 'c', 'd')).toBe(false);
  });
});
