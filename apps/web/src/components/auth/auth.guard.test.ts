import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
/**
 * Signing in, signing up and the consent page of a connection (LC116). `AdminRoute` and `ProtectedRoute` are guards
 * with no controls of their own; the rest of `features/connections` («Collega un'app AI», the connected apps in
 * Impostazioni) has its own PR.
 */
const FILES = [
  'components/auth/AuthPage.tsx',
  'components/auth/LoginForm.tsx',
  'components/auth/RegisterForm.tsx',
  'components/auth/AuthFormParts.tsx',
  'components/auth/authForm.ts',
  'features/connections/ConnectPage.tsx',
];
const read = (name: string) => readFileSync(resolve(SRC, name), 'utf8');
const lines = (name: string, pattern: RegExp) => read(name).split('\n').flatMap((line, at) => (pattern.test(line) ? [`${name}:${at + 1}`] : []));

// LC116: sign-in, sign-up and consent speak the common components' language, as Pratiche (LC106), Opus (LC110), Learn
// (LC112), the reader (LC113) and the Forum (LC114). A bare control stays only with its reason on the line above.
describe('Sign-in and connection, no bare controls', () => {
  it('draws every button with `Button` or `IconButton`, every field with `Input`, the tabs with `SegmentedTabs`', () => {
    const bare = FILES.flatMap((name) => {
      const source = read(name).split('\n');
      return source.flatMap((line, at) => {
        if (!/<(button|select|input|motion\.button)\b|role="tablist"/.test(line)) return [];
        return /bare-(button|select|input): \S/.test(source[at - 1] ?? '') ? [] : [`${name}:${at + 1}: ${line.trim()}`];
      });
    });
    expect(bare).toEqual([]);
  });

  it('keeps no local field, button or link look of its own', () => {
    expect(FILES.filter((name) => /\b(FIELD|LABEL|PRIMARY_BUTTON|SWITCH_LINK)\b/.test(read(name)))).toEqual([]);
  });

  // 4 px for what is pressed or typed in (`CONTROL_RADIUS`), 8 px for what holds things (`CARD_RADIUS`).
  it('rounds its boxes at 8 px and its controls at 4, none at 6, 10 or 16', () => {
    expect(FILES.flatMap((name) => lines(name, /\brounded-(t-|b-|l-|r-)?(lg|xl|2xl|3xl)\b/))).toEqual([]);
  });

  // Tailwind's `duration-*`, Framer's seconds and Web Animations' milliseconds: the motion tokens (`--dur-*`,
  // `lib/motion.ts`) or the components' own.
  it('writes no duration by hand', () => {
    expect(FILES.flatMap((name) => lines(name, /\bduration-(\d|\[)|\bduration: *(0?\.\d|[1-9]\d{0,2}\b)/))).toEqual([]);
  });
});
