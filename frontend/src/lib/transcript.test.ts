import { describe, it, expect } from 'vitest';
import type { TranscriptEvent } from './voiceClient';
import {
  initialTranscriptState,
  transcriptReducer,
  accumulateTranscript,
  transcriptView,
} from './transcript';

const interim = (text: string): TranscriptEvent => ({ text, isFinal: false });
const final = (text: string): TranscriptEvent => ({ text, isFinal: true });

describe('transcriptReducer', () => {
  it('starts from an empty initial state', () => {
    expect(initialTranscriptState).toEqual({ finals: [], interim: '' });
  });

  it('appends a final segment and clears any interim', () => {
    const afterInterim = transcriptReducer(initialTranscriptState, interim('hel'));
    const afterFinal = transcriptReducer(afterInterim, final('hello'));
    expect(afterFinal).toEqual({ finals: ['hello'], interim: '' });
  });

  it('keeps finals in emission order', () => {
    const state = accumulateTranscript([final('one'), final('two'), final('three')]);
    expect(state.finals).toEqual(['one', 'two', 'three']);
  });

  it('keeps only the latest interim (last-write-wins)', () => {
    const state = accumulateTranscript([interim('a'), interim('ab'), interim('abc')]);
    expect(state.interim).toBe('abc');
    expect(state.finals).toEqual([]);
  });

  it('replaces interim after a final arrives', () => {
    const state = accumulateTranscript([
      interim('fi'),
      final('first'),
      interim('se'),
    ]);
    expect(state.finals).toEqual(['first']);
    expect(state.interim).toBe('se');
  });

  it('does not mutate the input state', () => {
    const before: typeof initialTranscriptState = { finals: ['x'], interim: 'y' };
    const after = transcriptReducer(before, final('z'));
    expect(before).toEqual({ finals: ['x'], interim: 'y' });
    expect(after).not.toBe(before);
  });

  it('preserves empty-string segments verbatim', () => {
    const state = accumulateTranscript([final(''), interim('')]);
    expect(state.finals).toEqual(['']);
    expect(state.interim).toBe('');
  });
});

describe('transcriptView', () => {
  it('joins finals followed by the current interim', () => {
    const state = accumulateTranscript([final('hello'), final('world'), interim('fri')]);
    expect(transcriptView(state)).toBe('hello world fri');
  });

  it('omits interim when there is none', () => {
    const state = accumulateTranscript([final('hello'), final('world')]);
    expect(transcriptView(state)).toBe('hello world');
  });
});
