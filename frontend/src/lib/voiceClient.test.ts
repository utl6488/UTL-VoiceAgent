import { describe, it, expect, vi } from 'vitest';
import {
  countDigitsFromTranscript,
  createVoiceClient,
  type PipecatLike,
} from './voiceClient';

/** A tiny stand-in for PipecatClient so tests don't need jsdom's WebRTC. */
function fakeClient() {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const client: PipecatLike & { emit: (ev: string, ...a: unknown[]) => void } = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    on: (ev, cb) => {
      const list = handlers.get(ev) ?? [];
      list.push(cb as (...a: unknown[]) => void);
      handlers.set(ev, list);
    },
    emit: (ev, ...args) => {
      for (const cb of handlers.get(ev) ?? []) cb(...args);
    },
  };
  return client;
}

describe('createVoiceClient', () => {
  it('calls connect() on start and disconnect() on stop', async () => {
    const fake = fakeClient();
    const vc = createVoiceClient({ createPipecatClient: () => fake });

    await vc.start();
    expect(fake.connect).toHaveBeenCalledTimes(1);

    await vc.stop();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it('propagates a connect() rejection so CallPage can toast', async () => {
    const fake = fakeClient();
    (fake.connect as unknown as { mockRejectedValueOnce(e: unknown): void })
      .mockRejectedValueOnce(new Error('nope'));

    const vc = createVoiceClient({ createPipecatClient: () => fake });
    await expect(vc.start()).rejects.toThrow('nope');
  });

  it('forwards transcript events and updates digit progress', async () => {
    const fake = fakeClient();
    const vc = createVoiceClient({ createPipecatClient: () => fake });

    const transcripts: { text: string; isFinal: boolean }[] = [];
    const digitUpdates: [number, number][] = [];
    vc.onTranscript((e) => transcripts.push(e));
    vc.onDigits((captured, expected) => digitUpdates.push([captured, expected]));

    await vc.start();

    fake.emit('userTranscript', { text: 'nine eight seven', final: true });
    fake.emit('userTranscript', { text: 'six five four three two one zero', final: true });

    expect(transcripts).toEqual([
      { text: 'nine eight seven', isFinal: true },
      { text: 'six five four three two one zero', isFinal: true },
    ]);
    // Progress reaches 10/10 after both finals are aggregated.
    expect(digitUpdates.at(-1)).toEqual([10, 10]);
  });

  it('maps bot/user events to session-state transitions', async () => {
    const fake = fakeClient();
    const vc = createVoiceClient({ createPipecatClient: () => fake });

    const states: string[] = [];
    vc.onState((s) => states.push(s));

    await vc.start();
    fake.emit('botReady');
    fake.emit('userStartedSpeaking');
    fake.emit('userTranscript', { text: '9 8 7 6 5 4 3 2 1 0', final: true });
    fake.emit('botStoppedSpeaking');

    expect(states).toEqual(['GREETING', 'COLLECTING', 'CONFIRMING', 'DONE']);
  });

  it('clamps local audio level to [0, 1]', async () => {
    const fake = fakeClient();
    const vc = createVoiceClient({ createPipecatClient: () => fake });
    const levels: number[] = [];
    vc.onLevel((l) => levels.push(l));

    await vc.start();
    fake.emit('localAudioLevel', 0.3);
    fake.emit('localAudioLevel', 2.5); // out of range -> clamped
    fake.emit('localAudioLevel', -0.1);

    expect(levels).toEqual([0.3, 1, 0]);
  });
});

describe('countDigitsFromTranscript', () => {
  it('counts raw digit runs', () => {
    expect(countDigitsFromTranscript('9876543210')).toBe(10);
    expect(countDigitsFromTranscript('98 76 54')).toBe(6);
  });

  it('counts English words plus multipliers', () => {
    expect(countDigitsFromTranscript('nine double seven six')).toBe(4);
    expect(countDigitsFromTranscript('triple nine six five four three two one')).toBe(9);
  });

  it('counts Hindi words with sifar/shunya', () => {
    expect(
      countDigitsFromTranscript('nau aath saat chhe paanch chaar teen do ek shunya'),
    ).toBe(10);
  });

  it('resets on correction cues', () => {
    expect(countDigitsFromTranscript('nine eight seven wait sorry nine eight six seven')).toBe(4);
  });

  it('ignores filler words', () => {
    expect(countDigitsFromTranscript('my number is 9876543210 please')).toBe(10);
  });
});
