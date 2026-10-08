import { describe, it, expect } from 'vitest';

// Smoke test confirming the Vitest + jsdom + jest-dom setup is wired correctly.
describe('test harness', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('has a jsdom document available', () => {
    const el = document.createElement('div');
    el.textContent = 'hello';
    expect(el.textContent).toBe('hello');
  });

  it('registers jest-dom matchers', () => {
    document.body.innerHTML = '<button>Click</button>';
    const button = document.querySelector('button');
    expect(button).toBeInTheDocument();
  });
});
