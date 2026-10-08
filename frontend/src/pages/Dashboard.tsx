// Dashboard page: lists collected phone records with live refetch, filters,
// a stats bar, and optimistic delete behind a confirmation modal.
//
// Design mapping (Dashboard section, "Request/Response Flow — Dashboard load",
// and "Optimistic Delete Flow"):
//  - React Query owns cache, 10s polling, and the delete mutation; there is no
//    bespoke client store for records (Requirements 6.1, 6.2).
//  - Filter state is held here and threaded into the ['phones', filters] query
//    key so changing a filter re-queries (Requirement 7.6).
//  - First-load pending → skeleton (6.4); empty array → empty state (6.5).
//  - A separate ['stats'] query feeds the StatsBar (9.1).
//  - Delete uses a confirmation modal (8.1); confirming runs an optimistic
//    mutation (8.2, 8.3) that restores + toasts on failure (8.5, 10.2); cancel
//    retains the record and issues no DELETE (8.4).
//  - A query-error effect surfaces a generic error toast (10.2).

import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { PhoneFilters, PhoneRecord } from '../types';
import { deletePhone, getStats, listPhones } from '../api/phone';
import { Filters } from '../components/Filters';
import { StatsBar } from '../components/StatsBar';
import { RecordRow } from '../components/RecordRow';
import {
  removeById,
  restoreRecords,
  snapshotRecords,
  type RecordSnapshot,
} from '../lib/records';
import { useToast } from '../lib/toast';
import styles from './Dashboard.module.css';

/** Columns rendered by the record table (used for colSpan in expanded rows). */
const COLUMN_COUNT = 4;

/** Context passed from `onMutate` to `onError` so a failed delete can roll back. */
interface DeleteContext {
  previous: RecordSnapshot;
}

/**
 * Dashboard — composes {@link Filters}, {@link StatsBar}, and a table of
 * {@link RecordRow}s over the live `['phones', filters]` and `['stats']`
 * queries.
 */
export function Dashboard() {
  const queryClient = useQueryClient();
  const toast = useToast();

  // Filter state owned here; threaded into the phones query key (Req 7.6).
  const [filters, setFilters] = useState<PhoneFilters>({});

  // The record pending deletion confirmation (null == modal closed) (Req 8.1).
  const [pendingDelete, setPendingDelete] = useState<PhoneRecord | null>(null);

  // Live phone records with 10s background refetch (Requirements 6.1, 6.2).
  const phonesQuery = useQuery({
    queryKey: ['phones', filters],
    queryFn: () => listPhones(filters),
    refetchInterval: 10_000,
  });

  // Aggregate statistics feeding the StatsBar (Requirement 9.1).
  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
  });

  // Surface a generic error toast whenever the phones query errors (Req 10.2).
  useEffect(() => {
    if (phonesQuery.isError) {
      const error = phonesQuery.error;
      const message =
        error instanceof Error ? error.message : 'Failed to load records';
      toast.error(message);
    }
  }, [phonesQuery.isError, phonesQuery.error, toast]);

  // Optimistic delete mutation (Optimistic Delete Flow in design).
  const deleteMutation = useMutation<void, unknown, string, DeleteContext>({
    mutationFn: (id: string) => deletePhone(id),
    onMutate: async (id: string) => {
      // Cancel in-flight phones queries so they cannot clobber our optimistic
      // update, then snapshot and optimistically remove the targeted record
      // (Requirements 8.3). The snapshot is the rollback source (Req 8.5).
      await queryClient.cancelQueries({ queryKey: ['phones'] });

      const previous = snapshotRecords(
        queryClient.getQueryData<PhoneRecord[]>(['phones', filters]) ?? [],
      );

      queryClient.setQueryData<PhoneRecord[]>(['phones', filters], (current) =>
        removeById(current ?? [], id),
      );

      return { previous };
    },
    onError: (error, _id, context) => {
      // Restore the pre-mutation snapshot and surface an error toast
      // (Requirements 8.5, 10.2).
      if (context) {
        queryClient.setQueryData<PhoneRecord[]>(
          ['phones', filters],
          restoreRecords(context.previous),
        );
      }
      const message =
        error instanceof Error ? error.message : 'Failed to delete record';
      toast.error(message);
    },
    onSettled: () => {
      // Reconcile with the Backend regardless of outcome. Refresh both the
      // record list and the stats tiles so the Total/per-language counts
      // update immediately after a delete rather than on the next poll.
      queryClient.invalidateQueries({ queryKey: ['phones'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const records = phonesQuery.data ?? [];
  // First-load pending state: no data has arrived yet (Requirement 6.4).
  const isFirstLoad = phonesQuery.isPending && phonesQuery.data === undefined;
  const isEmpty = !isFirstLoad && records.length === 0;

  // RecordRow delete action → open the confirmation modal (Requirement 8.1).
  const requestDelete = (id: string) => {
    const record = records.find((r) => r.id === id) ?? null;
    setPendingDelete(record);
  };

  // Cancel retains the record and closes the modal; no DELETE issued (Req 8.4).
  const cancelDelete = () => setPendingDelete(null);

  // Confirm issues the optimistic delete (Requirements 8.2, 8.3).
  const confirmDelete = () => {
    if (pendingDelete) {
      deleteMutation.mutate(pendingDelete.id);
    }
    setPendingDelete(null);
  };

  return (
    <main className={styles.dashboard}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Collected Phone Records</h1>
        <p className={styles.subtitle}>
          Numbers captured by the voice agent, refreshed automatically.
        </p>
      </div>

      <StatsBar
        stats={statsQuery.data}
        isLoading={statsQuery.isPending}
        isError={statsQuery.isError}
      />

      <Filters value={filters} onChange={setFilters} />

      <section
        className={`${styles.card} ${styles.tableSection}`}
        aria-label="Phone records"
      >
        {isFirstLoad ? (
          <Skeleton />
        ) : isEmpty ? (
          <p className={styles.emptyState} role="status">
            <span className={styles.emptyIcon} aria-hidden="true">
              📭
            </span>
            No phone records found yet.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th} scope="col">
                  Number
                </th>
                <th className={styles.th} scope="col">
                  Language
                </th>
                <th className={styles.th} scope="col">
                  Collected at
                </th>
                <th className={styles.th} scope="col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <RecordRow
                  key={record.id}
                  record={record}
                  columnCount={COLUMN_COUNT}
                  onDelete={requestDelete}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pendingDelete && (
        <ConfirmModal
          record={pendingDelete}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      )}
    </main>
  );
}

/** First-load loading skeleton for the record table (Requirement 6.4). */
function Skeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading records">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={styles.skeletonRow} />
      ))}
    </div>
  );
}

interface ConfirmModalProps {
  record: PhoneRecord;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation modal shown before a destructive delete (Requirement 8.1).
 * Cancel retains the record and closes without issuing a DELETE (Req 8.4);
 * Confirm triggers the optimistic mutation (Requirements 8.2, 8.3).
 */
function ConfirmModal({ record, onCancel, onConfirm }: ConfirmModalProps) {
  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onClick={onCancel}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalIconWrap} aria-hidden="true">
          🗑
        </div>
        <h2 id="confirm-delete-title" className={styles.modalTitle}>
          Delete record?
        </h2>
        <p className={styles.modalBody}>
          This will permanently delete the record for{' '}
          <span className="mono">{record.parsedNumber}</span>. This action
          cannot be undone.
        </p>
        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
