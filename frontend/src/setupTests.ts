// Registers jest-dom matchers (e.g. toBeInTheDocument) for Vitest.
import '@testing-library/jest-dom/vitest';

// @pipecat-ai/small-webrtc-transport transitively imports a Daily.js audio
// worklet whose module body calls URL.createObjectURL at import time. jsdom
// doesn't implement it; a no-op shim lets the import succeed. We never run
// real WebRTC in tests — the voice client takes an injectable factory and
// tests pass a fake PipecatClient — but the import side effect runs anyway.
if (typeof URL.createObjectURL !== 'function') {
  (URL as unknown as { createObjectURL: (b?: unknown) => string }).createObjectURL =
    () => 'blob:jsdom-shim';
}
