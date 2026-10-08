import type { Stats } from '../types';
import styles from './StatsBar.module.css';

/**
 * Pure validation guard for a {@link Stats} payload.
 *
 * Returns `true` only when `x` is shaped such that all four tiles
 * (Total, English, Hindi, Mixed) can be rendered: an object with a numeric
 * `total` and a `byLanguage` object whose `en`, `hi`, and `mixed` are all
 * finite numbers. Non-objects, missing `byLanguage`, and non-numeric/NaN
 * counts fail the guard. Kept pure so the malformed-stats path is testable
 * in isolation (Requirement 9.3).
 */
export function isValidStats(x: unknown): x is Stats {
  if (typeof x !== 'object' || x === null) return false;

  const stats = x as Record<string, unknown>;
  if (!isFiniteNumber(stats.total)) return false;

  const byLanguage = stats.byLanguage;
  if (typeof byLanguage !== 'object' || byLanguage === null) return false;

  const counts = byLanguage as Record<string, unknown>;
  return (
    isFiniteNumber(counts.en) &&
    isFiniteNumber(counts.hi) &&
    isFiniteNumber(counts.mixed)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface StatsBarProps {
  /** Stats payload from the Backend. May be undefined while loading. */
  stats?: Stats;
  /** True while the stats query is in its first-load pending state. */
  isLoading?: boolean;
  /** True when the stats query has errored. */
  isError?: boolean;
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: string;
  variant: string;
}

/**
 * Renders four tiles — Total, English, Hindi, Mixed — from a {@link Stats}
 * payload (Requirement 9.2). Values are rendered exactly as provided. When the
 * payload is missing, loading, errored, or malformed such that the four tiles
 * cannot be rendered, an explicit error/empty state is shown instead of
 * crashing (Requirement 9.3).
 */
export function StatsBar({ stats, isLoading, isError }: StatsBarProps) {
  if (isLoading) {
    return (
      <div className={styles.statsBar} role="status" aria-busy="true">
        <p className={styles.placeholder}>Loading stats…</p>
      </div>
    );
  }

  if (isError || !isValidStats(stats)) {
    return (
      <div className={styles.statsBar} role="status">
        <p className={styles.placeholder}>Stats unavailable</p>
      </div>
    );
  }

  const tiles: Tile[] = [
    { key: 'total', label: 'Total', value: stats.total, icon: '📊', variant: styles.total },
    { key: 'en', label: 'English', value: stats.byLanguage.en, icon: '🇬🇧', variant: styles.en },
    { key: 'hi', label: 'Hindi', value: stats.byLanguage.hi, icon: '🇮🇳', variant: styles.hi },
    { key: 'mixed', label: 'Mixed', value: stats.byLanguage.mixed, icon: '🌐', variant: styles.mixed },
  ];

  return (
    <div className={styles.statsBar}>
      {tiles.map((tile) => (
        <div key={tile.key} className={`${styles.tile} ${tile.variant}`}>
          <span className={styles.iconChip} aria-hidden="true">
            {tile.icon}
          </span>
          <span className={styles.body}>
            <span className={styles.label}>{tile.label}</span>
            <span className={`${styles.value} mono`}>{tile.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default StatsBar;
