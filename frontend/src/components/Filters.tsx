import type { ChangeEvent } from 'react';
import type { LanguageChip, LanguageTag, PhoneFilters } from '../types';
import styles from './Filters.module.css';

interface FiltersProps {
  /** Current filter values owned by the parent (controlled). */
  value: PhoneFilters;
  /** Called with the next filter object whenever any input changes. */
  onChange: (next: PhoneFilters) => void;
}

const LANGUAGE_CHIPS: { chip: LanguageChip; label: string }[] = [
  { chip: 'all', label: 'All' },
  { chip: 'en', label: 'English' },
  { chip: 'hi', label: 'Hindi' },
  { chip: 'mixed', label: 'Mixed' },
];

/**
 * Normalizes a filter object so empty-string fields become `undefined`,
 * letting the API layer treat them as inactive (Requirements 7.1–7.6).
 */
function normalize(filters: PhoneFilters): PhoneFilters {
  const next: PhoneFilters = {};
  if (filters.search && filters.search.length > 0) next.search = filters.search;
  if (filters.language) next.language = filters.language;
  if (filters.from && filters.from.length > 0) next.from = filters.from;
  if (filters.to && filters.to.length > 0) next.to = filters.to;
  return next;
}

/**
 * Controlled filter bar for the Dashboard. The parent owns the
 * `PhoneFilters` state; this component emits a fresh object on every change.
 */
export function Filters({ value, onChange }: FiltersProps) {
  const activeChip: LanguageChip = value.language ?? 'all';

  const emit = (next: PhoneFilters) => onChange(normalize(next));

  const handleSearch = (e: ChangeEvent<HTMLInputElement>) => {
    emit({ ...value, search: e.target.value });
  };

  const handleLanguage = (chip: LanguageChip) => {
    // 'all' clears the language filter (Requirements 7.2, 7.3).
    const language: LanguageTag | undefined = chip === 'all' ? undefined : chip;
    emit({ ...value, language });
  };

  const handleFrom = (e: ChangeEvent<HTMLInputElement>) => {
    emit({ ...value, from: e.target.value });
  };

  const handleTo = (e: ChangeEvent<HTMLInputElement>) => {
    emit({ ...value, to: e.target.value });
  };

  return (
    <div className={styles.filters} role="search">
      <div className={`${styles.field} ${styles.search}`}>
        <label className={styles.label} htmlFor="filters-search">
          Search
        </label>
        <input
          id="filters-search"
          className={styles.input}
          type="search"
          inputMode="tel"
          placeholder="Search by phone number"
          value={value.search ?? ''}
          onChange={handleSearch}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label} id="filters-language-label">
          Language
        </span>
        <div
          className={styles.chips}
          role="group"
          aria-labelledby="filters-language-label"
        >
          {LANGUAGE_CHIPS.map(({ chip, label }) => {
            const pressed = activeChip === chip;
            return (
              <button
                key={chip}
                type="button"
                className={styles.chip}
                aria-pressed={pressed}
                onClick={() => handleLanguage(chip)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="filters-from">
          From
        </label>
        <input
          id="filters-from"
          className={styles.input}
          type="date"
          value={value.from ?? ''}
          onChange={handleFrom}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="filters-to">
          To
        </label>
        <input
          id="filters-to"
          className={styles.input}
          type="date"
          value={value.to ?? ''}
          onChange={handleTo}
        />
      </div>
    </div>
  );
}

export default Filters;
