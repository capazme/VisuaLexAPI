import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
/**
 * Signing in, signing up, the session kept while the account cannot be read, and the consent page of a connection
 * (LC116). `AdminRoute`'s «Accesso negato» belongs to the admin page's PR; the rest of `features/connections` («Collega
 * un'app AI», the connected apps in Impostazioni) to its own.
 */
const FILES = [
  'components/auth/AuthPage.tsx',
  'components/auth/LoginForm.tsx',
  'components/auth/RegisterForm.tsx',
  'components/auth/AuthFormParts.tsx',
  'components/auth/authForm.ts',
  'components/auth/ProtectedRoute.tsx',
  'features/connections/ConnectPage.tsx',
];
const read = (name: string) => readFileSync(resolve(SRC, name), 'utf8');

// LC116: sign-in, sign-up and consent speak the common components' language, as Pratiche (LC106), Opus (LC110), Learn
// (LC112), the reader (LC113) and the Forum (LC114). Bare controls, radii and durations are the app's guard's (LC118).
describe('Sign-in and connection, the common components', () => {
  it('draws the tabs with `SegmentedTabs`', () => {
    expect(FILES.filter((name) => /role="tablist"/.test(read(name)))).toEqual([]);
  });

  it('keeps no local field, button or link look of its own', () => {
    expect(FILES.filter((name) => /\b(FIELD|LABEL|PRIMARY_BUTTON|SWITCH_LINK)\b/.test(read(name)))).toEqual([]);
  });
});
