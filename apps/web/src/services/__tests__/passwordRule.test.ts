import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PASSWORD_RULE } from '../api';

describe('PASSWORD_RULE', () => {
  it('is the server\'s own regex, read from where the server keeps it (one rule, not two)', () => {
    let dir = __dirname;
    while (!existsSync(join(dir, 'apps', 'server'))) {
      if (dirname(dir) === dir) throw new Error('apps/server not found above ' + __dirname);
      dir = dirname(dir);
    }
    // Every path that sets a password reads it there: sign-up, change, the administrator's create and reset.
    const source = readFileSync(join(dir, 'apps', 'server', 'src', 'utils', 'password.ts'), 'utf8');
    const match = source.match(/^export const PASSWORD_RULE = \/(.+)\/([a-z]*);$/m);
    expect(match).not.toBeNull();
    expect(PASSWORD_RULE.source).toBe(match![1]);
    expect(PASSWORD_RULE.flags).toBe(match![2]);
  });
});
