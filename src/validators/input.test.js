import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInput } from './input.js';

describe('normalizeInput', () => {
  it('returns ok with prompt string', () => {
    const result = normalizeInput({ prompt: 'hello' });
    assert.deepStrictEqual(result, { ok: true, value: 'hello' });
  });

  it('rejects empty prompt', () => {
    const result = normalizeInput({ prompt: '' });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('rejects non-string prompt', () => {
    const result = normalizeInput({ prompt: 123 });
    assert.equal(result.ok, false);
  });

  it('rejects missing fields', () => {
    const result = normalizeInput({});
    assert.equal(result.ok, false);
  });

  it('accepts input as string', () => {
    const result = normalizeInput({ input: 'test input' });
    assert.deepStrictEqual(result, { ok: true, value: 'test input' });
  });

  it('accepts input as message array', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const result = normalizeInput({ input: messages });
    assert.deepStrictEqual(result, { ok: true, value: messages });
  });

  it('rejects input with invalid message array', () => {
    const result = normalizeInput({ input: [{ bad: true }] });
    assert.equal(result.ok, false);
  });

  it('rejects empty input string', () => {
    const result = normalizeInput({ input: '   ' });
    assert.equal(result.ok, false);
  });

  it('accepts messages as string', () => {
    const result = normalizeInput({ messages: 'hello from messages' });
    assert.deepStrictEqual(result, { ok: true, value: 'hello from messages' });
  });

  it('accepts messages as valid array', () => {
    const msgs = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hi' }
    ];
    const result = normalizeInput({ messages: msgs });
    assert.deepStrictEqual(result, { ok: true, value: msgs });
  });

  it('rejects messages with missing content', () => {
    const result = normalizeInput({ messages: [{ role: 'user' }] });
    assert.equal(result.ok, false);
  });

  it('prioritizes input over prompt', () => {
    const result = normalizeInput({ prompt: 'a', input: 'b' });
    assert.deepStrictEqual(result, { ok: true, value: 'b' });
  });

  it('prioritizes input over messages', () => {
    const result = normalizeInput({ input: 'x', messages: 'y' });
    assert.deepStrictEqual(result, { ok: true, value: 'x' });
  });
});
