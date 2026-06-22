import { RecurrenceUnit } from './todo.entity';

/**
 * The due date of the next occurrence: advance from the *current due date*
 * (not completion time) by interval × unit, in UTC to avoid timezone drift.
 * Advancing from the due date keeps a predictable schedule without drift.
 */
export function nextDueDate(due: Date, unit: RecurrenceUnit, interval: number): Date {
  const d = new Date(due);
  switch (unit) {
    case RecurrenceUnit.DAY:
      d.setUTCDate(d.getUTCDate() + interval);
      break;
    case RecurrenceUnit.WEEK:
      d.setUTCDate(d.getUTCDate() + interval * 7);
      break;
    case RecurrenceUnit.MONTH:
      d.setUTCMonth(d.getUTCMonth() + interval);
      break;
  }
  return d;
}
