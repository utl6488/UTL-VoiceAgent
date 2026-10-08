import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { buildPhoneQuery, parsePhoneQuery } from './phone';
import type { LanguageTag, PhoneFilters } from '../types';

// Feature: voice-agent-dashboard, Property 1: Query construction reflects exactly the active filters

// --- Active-filter semantics (mirrors the predicates in phone.ts) --------------
//
// A filter is "active" exactly when buildPhoneQuery would emit a parameter for
// it. The test derives the expected active subset directly from the generated
// input using these same rules so the assertions are independent of the
// implementation's internal ordering.

function searchIsActive(search: string | undefined): search is string {
  return typeof search === 'string' && search.trim().length > 0;
}

function languageIsActive(
  language: LanguageTag | undefined,
): language is LanguageTag {
  return language === 'en' || language === 'hi' || language === 'mixed';
}

function dateIsActive(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The subset of `filters` that should survive construction. */
function activeSubset(filters: PhoneFilters): PhoneFilters {
  const subset: PhoneFilters = {};
  if (searchIsActive(filters.search)) subset.search = filters.search;
  if (languageIsActive(filters.language)) subset.language = filters.language;
  if (dateIsActive(filters.from)) subset.from = filters.from;
  if (dateIsActive(filters.to)) subset.to = filters.to;
  return subset;
}

// --- Generators ----------------------------------------------------------------

// Search values that exercise active (concrete), inactive (empty/whitespace),
// and absent cases, including non-ASCII / Hindi text.
const searchArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t\n '),
  fc.string(),
  fc.constant('९८७६'), // Devanagari digits
  fc.constant('राम'),
  fc.constant('+1 (555) 010'),
);

// Language values: PhoneFilters.language is `LanguageTag | undefined`.
// `undefined` models "all" (inactive). Concrete tags are active.
const languageArb: fc.Arbitrary<LanguageTag | undefined> = fc.constantFrom(
  undefined,
  'en',
  'hi',
  'mixed',
);

// Optional ISO-ish date bounds, including empty (inactive) and absent.
const dateArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc
    .date({
      min: new Date('2000-01-01'),
      max: new Date('2035-12-31'),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10)),
);

const filtersArb: fc.Arbitrary<PhoneFilters> = fc.record({
  search: searchArb,
  language: languageArb,
  from: dateArb,
  to: dateArb,
});

// --- Property ------------------------------------------------------------------

// The on-wire parameter name for each TS filter field. The TS field name
// `search` maps to the wire name `q` because that's what the backend reads
// (see backend/app/api/phone.py:83). Keep the rest 1:1.
const WIRE_NAME: Record<keyof PhoneFilters, string> = {
  search: 'q',
  language: 'language',
  from: 'from',
  to: 'to',
};

describe('Property 1: buildPhoneQuery reflects exactly the active filters', () => {
  it('emits each active filter once, omits inactive filters, and round-trips', () => {
    fc.assert(
      fc.property(filtersArb, (filters) => {
        const expected = activeSubset(filters);
        const query = buildPhoneQuery(filters);

        const normalized = query.startsWith('?') ? query.slice(1) : query;
        const params = new URLSearchParams(normalized);

        // The emitted parameter names are exactly the wire names for the
        // active filter keys.
        const emittedKeys = [...params.keys()].sort();
        const expectedKeys = (Object.keys(expected) as (keyof PhoneFilters)[])
          .map((k) => WIRE_NAME[k])
          .sort();
        expect(emittedKeys).toEqual(expectedKeys);

        // Each active filter appears exactly once with its value, under its
        // wire name.
        for (const tsKey of Object.keys(expected) as (keyof PhoneFilters)[]) {
          expect(params.getAll(WIRE_NAME[tsKey])).toEqual([expected[tsKey]]);
        }

        // Each inactive filter is omitted entirely.
        for (const tsKey of ['search', 'language', 'from', 'to'] as const) {
          if (!(tsKey in expected)) {
            expect(params.has(WIRE_NAME[tsKey])).toBe(false);
          }
        }

        // Round-trip: parsing the produced query yields exactly the active set.
        expect(parsePhoneQuery(query)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });
});
