// CallPage (`/call`).
//
// Owns the CLIENT session lifecycle (Idle → Connecting → Active → Done) and
// reflects the conversation state emitted by the Voice_Client. The Frontend
// does not drive the conversation; it starts/stops the transport and renders
// the events the client emits (design: "Call Session State Machine").
//
// Responsibilities / requirement mapping:
//  - Mic toggle (MicButton) → client.start()/client.stop() (Req 2.1, 2.2);
//    a start() rejection surfaces an error toast and resets to inactive (2.3).
//  - Transcript panel folds transcript events through the pure transcript
//    reducer and shows the latest interim text (Req 3.1, 3.2).
//  - State badge reflects the latest SessionState (Req 4.1).
//  - Digit progress shows captured / expected from onDigits (Req 4.2).
//  - A completion toast fires when SessionState becomes DONE (Req 4.3).
//  - A visible mic level meter is driven by onLevel while active (Req 5.1).
//
// NOTE: this component depends on the useToast hook, which requires a
// ToastProvider mounted at the app root. That wiring happens in Task 15; this
// file intentionally does not mount any providers.

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import MicButton from '../components/MicButton';
import { useToast } from '../lib/toast';
import {
  createVoiceClient,
  type SessionState,
  type VoiceClient,
} from '../lib/voiceClient';
import {
  initialTranscriptState,
  transcriptReducer,
  transcriptView,
} from '../lib/transcript';
import styles from './CallPage.module.css';

/**
 * Client-side connection lifecycle, distinct from the conversation
 * Session_State. See the design's "Call Session State Machine":
 *  - Idle:       no session; mic inactive.
 *  - Connecting: start() in flight (negotiating the session).
 *  - Active:     session established; events flowing.
 *  - Done:       conversation reached DONE; mic still shows active until the
 *                user stops.
 */
type Lifecycle = 'Idle' | 'Connecting' | 'Active' | 'Done';

/** Captured/expected digit progress emitted by the Voice_Client. */
interface DigitProgress {
  captured: number;
  expected: number;
}

/**
 * Human-readable copy for each conversation Session_State, shown in the badge.
 */
const STATE_LABELS: Record<SessionState, string> = {
  GREETING: 'Greeting',
  COLLECTING: 'Collecting',
  CONFIRMING: 'Confirming',
  DONE: 'Done',
};

export default function CallPage() {
  const toast = useToast();

  // A single, stable Voice_Client instance for the component's lifetime. A ref
  // (seeded once) guarantees the same instance across re-renders so the
  // subscriptions established on mount stay valid.
  const clientRef = useRef<VoiceClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = createVoiceClient();
  }
  const client = clientRef.current;

  // Client connection lifecycle (local state).
  const [lifecycle, setLifecycle] = useState<Lifecycle>('Idle');
  // Latest conversation Session_State emitted via onState (Req 4.1).
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  // Captured/expected digit progress via onDigits (Req 4.2).
  const [digits, setDigits] = useState<DigitProgress>({ captured: 0, expected: 0 });
  // Mic input level 0..1 via onLevel (Req 5.1).
  const [level, setLevel] = useState(0);
  // Folded transcript state via the pure reducer (Req 3.1, 3.2).
  const [transcript, dispatchTranscript] = useReducer(
    transcriptReducer,
    initialTranscriptState,
  );

  // The mic control is "active" for every phase except Idle, so the user can
  // always toggle a running (or completed) session off.
  const micActive = lifecycle !== 'Idle';
  // Disable the control while connecting to avoid double start()s.
  const micDisabled = lifecycle === 'Connecting';

  // Subscribe to every Voice_Client event on mount; unsubscribe on unmount.
  // The toast is read through a ref so the DONE handler always calls the
  // latest toast API without forcing this effect to re-run (which would tear
  // down and recreate the subscriptions).
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    const unsubscribers = [
      client.onTranscript((event) => dispatchTranscript(event)),
      client.onState((state) => {
        setSessionState(state);
        if (state === 'DONE') {
          // Conversation finished: surface a completion toast (Req 4.3) and
          // move the lifecycle to Done.
          setLifecycle('Done');
          toastRef.current.success('Session complete — phone number captured.');
        }
      }),
      client.onDigits((captured, expected) => setDigits({ captured, expected })),
      client.onLevel((value) => setLevel(value)),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      // Navigating away mid-call left the WebRTC session open, so the next
      // CallPage mount started a new session on top of the old one — hence
      // the "mix audio". Tear it down on unmount.
      void client.stop();
    };
  }, [client]);

  function resetUiState() {
    setSessionState(null);
    setDigits({ captured: 0, expected: 0 });
    setLevel(0);
    dispatchTranscript('reset');
  }

  async function handleToggle() {
    if (micActive) {
      // Active (or Done) → stop the session and return to Idle (Req 2.2).
      await client.stop();
      setLifecycle('Idle');
      resetUiState();
      return;
    }

    // Inactive → start a session (Req 2.1): wipe any stale indicators from
    // the previous run before the new greeting plays, then Connecting → Active.
    resetUiState();
    setLifecycle('Connecting');
    try {
      await client.start();
      setLifecycle('Active');
    } catch {
      // Negotiation failed: show an error toast and reset to inactive (Req 2.3).
      setLifecycle('Idle');
      resetUiState();
      toast.error('Could not start the voice session. Please try again.');
    }
  }

  // Displayed transcript: committed finals followed by the latest interim.
  const transcriptText = useMemo(
    () => transcriptView(transcript),
    [transcript],
  );
  const hasTranscript = transcript.finals.length > 0 || transcript.interim !== '';

  // Mic meter width as a percentage, clamped to 0..100 defensively.
  const levelPercent = Math.round(Math.min(1, Math.max(0, level)) * 100);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Voice Call</h1>

      <section className={styles.callCard} aria-label="Session control">
        <div className={styles.controls}>
          <MicButton active={micActive} onToggle={handleToggle} disabled={micDisabled} />
          <p className={styles.lifecycle}>
            <span className={styles.statusDot} data-active={micActive} />
            Status: <span className={styles.lifecycleValue}>{lifecycle}</span>
          </p>
        </div>
      </section>

      <div className={styles.side}>
      <section className={styles.indicators} aria-label="Session indicators">
        {/* State badge (Req 4.1) */}
        <div className={styles.indicator}>
          <span className={styles.indicatorLabel}>State</span>
          {sessionState ? (
            <span
              className={`${styles.badge} ${styles[`badge_${sessionState}`]}`}
              data-state={sessionState}
            >
              {STATE_LABELS[sessionState]}
            </span>
          ) : (
            <span className={styles.badgeIdle}>—</span>
          )}
        </div>

        {/* Digit progress captured / expected (Req 4.2) */}
        <div className={styles.indicator}>
          <span className={styles.indicatorLabel}>Digits</span>
          <span className={`mono ${styles.digits}`}>
            {digits.captured}
            <span className={styles.digitsExpected}> / {digits.expected}</span>
          </span>
        </div>
      </section>

      {/* Mic level meter, visible while active (Req 5.1) */}
      <section className={styles.meterSection} aria-label="Microphone level">
        <span className={styles.indicatorLabel}>Mic level</span>
        <div
          className={styles.meter}
          role="meter"
          aria-label="Microphone input level"
          aria-valuenow={levelPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          data-active={micActive}
        >
          <div
            className={styles.meterFill}
            style={{ width: `${micActive ? levelPercent : 0}%` }}
          />
        </div>
      </section>

      {/* Transcript panel (Req 3.1, 3.2) */}
      <section className={styles.transcriptSection} aria-label="Transcript">
        <h2 className={styles.sectionHeading}>
          <span aria-hidden="true">💬</span> Transcript
        </h2>
        <div className={styles.transcript} aria-live="polite">
          {hasTranscript ? (
            <p className={styles.transcriptText}>{transcriptText}</p>
          ) : (
            <p className={styles.transcriptEmpty}>No transcript yet.</p>
          )}
        </div>
      </section>
      </div>
    </main>
  );
}
