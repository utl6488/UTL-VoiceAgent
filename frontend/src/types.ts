// Shared types for the Voice Agent Dashboard.
//
// The Backend is the authoritative source of truth. These types model data
// provided by the Backend; the Frontend performs no phone-number parsing
// (Requirement 11.1) and keeps no client-side persistence of records
// (Requirement 11.2). All record data is retrieved from the Backend.

export type LanguageTag = 'en' | 'hi' | 'mixed';

export interface PhoneRecord {
  id: string;
  parsedNumber: string; // rendered verbatim; never parsed on the client
  language: LanguageTag;
  collectedAt: string; // ISO 8601 timestamp from Backend
  rawTranscript: string; // shown on row expand
}

export interface Stats {
  total: number;
  byLanguage: {
    en: number;
    hi: number;
    mixed: number;
  };
}

export type LanguageChip = 'all' | LanguageTag;

export interface PhoneFilters {
  search?: string;
  language?: LanguageTag; // undefined == 'all'
  from?: string; // ISO date, inclusive lower bound
  to?: string; // ISO date, inclusive upper bound; undefined == open-ended
}

export type SessionState = 'GREETING' | 'COLLECTING' | 'CONFIRMING' | 'DONE';
