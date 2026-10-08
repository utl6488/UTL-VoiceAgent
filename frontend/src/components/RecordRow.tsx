import { useState } from 'react';
import type { PhoneRecord } from '../types';
import styles from './RecordRow.module.css';

export interface RecordRowProps {
  /** The record to display. All fields are rendered verbatim (Requirement 11.1). */
  record: PhoneRecord;
  /**
   * Number of columns in the parent table. Used so the expanded transcript
   * row can span the full width of the table.
   */
  columnCount?: number;
  /**
   * Requests deletion of this record. The parent (Dashboard) owns the
   * confirmation + mutation flow (Requirement 8.1); this component only
   * reports the intent and never deletes or confirms on its own.
   */
  onDelete: (id: string) => void;
}

/**
 * RecordRow — a single phone record rendered as a table row.
 *
 * Rendering rules:
 * - `parsedNumber`, `language`, and `collectedAt` are rendered byte-for-byte
 *   as received from the Backend. There is NO client-side parsing, formatting,
 *   or coercion of any value (Requirements 6.3, 11.1).
 * - `parsedNumber` uses the shared `.mono` monospace helper from index.css.
 *
 * Interaction:
 * - Clicking the row toggles expansion, revealing a second row that contains
 *   the record's `rawTranscript` (Requirement 6.6). Expansion is tracked as
 *   local component state.
 * - A delete button calls `onDelete(id)` so the parent can run its
 *   confirmation + mutation flow (Requirement 8.1). The click is prevented
 *   from bubbling so it does not also toggle expansion.
 */
export function RecordRow({ record, columnCount = 4, onDelete }: RecordRowProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = () => setExpanded((prev) => !prev);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    // Keep keyboard users at parity with mouse users for the expand toggle.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExpanded();
    }
  };

  const handleDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    // The delete action must NOT also toggle row expansion.
    event.stopPropagation();
    onDelete(record.id);
  };

  return (
    <>
      <tr
        className={styles.row}
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
      >
        <td className={styles.cell}>
          <span className={`${styles.number} mono`}>
            <span className={styles.chevron} aria-hidden="true">
              ▶
            </span>
            {record.parsedNumber}
          </span>
        </td>
        <td className={styles.cell}>
          <span className={`${styles.lang} ${styles[`lang_${record.language}`]}`}>
            {record.language}
          </span>
        </td>
        <td className={`${styles.cell} ${styles.timestamp}`}>{record.collectedAt}</td>
        <td className={`${styles.cell} ${styles.actions}`}>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={handleDelete}
            aria-label="Delete record"
          >
            🗑 Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.transcriptRow}>
          <td className={styles.transcriptCell} colSpan={columnCount}>
            <div className={styles.transcriptLabel}>Raw transcript</div>
            <pre className={styles.transcript}>{record.rawTranscript}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

export default RecordRow;
