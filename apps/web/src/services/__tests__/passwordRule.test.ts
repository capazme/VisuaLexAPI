import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PASSWORD_RULE } from '../api';

describe('PASSWORD_RULE', () => {
  it('is the server\'s own regex, read from the contract that pins it (one rule, not two)', () => {
    let dir = __dirname;
    while (!existsSync(join(dir, 'conventions', 'contract', 'pins.json'))) {
      if (dirname(dir) === dir) throw new Error('conventions/contract/pins.json not found above ' + __dirname);
      dir = dirname(dir);
    }
    // Every path that sets a password reads the rule in apps/server/src/utils/password.ts: sign-up,
    // change, the administrator's create and reset. scripts/contract/build.mjs copies it into the contract.
    const pins = JSON.parse(readFileSync(join(dir, 'conventions', 'contract', 'pins.json'), 'utf8')) as {
      password_rule: { source: string; flags: string };
    };
    expect(pins.password_rule.source.length).toBeGreaterThan(0);
    expect(PASSWORD_RULE.source).toBe(pins.password_rule.source);
    expect(PASSWORD_RULE.flags).toBe(pins.password_rule.flags);
  });
});
