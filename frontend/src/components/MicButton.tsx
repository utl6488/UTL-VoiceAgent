import styles from './MicButton.module.css';

export interface MicButtonProps {
  /**
   * Whether a voice session is currently active. This is a CONTROLLED prop:
   * the parent (CallPage) owns the session state and passes it down. The
   * button only reflects the state and reports toggle intent via `onToggle`.
   */
  active: boolean;
  /**
   * Invoked when the user activates the button. The parent decides whether to
   * start or stop the session based on its own state (Requirements 2.1, 2.2).
   */
  onToggle: () => void;
  /** Optional: disable the control (e.g. while connecting). */
  disabled?: boolean;
}

/**
 * MicButton — a large, obvious, CONTROLLED microphone toggle.
 *
 * It does NOT own session state. It renders the current `active` state and
 * delegates activation to its parent via `onToggle`:
 * - inactive → clicking requests the parent to start a session (Requirement 2.1)
 * - active   → clicking requests the parent to stop the session (Requirement 2.2)
 *
 * Accessibility: a real <button> with `aria-pressed` reflecting the active
 * state and a descriptive `aria-label`.
 */
export function MicButton({ active, onToggle, disabled = false }: MicButtonProps) {
  const label = active ? 'Stop voice session' : 'Start voice session';

  return (
    <button
      type="button"
      className={`${styles.micButton} ${active ? styles.active : styles.idle}`}
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className={styles.icon} aria-hidden="true">
        {active ? '⏹' : '🎙'}
      </span>
      <span className={styles.text}>{active ? 'Stop' : 'Start'}</span>
    </button>
  );
}

export default MicButton;
