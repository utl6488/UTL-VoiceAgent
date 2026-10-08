// Transcript accumulation reducer.
//
// A pure, side-effect-free reducer that folds a stream of `TranscriptEvent`s
// (emitted by the Voice_Client) into a small, displayable state. This is the
// pure logic seam targeted by design Property 3 ("Transcript accumulation
// preserves order and latest interim text", Requirements 3.1, 3.2) and
// consumed by CallPage (Task 13).
//
// Accumulation rules:
//  - Final segments (`isFinal === true`) are appended to `finals` in the exact
//    order they are emitted. Committing a final also clears the current
//    interim, since the in-progress hypothesis has now been superseded by a
//    committed segment.
//  - Interim segments (`isFinal === false`) replace the current interim text
//    (last-write-wins): only the most recently emitted interim is retained.
//
// Keeping this pure means it is trivially testable across many generated
// input sequences and safe to call from a React reducer / state updater
// without surprising side effects.

import type { TranscriptEvent } from './voiceClient';

/**
 * Accumulated transcript state.
 *
 * `finals` holds every committed segment in emission order; `interim` holds the
 * latest in-progress hypothesis (empty string when there is none).
 */
export interface TranscriptState {
  /** Committed final segments, in the order they were emitted. */
  finals: string[];
  /** The most recently emitted interim text; `''` when there is no interim. */
  interim: string;
}

/**
 * The initial, empty transcript state. Frozen to discourage accidental
 * mutation of the shared default.
 */
export const initialTranscriptState: TranscriptState = Object.freeze({
  finals: [],
  interim: '',
});

/**
 * Pure reducer: folds a single {@link TranscriptEvent} into the state.
 *
 * Returns a new {@link TranscriptState} and never mutates `state` or `event`.
 *
 *  - A final event appends `event.text` to `finals` and clears `interim`.
 *  - An interim event replaces `interim` with `event.text` (last-write-wins)
 *    and leaves `finals` untouched.
 */
/**
 * Action accepted by the reducer. A `TranscriptEvent` folds into the state
 * as before; the sentinel string `'reset'` returns the initial empty state so
 * CallPage can wipe the panel at the start of a new session.
 */
export type TranscriptAction = TranscriptEvent | 'reset';

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState {
  if (action === 'reset') {
    return { finals: [], interim: '' };
  }
  if (action.isFinal) {
    return {
      finals: [...state.finals, action.text],
      interim: '',
    };
  }

  return {
    finals: state.finals,
    interim: action.text,
  };
}

/**
 * Convenience helper: fold a whole sequence of events into a single state.
 * Useful for tests and for rebuilding state from a replayed event log.
 */
export function accumulateTranscript(
  events: readonly TranscriptEvent[],
  state: TranscriptState = initialTranscriptState,
): TranscriptState {
  return events.reduce(transcriptReducer, state);
}

/**
 * Produce the full displayed transcript text from a {@link TranscriptState}:
 * the committed finals joined in order, followed by the current interim text
 * (when present). Intended for CallPage's transcript panel.
 */
export function transcriptView(state: TranscriptState): string {
  const parts = state.interim
    ? [...state.finals, state.interim]
    : state.finals;
  return parts.join(' ');
}
