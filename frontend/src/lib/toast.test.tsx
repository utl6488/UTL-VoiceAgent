// Unit tests for the toast provider (Task 5).
//
// Covers the required notification surface (error + success/completion),
// auto-dismiss behavior, manual dismiss, the generic show() API, multiple
// concurrent toasts, and the guard that useToast must run inside a
// ToastProvider. These exercise the seams used by CallPage (Req 2.3, 4.3) and
// Dashboard (Req 8.5, 10.2).
//
// Note: this project does not install `@testing-library/dom`, so importing
// `@testing-library/react` fails at runtime (it requires that peer). Following
// the existing test convention of driving the DOM directly, these tests mount
// the provider with React's own `react-dom/client` + `act` and query/interact
// through `document`.

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DURATION,
  ToastProvider,
  useToast,
  type ToastApi,
} from './toast';

// --- Harness -----------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

/**
 * Captures the live {@link ToastApi} into a ref so tests can call it from the
 * outside (acting as a stand-in for CallPage / Dashboard consumers).
 */
function ApiProbe({ apiRef }: { apiRef: { current: ToastApi | null } }) {
  apiRef.current = useToast();
  return null;
}

function mount(): { current: ToastApi | null } {
  const apiRef = createRef<ToastApi>() as { current: ToastApi | null };
  act(() => {
    root.render(
      <ToastProvider>
        <ApiProbe apiRef={apiRef} />
      </ToastProvider>,
    );
  });
  return apiRef;
}

/** All visible toast message texts, in render order. */
function toastMessages(): string[] {
  return [...document.querySelectorAll('[role="region"] > div')].map(
    (el) => el.querySelector('span')?.textContent ?? '',
  );
}

function hasText(text: string): boolean {
  return document.body.textContent?.includes(text) ?? false;
}

// React's `act` requires this global flag when used outside a testing-library
// harness; setting it enables act() support and silences the related warnings.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('ToastProvider / useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('shows an error notification with an alert role', () => {
    const api = mount();
    act(() => {
      api.current!.error('something broke');
    });

    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('something broke');
  });

  it('shows a success/completion notification', () => {
    const api = mount();
    act(() => {
      api.current!.success('all done');
    });

    expect(hasText('all done')).toBe(true);
  });

  it('supports the generic show({ type, message }) API', () => {
    const api = mount();
    act(() => {
      api.current!.show({ type: 'info', message: 'heads up' });
    });

    expect(hasText('heads up')).toBe(true);
  });

  it('auto-dismisses after the default duration', () => {
    const api = mount();
    act(() => {
      api.current!.success('ephemeral');
    });
    expect(hasText('ephemeral')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DURATION);
    });
    expect(hasText('ephemeral')).toBe(false);
  });

  it('does not auto-dismiss when duration is non-positive', () => {
    const api = mount();
    act(() => {
      api.current!.show({ type: 'error', message: 'sticky', duration: 0 });
    });

    act(() => {
      vi.advanceTimersByTime(DEFAULT_DURATION * 3);
    });
    expect(hasText('sticky')).toBe(true);
  });

  it('dismisses a toast via its id', () => {
    const api = mount();
    let id = -1;
    act(() => {
      id = api.current!.error('go away', 0);
    });
    expect(hasText('go away')).toBe(true);

    act(() => {
      api.current!.dismiss(id);
    });
    expect(hasText('go away')).toBe(false);
  });

  it('dismisses a toast via its close button', () => {
    const api = mount();
    act(() => {
      api.current!.error('close me', 0);
    });

    const button = document.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss notification"]',
    );
    expect(button).not.toBeNull();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(hasText('close me')).toBe(false);
  });

  it('renders multiple toasts simultaneously in order', () => {
    const api = mount();
    act(() => {
      api.current!.error('first', 0);
      api.current!.success('second', 0);
    });

    expect(toastMessages()).toEqual(['first', 'second']);
  });

  it('throws when useToast is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const apiRef = createRef<ToastApi>() as { current: ToastApi | null };
    expect(() =>
      act(() => {
        root.render(<ApiProbe apiRef={apiRef} />);
      }),
    ).toThrow(/useToast must be used within a ToastProvider/);
    spy.mockRestore();
  });
});
