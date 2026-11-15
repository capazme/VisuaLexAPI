import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PASSWORD_RULE } from '../api';

describe('PASSWORD_RULE', () => {
  it('is the server\'s own regex, read from its controller (one rule, not two)', () => {
    let dir = __dirname;
    while (!existsSync(join(dir, 'apps', 'server'))) {
      if (dirname(dir) === dir) throw new Error('apps/server not found above ' + __dirname);
      dir = dirname(dir);
    }
    const controller = readFileSync(join(dir, 'apps', 'server', 'src', 'controllers', 'authController.ts'), 'utf8');
    const match = controller.match(/^const passwordRegex = \/(.+)\/([a-z]*);$/m);
    expect(match).not.toBeNull();
    expect(PASSWORD_RULE.source).toBe(match![1]);
    expect(PASSWORD_RULE.flags).toBe(match![2]);
  });
});
