import { Todo, TodoPriority, TodoStatus } from './todo.entity';
import { SortDir, SortField } from './dto/list-todos-query.dto';

// Semantic ordinal ordering for enum sort keys (definition order, not alphabetical).
const PRIORITY_ORD: Record<TodoPriority, number> = {
  [TodoPriority.LOW]: 0,
  [TodoPriority.MEDIUM]: 1,
  [TodoPriority.HIGH]: 2,
};
const STATUS_ORD: Record<TodoStatus, number> = {
  [TodoStatus.NOT_STARTED]: 0,
  [TodoStatus.IN_PROGRESS]: 1,
  [TodoStatus.COMPLETED]: 2,
  [TodoStatus.ARCHIVED]: 3,
};

const PRIORITY_CASE =
  "(CASE t.priority WHEN 'LOW' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'HIGH' THEN 2 END)";
const STATUS_CASE =
  "(CASE t.status WHEN 'NOT_STARTED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'COMPLETED' THEN 2 WHEN 'ARCHIVED' THEN 3 END)";

export interface SortConfig {
  // SQL expression to ORDER BY / keyset-compare against.
  expr: string;
  // Explicit cast applied to the bound cursor param (param arrives as text).
  cast: string;
  // Whether the key can be NULL (affects NULLS LAST keyset handling).
  nullable: boolean;
  // Extract the cursor value for a row (string | null).
  value: (t: Todo) => string | null;
}

export const SORT_CONFIG: Record<SortField, SortConfig> = {
  dueDate: {
    expr: 't.dueDate',
    cast: '::timestamptz',
    nullable: true,
    value: (t) => (t.dueDate ? new Date(t.dueDate).toISOString() : null),
  },
  name: { expr: 't.name', cast: '::text', nullable: false, value: (t) => t.name },
  createdAt: {
    expr: 't.createdAt',
    cast: '::timestamptz',
    nullable: false,
    value: (t) => new Date(t.createdAt).toISOString(),
  },
  priority: {
    expr: PRIORITY_CASE,
    cast: '::int',
    nullable: false,
    value: (t) => String(PRIORITY_ORD[t.priority]),
  },
  status: {
    expr: STATUS_CASE,
    cast: '::int',
    nullable: false,
    value: (t) => String(STATUS_ORD[t.status]),
  },
};

export interface Cursor {
  v: string | null;
  id: string;
}

export function encodeCursor(v: string | null, id: string): string {
  return Buffer.from(JSON.stringify({ v, id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed?.id !== 'string') return null;
    return { v: parsed.v ?? null, id: parsed.id };
  } catch {
    return null;
  }
}

// Build the keyset WHERE clause + params for "rows strictly after `cursor`"
// given the chosen sort expression, direction, and nullability (NULLS LAST).
export function keysetClause(
  config: SortConfig,
  dir: SortDir,
  cursor: Cursor,
): { sql: string; params: Record<string, unknown> } {
  const { expr, cast, nullable } = config;
  const cmp = dir === 'asc' ? '>' : '<';
  if (cursor.v === null) {
    // We are already in the trailing NULL block (only possible when nullable).
    return { sql: `(${expr} IS NULL AND t.id ${cmp} :cid)`, params: { cid: cursor.id } };
  }
  const p = `:cv${cast}`;
  const tail = nullable ? ` OR ${expr} IS NULL` : '';
  return {
    sql: `(${expr} ${cmp} ${p} OR (${expr} = ${p} AND t.id ${cmp} :cid)${tail})`,
    params: { cv: cursor.v, cid: cursor.id },
  };
}
