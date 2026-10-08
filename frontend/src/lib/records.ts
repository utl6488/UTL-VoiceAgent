// Optimistic-delete list helpers.
//
// Pure, side-effect-free helpers used by the Dashboard delete mutation
// (Task 14.2) to perform an optimistic remove and to roll back on failure.
// These are the pure logic seams targeted by design Property 4 ("Optimistic
// delete removes exactly the targeted record", Requirement 8.3) and Property 5
// ("Delete rollback is an identity round-trip", Requirement 8.5).
//
// Design mapping (Optimistic Delete Flow):
//  - `onMutate`  → `snapshotRecords` captures the current list, then
//                  `removeById` produces the optimistically-reduced list.
//  - `onError`   → `restoreRecords` reinstates the snapshot verbatim.
//
// All functions are pure and immutable: inputs are never mutated. `removeById`
// returns a new array; the snapshot/restore pair preserve both contents and
// element order so that `restore(snapshot(xs))` round-trips to the original.

import type { PhoneRecord } from '../types';

/**
 * An immutable snapshot of a record list, captured before an optimistic
 * mutation so it can be restored on failure. Treated as opaque by callers.
 */
export type RecordSnapshot = readonly PhoneRecord[];

/**
 * Remove exactly the record whose `id` equals `id` from `records`, preserving
 * every other record unchanged and in its original relative order.
 *
 * Pure and immutable: `records` is not mutated; a new array is returned. If no
 * record matches `id`, a shallow copy of the original list is returned (the
 * contents and order are unchanged).
 *
 * Validates design Property 4 (Requirement 8.3).
 */
export function removeById(
  records: readonly PhoneRecord[],
  id: string,
): PhoneRecord[] {
  return records.filter((record) => record.id !== id);
}

/**
 * Capture an immutable snapshot of the current record list.
 *
 * The returned snapshot is a frozen shallow copy, so later mutations of the
 * source array (or reassignment of the cache) cannot alter it. Element
 * identities are preserved, so restoring the snapshot yields a list equal to
 * the original in both contents and order.
 */
export function snapshotRecords(
  records: readonly PhoneRecord[],
): RecordSnapshot {
  return Object.freeze([...records]);
}

/**
 * Restore a previously captured snapshot, yielding a fresh mutable array equal
 * to the snapshot in both contents and element order.
 *
 * Pure and immutable: the snapshot itself is not exposed or mutated; a new
 * array is returned so callers can own it freely.
 *
 * Validates design Property 5 (Requirement 8.5): for any list and any id,
 * `restoreRecords(snapshotRecords(xs))` equals `xs` in contents and order,
 * independent of any intervening `removeById` applied to a working copy.
 */
export function restoreRecords(snapshot: RecordSnapshot): PhoneRecord[] {
  return [...snapshot];
}
