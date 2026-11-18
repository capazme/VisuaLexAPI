import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { atLeastUnits } from './utf16Length';

const SALT_ROUNDS = 10;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  return bcrypt.compare(password, hashedPassword);
};

/**
 * The rule every password must meet, wherever it is set: at sign-up, on a change, and when the administrator
 * creates an account or resets a password (scan B: the administrator's paths took 3 characters). At least 8
 * characters, one lowercase, one uppercase, one digit. The web shows the same rule (`PASSWORD_RULE` in
 * `apps/web/src/services/api.ts`) and translates this message.
 */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters with 1 uppercase, 1 lowercase, and 1 number';

export const passwordSchema = () => z.string().refine(...atLeastUnits(8)).regex(PASSWORD_RULE, PASSWORD_RULE_MESSAGE);

export const meetsPasswordRule = (password: string): boolean => password.length >= 8 && PASSWORD_RULE.test(password);
