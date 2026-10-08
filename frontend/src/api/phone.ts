// API_Layer: centralizes HTTP access to the Backend (source of truth).
//
// This module owns query-string construction and error handling so that the
// rest of the Frontend depends on a single, testable seam. It performs no
// phone-number parsing and keeps no client-side persistence (Requirement 11).
//
// Task 3.1 scope: `ApiError`, `buildPhoneQuery`, and the shared `apiFetch`
// helper. The concrete operations (listPhones/deletePhone/getStats/
// createSession) are implemented in Task 3.3.

import type { LanguageTag, PhoneFilters } from '../types';

/**
 * Identifiable error for any failed API_Layer operation.
 *
 * Carries the `operation` name (e.g. 'listPhones') and the HTTP `status` so
 * callers can surface a meaningful toast and tests can assert the tag
 * (Requirement 10.1, Property 8). A `status` of 0 denotes a network/fetch
 * rejection where no HTTP status was received.
 */
export class ApiError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.operation = operation;
    this.status = status;
  }
}

/**
 * Determines whether a `search` filter value is active.
 *
 * A search is active only when it contains at least one non-whitespace
 * character; empty or whitespace-only strings are treated as "no filter".
 */
function isActiveSearch(search: string | undefined): search is string {
  return typeof search === 'string' && search.trim().length > 0;
}

/**
 * Determines whether a `language` filter value is active.
 *
 * `undefined` means "all" and so does any value that is not a concrete tag.
 * Only `en` / `hi` / `mixed` are active (Requirement 7.3).
 */
function isActiveLanguage(
  language: LanguageTag | undefined,
): language is LanguageTag {
  return language === 'en' || language === 'hi' || language === 'mixed';
}

/**
 * Determines whether an optional date bound (`from` / `to`) is active.
 *
 * A bound is active when it is a defined, non-empty string.
 */
function isActiveDate(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Builds a query string from the active filters only.
 *
 * Emits exactly one parameter for each active filter:
 *   - `search` — included when non-empty (trimmed) (Requirement 7.1).
 *   - `language` — included only for a concrete tag; omitted when `all`
 *     (undefined / non-concrete) (Requirements 7.2, 7.3).
 *   - `from` — included when defined (Requirement 7.4).
 *   - `to` — included when defined; omitted for an open-ended upper bound
 *     (Requirements 7.5).
 * All active filters appear together (Requirement 7.6).
 *
 * The output round-trips: parsing the produced query string back yields
 * exactly the active filter set (Property 1). The returned string includes a
 * leading `?` when any parameter is present, and is empty otherwise.
 */
export function buildPhoneQuery(filters: PhoneFilters): string {
  const params = new URLSearchParams();

  if (isActiveSearch(filters.search)) {
    // Backend parameter name is `q` (see backend/app/api/phone.py:83).
    params.set('q', filters.search);
  }
  if (isActiveLanguage(filters.language)) {
    params.set('language', filters.language);
  }
  if (isActiveDate(filters.from)) {
    params.set('from', filters.from);
  }
  if (isActiveDate(filters.to)) {
    params.set('to', filters.to);
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Parses a query string produced by {@link buildPhoneQuery} back into the
 * active filter set.
 *
 * This is the inverse of `buildPhoneQuery` over the active-filter space and
 * exists so the round-trip property (Property 1) can be verified directly.
 * Accepts an input with or without a leading `?`.
 */
export function parsePhoneQuery(query: string): PhoneFilters {
  const normalized = query.startsWith('?') ? query.slice(1) : query;
  const params = new URLSearchParams(normalized);
  const filters: PhoneFilters = {};

  const search = params.get('q');
  if (search !== null && isActiveSearch(search)) {
    filters.search = search;
  }

  const language = params.get('language');
  if (language !== null && isActiveLanguage(language as LanguageTag)) {
    filters.language = language as LanguageTag;
  }

  const from = params.get('from');
  if (from !== null && isActiveDate(from)) {
    filters.from = from;
  }

  const to = params.get('to');
  if (to !== null && isActiveDate(to)) {
    filters.to = to;
  }

  return filters;
}

/**
 * Reads the Backend base URL from `VITE_API_URL`, trimming any trailing
 * slash so paths can be appended uniformly (Requirement 1.4).
 *
 * When `VITE_API_URL` is unset we return an empty string. All API paths are
 * then same-origin ("/api/...") and go through Vite's dev-server proxy (see
 * vite.config.ts) or hit the same host that serves the built app in prod.
 * This makes the frontend work out of the box without a .env file.
 */
export function getBaseUrl(): string {
  const base = import.meta.env.VITE_API_URL ?? '';
  return base.replace(/\/+$/, '');
}

/**
 * Shared fetch wrapper for all API_Layer operations.
 *
 * Composes the request URL from `VITE_API_URL` (Requirement 1.4) and converts
 * any non-2xx response OR network/fetch rejection into an {@link ApiError}
 * tagged with the given `operation` name and the HTTP status (Requirement
 * 10.1, Property 8). On success it returns the raw `Response` so callers can
 * decide how to decode the body (JSON vs. no content).
 *
 * @param operation human-readable operation name used to tag errors.
 * @param path backend path beginning with `/` (e.g. `/api/phone`).
 * @param init optional fetch init (method, headers, body, ...).
 */
export async function apiFetch(
  operation: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${getBaseUrl()}${path}`;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    // Network-level failure: no HTTP status was received.
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ApiError(operation, 0, `${operation} failed: ${message}`);
  }

  if (!response.ok) {
    throw new ApiError(
      operation,
      response.status,
      `${operation} failed with status ${response.status}`,
    );
  }

  return response;
}

// ---------------------------------------------------------------------------
// Task 3.3: Concrete API_Layer operations.
//
// Each operation delegates to `apiFetch`, so any non-2xx response or network
// rejection throws an `ApiError` tagged with the operation name (Requirement
// 10.1, Property 8). Response bodies are decoded as JSON except for
// `deletePhone`, which expects no content.
// ---------------------------------------------------------------------------

import type { PhoneRecord, Stats } from '../types';

/** Flat stats shape the backend returns. Adapted to the nested UI shape below. */
interface BackendStats {
  total: number;
  en: number;
  hi: number;
  mixed: number;
}

/**
 * Fetches the collected phone records from the Backend, applying the active
 * filters as query parameters (Requirements 6.1, 7.6).
 *
 * Issues `GET /api/phone` with the query produced by {@link buildPhoneQuery}
 * and parses the JSON array of {@link PhoneRecord}. Throws an {@link ApiError}
 * tagged `listPhones` on any non-success response (Requirement 10.1).
 */
export async function listPhones(
  filters: PhoneFilters,
): Promise<PhoneRecord[]> {
  const response = await apiFetch(
    'listPhones',
    `/api/phone${buildPhoneQuery(filters)}`,
    { method: 'GET' },
  );
  return (await response.json()) as PhoneRecord[];
}

/**
 * Deletes a single phone record by id (Requirement 8.2).
 *
 * Issues `DELETE /api/phone/:id` with the id encoded into the path. No
 * response body is expected. Throws an {@link ApiError} tagged `deletePhone`
 * on any non-success response (Requirement 10.1).
 */
export async function deletePhone(id: string): Promise<void> {
  await apiFetch(
    'deletePhone',
    `/api/phone/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

/**
 * Fetches aggregate statistics from the Backend (Requirement 9.1).
 *
 * Issues `GET /api/stats`, parses the flat backend payload, and adapts it to
 * the UI's nested {@link Stats} shape. Throws an {@link ApiError} tagged
 * `getStats` on any non-success response (Requirement 10.1).
 */
export async function getStats(): Promise<Stats> {
  const response = await apiFetch('getStats', '/api/stats', { method: 'GET' });
  const flat = (await response.json()) as BackendStats;
  return {
    total: flat.total,
    byLanguage: { en: flat.en, hi: flat.hi, mixed: flat.mixed },
  };
}

/**
 * Builds the signaling endpoint URL for the SmallWebRTC transport.
 *
 * The Voice_Client passes this URL to `@pipecat-ai/small-webrtc-transport`,
 * which owns the SDP offer/answer exchange itself. There is no standalone
 * HTTP call here — the transport does `POST /api/session {sdp, type}` under
 * the hood when `connect()` is invoked.
 */
export function sessionEndpoint(): string {
  return `${getBaseUrl()}/api/session`;
}
