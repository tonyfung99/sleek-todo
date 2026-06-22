import { nextDueDate } from './recurrence';
import { RecurrenceUnit } from './todo.entity';

describe('nextDueDate', () => {
  const base = new Date('2026-01-15T09:00:00.000Z');

  it('advances by days', () => {
    expect(nextDueDate(base, RecurrenceUnit.DAY, 1).toISOString()).toBe(
      '2026-01-16T09:00:00.000Z',
    );
    expect(nextDueDate(base, RecurrenceUnit.DAY, 10).toISOString()).toBe(
      '2026-01-25T09:00:00.000Z',
    );
  });

  it('advances by weeks', () => {
    expect(nextDueDate(base, RecurrenceUnit.WEEK, 1).toISOString()).toBe(
      '2026-01-22T09:00:00.000Z',
    );
    expect(nextDueDate(base, RecurrenceUnit.WEEK, 2).toISOString()).toBe(
      '2026-01-29T09:00:00.000Z',
    );
  });

  it('advances by months', () => {
    expect(nextDueDate(base, RecurrenceUnit.MONTH, 1).toISOString()).toBe(
      '2026-02-15T09:00:00.000Z',
    );
    expect(nextDueDate(base, RecurrenceUnit.MONTH, 3).toISOString()).toBe(
      '2026-04-15T09:00:00.000Z',
    );
  });

  it('does not mutate the input date', () => {
    const before = base.toISOString();
    nextDueDate(base, RecurrenceUnit.MONTH, 1);
    expect(base.toISOString()).toBe(before);
  });
});
