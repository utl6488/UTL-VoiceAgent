// Voice_Client: thin wrapper around PipecatClient + SmallWebRTCTransport.
//
// The browser needs to:
//  1. Request mic access and open an RTCPeerConnection.
//  2. Exchange an SDP offer/answer with POST /api/session.
//  3. Receive the agent's TTS audio and play it.
//  4. Receive user transcript segments over the data channel and surface them.
//
// All four are handled by @pipecat-ai/small-webrtc-transport under the hood;
// our job is to construct it, wire its RTVI events to the subscriber-shaped
// surface the pages were written against (onTranscript / onState / onDigits /
// onLevel), and expose start()/stop() with a Promise-rejection on failure so
// CallPage can toast and reset.
//
// Digit progress note: the agent is authoritative. We derive a local digit
// COUNT from the aggregated user transcript (same deterministic rules the
// backend uses, in a trivial reimplementation) so the counter in the UI
// reflects captured digits without waiting on a round-trip. Validation and
// persistence are strictly server-side (Requirement 11).

import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import { sessionEndpoint } from '../api/phone';
import type { SessionState } from '../types';

export type { SessionState } from '../types';

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
}

export type Unsubscribe = () => void;

export interface VoiceClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  onTranscript(cb: (e: TranscriptEvent) => void): Unsubscribe;
  onState(cb: (state: SessionState) => void): Unsubscribe;
  onDigits(cb: (captured: number, expected: number) => void): Unsubscribe;
  onLevel(cb: (level: number) => void): Unsubscribe;
}

export interface VoiceClientConfig {
  /** Override the SmallWebRTC signaling endpoint. Defaults to `/api/session`. */
  endpoint?: string;
  /**
   * Injectable factory so the unit tests can swap in a fake PipecatClient
   * without pulling the real WebRTC stack into jsdom.
   */
  createPipecatClient?: () => PipecatLike;
}

/** The subset of PipecatClient we actually touch. Keeps tests honest. */
export interface PipecatLike {
  connect(params?: unknown): Promise<unknown>;
  disconnect(): Promise<void>;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off?(event: string, cb: (...args: unknown[]) => void): void;
}

const TARGET_DIGITS = 10;

class Listeners<Args extends unknown[]> {
  private readonly callbacks = new Set<(...args: Args) => void>();
  add(cb: (...args: Args) => void): Unsubscribe {
    this.callbacks.add(cb);
    return () => void this.callbacks.delete(cb);
  }
  emit(...args: Args): void {
    for (const cb of [...this.callbacks]) cb(...args);
  }
}

class PipecatVoiceClient implements VoiceClient {
  private readonly makeClient: () => PipecatLike;
  private readonly endpoint: string;

  private client: PipecatLike | null = null;
  private active = false;
  // Hidden <audio> element bound to the bot's remote track. small-webrtc-transport
  // emits `trackStarted` with the MediaStreamTrack but never plays it; without
  // this element the bot's TTS is received and silently dropped.
  private botAudioEl: HTMLAudioElement | null = null;

  // Rolling buffer of finalized transcript text — used to count captured
  // digits for the UI progress indicator. Backend still owns validation.
  private aggregatedText = '';

  private readonly transcriptListeners = new Listeners<[TranscriptEvent]>();
  private readonly stateListeners = new Listeners<[SessionState]>();
  private readonly digitListeners = new Listeners<[number, number]>();
  private readonly levelListeners = new Listeners<[number]>();

  constructor(config: VoiceClientConfig) {
    this.endpoint = config.endpoint ?? sessionEndpoint();
    this.makeClient = config.createPipecatClient ?? (() => {
      const transport = new SmallWebRTCTransport({
        webrtcRequestParams: { endpoint: this.endpoint },
      });
      return new PipecatClient({ transport, enableMic: true, enableCam: false }) as unknown as PipecatLike;
    });
  }

  async start(): Promise<void> {
    if (this.active) return;
    const client = this.makeClient();
    this.client = client;

    // Transport lifecycle -> UI session state. Pipecat's SessionState enum on
    // the backend has 4 phases (GREETING/COLLECTING/CONFIRMING/DONE). The
    // SmallWebRTC transport doesn't surface those directly, so we map:
    //   bot ready -> GREETING, user starts speaking -> COLLECTING,
    //   user finishes speaking after 10 digits captured -> CONFIRMING,
    //   bot says "thank you" (botStoppedSpeaking after CONFIRMING) -> DONE.
    // Not perfect — the backend state machine is the true authority — but it
    // gives the CallPage badge a believable progression without needing a
    // custom RTVI message channel.
    client.on(RTVIEvent.BotReady, () => this.setState('GREETING'));
    client.on(RTVIEvent.UserStartedSpeaking, () => {
      if (this.currentState !== 'CONFIRMING' && this.currentState !== 'DONE') {
        this.setState('COLLECTING');
      }
    });

    client.on(RTVIEvent.UserTranscript, (...args: unknown[]) => {
      const data = args[0] as { text?: string; final?: boolean } | undefined;
      if (!data || typeof data.text !== 'string') return;
      const isFinal = Boolean(data.final);
      this.transcriptListeners.emit({ text: data.text, isFinal });

      if (isFinal) {
        this.aggregatedText = `${this.aggregatedText} ${data.text}`.trim();
        const captured = Math.min(countDigitsFromTranscript(this.aggregatedText), TARGET_DIGITS);
        this.digitListeners.emit(captured, TARGET_DIGITS);
        if (captured >= TARGET_DIGITS) this.setState('CONFIRMING');
      }
    });

    client.on(RTVIEvent.BotStoppedSpeaking, () => {
      // When the bot wraps up after confirmation, that's the "thank you" line.
      if (this.currentState === 'CONFIRMING') this.setState('DONE');
    });

    client.on(RTVIEvent.LocalAudioLevel, (...args: unknown[]) => {
      const level = typeof args[0] === 'number' ? args[0] : 0;
      this.levelListeners.emit(Math.max(0, Math.min(1, level)));
    });

    client.on(RTVIEvent.TrackStarted, (...args: unknown[]) => {
      const track = args[0] as MediaStreamTrack | undefined;
      const participant = args[1] as { local?: boolean } | undefined;
      if (!track || track.kind !== 'audio' || participant?.local) return;
      if (this.botAudioEl === null) {
        this.botAudioEl = new Audio();
        this.botAudioEl.autoplay = true;
      }
      this.botAudioEl.srcObject = new MediaStream([track]);
      // play() may reject if the autoplay policy blocks it; start() is invoked
      // from a click handler, so in practice this resolves. Swallowed to avoid
      // an unhandled rejection.
      void this.botAudioEl.play().catch(() => {});
    });

    // connect() does the SDP exchange; let any failure propagate so CallPage
    // can toast and reset to Idle (Requirement 2.3).
    await client.connect();
    this.active = true;
  }

  async stop(): Promise<void> {
    if (!this.active && !this.client) return;
    this.active = false;
    try {
      await this.client?.disconnect();
    } finally {
      this.client = null;
      this.aggregatedText = '';
      this.currentState = null;
      if (this.botAudioEl) {
        this.botAudioEl.srcObject = null;
        this.botAudioEl = null;
      }
    }
  }

  onTranscript(cb: (e: TranscriptEvent) => void): Unsubscribe {
    return this.transcriptListeners.add(cb);
  }
  onState(cb: (state: SessionState) => void): Unsubscribe {
    return this.stateListeners.add(cb);
  }
  onDigits(cb: (captured: number, expected: number) => void): Unsubscribe {
    return this.digitListeners.add(cb);
  }
  onLevel(cb: (level: number) => void): Unsubscribe {
    return this.levelListeners.add(cb);
  }

  // --- internal ------------------------------------------------------------
  private currentState: SessionState | null = null;
  private setState(next: SessionState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    this.stateListeners.emit(next);
  }
}

export function createVoiceClient(config: VoiceClientConfig = {}): VoiceClient {
  return new PipecatVoiceClient(config);
}

// ---------------------------------------------------------------------------
// Lightweight digit counter — mirrors the backend parser's intent just enough
// to drive the UI progress ring. NOT a substitute for backend validation.
// ---------------------------------------------------------------------------

const EN_WORD_TO_DIGIT: Record<string, string> = {
  zero: '0', oh: '0', o: '0',
  one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
// Teens: "ten" -> 10, etc. Nova-3 collapses adjacent digit words into these.
const TEEN_WORD_TO_DIGITS: Record<string, string> = {
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
  fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
};
// Tens standalone -> N0; followed by a unit word -> Nunit.
const TENS_WORD_TO_DIGIT: Record<string, string> = {
  twenty: '2', thirty: '3', forty: '4', fourty: '4', fifty: '5',
  sixty: '6', seventy: '7', eighty: '8', ninety: '9', ninty: '9',
};
const HI_WORD_TO_DIGIT: Record<string, string> = {
  shunya: '0', sunya: '0', sifar: '0', sifr: '0',
  ek: '1', do: '2', doh: '2', dos: '2',
  teen: '3', tin: '3',
  char: '4', chaar: '4',
  panch: '5', paanch: '5', paach: '5',
  chhe: '6', che: '6', cheh: '6', chhey: '6',
  saat: '7', sat: '7',
  aath: '8', ath: '8',
  nau: '9', nav: '9',
};
// Deepgram's multi model returns native-script Hindi words. Keep the keys
// in Devanagari so the regex match surfaces them unchanged.
const HI_DEVANAGARI_TO_DIGIT: Record<string, string> = {
  'शून्य': '0', 'सिफर': '0', 'सिफ़र': '0',
  'एक': '1',
  'दो': '2', 'दौ': '2',
  'तीन': '3', 'तिन': '3',
  'चार': '4',
  'पांच': '5', 'पाँच': '5', 'पाच': '5',
  'छह': '6', 'छे': '6', 'छ': '6', 'छै': '6',
  'सात': '7',
  'आठ': '8',
  'नौ': '9', 'नो': '9',
};
const DEVANAGARI_NUMERAL_TO_ASCII: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};
const MULTIPLIERS: Record<string, number> = {
  double: 2, dubble: 2, doubble: 2,
  triple: 3, tripple: 3,
};
const CORRECTION_CUES = new Set([
  'wait', 'sorry', 'scratch', 'actually', 'nevermind',
  'ruko', 'ruk', 'rukiye', 'galat', 'nahi', 'nahin',
]);

export function countDigitsFromTranscript(text: string): number {
  if (!text) return 0;
  // Translate Devanagari numerals to ASCII so the digit-run branch catches
  // them, then tokenize over ASCII letters, digit runs, OR a Devanagari word.
  const normalized = text.toLowerCase().replace(/[०-९]/g, (c) => DEVANAGARI_NUMERAL_TO_ASCII[c] ?? c);
  const tokens = normalized.match(/[a-z]+|\d+|[ऀ-ॿ]+/g) ?? [];
  const digits: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (CORRECTION_CUES.has(tok)) {
      digits.length = 0;
      continue;
    }
    if (MULTIPLIERS[tok] !== undefined) {
      const next = tokens[i + 1];
      if (next === undefined) continue;
      const d = resolveSingleDigit(next);
      if (d !== null) {
        for (let k = 0; k < MULTIPLIERS[tok]!; k++) digits.push(d);
        i++;
      }
      continue;
    }
    if (/^\d+$/.test(tok)) {
      for (const ch of tok) digits.push(ch);
      continue;
    }
    const teen = TEEN_WORD_TO_DIGITS[tok];
    if (teen !== undefined) {
      for (const ch of teen) digits.push(ch);
      continue;
    }
    const tens = TENS_WORD_TO_DIGIT[tok];
    if (tens !== undefined) {
      const next = tokens[i + 1];
      const unit = next !== undefined ? resolveSingleDigit(next) : null;
      digits.push(tens);
      if (unit !== null) {
        digits.push(unit);
        i++;
      } else {
        digits.push('0');
      }
      continue;
    }
    const en = EN_WORD_TO_DIGIT[tok];
    if (en !== undefined) { digits.push(en); continue; }
    const hi = HI_WORD_TO_DIGIT[tok];
    if (hi !== undefined) { digits.push(hi); continue; }
    const hiDev = HI_DEVANAGARI_TO_DIGIT[tok];
    if (hiDev !== undefined) { digits.push(hiDev); continue; }
  }
  return digits.length;
}

function resolveSingleDigit(tok: string): string | null {
  if (EN_WORD_TO_DIGIT[tok] !== undefined) return EN_WORD_TO_DIGIT[tok]!;
  if (HI_WORD_TO_DIGIT[tok] !== undefined) return HI_WORD_TO_DIGIT[tok]!;
  if (HI_DEVANAGARI_TO_DIGIT[tok] !== undefined) return HI_DEVANAGARI_TO_DIGIT[tok]!;
  if (/^\d$/.test(tok)) return tok;
  return null;
}
