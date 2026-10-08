// Toast provider: a lightweight, in-app notification system (no external
// dependency) shared across pages.
//
// Design mapping ("Toasts" decision + Error Handling section): a single shared
// toast provider renders notifications so error/completion handling is
// consistent across pages. CallPage surfaces start-failure errors (Req 2.3)
// and the DONE completion toast (Req 4.3); the Dashboard surfaces delete
// failures (Req 8.5) and generic API errors (Req 10.2).
//
// The provider owns a small queue of active toasts, auto-dismisses each after
// a few seconds, and renders them in a fixed container styled with a CSS
// Module that honors the shared color variables in src/index.css.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './toast.module.css';

/** Kind of notification; drives both styling and semantics. */
export type ToastType = 'error' | 'success' | 'info';

/** Options accepted by the generic {@link ToastApi.show} method. */
export interface ShowToastOptions {
  type?: ToastType;
  message: string;
  /** Auto-dismiss delay in milliseconds. Defaults to {@link DEFAULT_DURATION}. */
  duration?: number;
}

/** A toast currently held in the provider's queue. */
export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

/**
 * The notification surface exposed by {@link useToast}.
 *
 * `error` and `success` are the two notifications required by the design;
 * `info` and the generic `show` round out a small, convenient API. Every
 * method returns the created toast's id so callers can dismiss it early.
 */
export interface ToastApi {
  show(options: ShowToastOptions): number;
  error(message: string, duration?: number): number;
  success(message: string, duration?: number): number;
  info(message: string, duration?: number): number;
  dismiss(id: number): void;
}

/** Default auto-dismiss delay (a few seconds), per the design. */
export const DEFAULT_DURATION = 4000;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Wraps the app so any descendant can call {@link useToast}. Mounted at the
 * application root (Task 15). Renders the fixed toast container itself so
 * consumers never deal with placement.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Monotonic id source and a registry of pending auto-dismiss timers so we
  // can clear them on manual dismiss / unmount and avoid leaks.
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((current) => current.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const show = useCallback(
    ({ type = 'info', message, duration = DEFAULT_DURATION }: ShowToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, type, message }]);

      // A non-positive duration means "sticky" (no auto-dismiss).
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }

      return id;
    },
    [dismiss],
  );

  const error = useCallback(
    (message: string, duration?: number) => show({ type: 'error', message, duration }),
    [show],
  );
  const success = useCallback(
    (message: string, duration?: number) => show({ type: 'success', message, duration }),
    [show],
  );
  const info = useCallback(
    (message: string, duration?: number) => show({ type: 'info', message, duration }),
    [show],
  );

  // Clear every pending timer when the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ show, error, success, info, dismiss }),
    [show, error, success, info, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.container} role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type]}`}
            role={toast.type === 'error' ? 'alert' : 'status'}
            aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          >
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.dismiss}
              aria-label="Dismiss notification"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Access the shared toast API. Must be called within a {@link ToastProvider};
 * throws otherwise so misuse surfaces during development rather than silently
 * dropping notifications.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return api;
}
