import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { AppToShellSchema, isHello, METHODS } from '../src/index.ts';

describe('AppToShellSchema', () => {
  it('accepts a call', () => {
    expect(
      v.safeParse(AppToShellSchema, { t: 'call', id: 1, method: 'fs.readText', params: { ref: 'g_1' } })
        .success,
    ).toBe(true);
  });
  it('rejects malformed input', () => {
    for (const bad of [{ t: 'call', id: '1' }, { t: 'nope' }, null, 'x']) {
      expect(v.safeParse(AppToShellSchema, bad).success).toBe(false);
    }
  });
});

describe('isHello', () => {
  it('checks protocol field', () => {
    expect(isHello({ ew: 'hello', protocol: 1 })).toBe(true);
    expect(isHello({ ew: 'hello' })).toBe(false);
  });
});

describe('METHODS', () => {
  it('limits dialog.message buttons to 3', () => {
    const r = v.safeParse(METHODS['dialog.message'].params, {
      title: 't',
      text: 'x',
      buttons: ['a', 'b', 'c', 'd'],
    });
    expect(r.success).toBe(false);
  });
  it('requires fs.dialog for dialog.open', () => {
    expect(METHODS['dialog.open'].permission).toBe('fs.dialog');
  });
});
