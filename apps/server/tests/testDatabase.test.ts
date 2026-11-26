import { describe, it, expect, inject } from 'vitest';
import { assertTestDatabase, databaseName, isRunDatabaseOf, quoteIdentifier, runDatabaseName, withDatabase } from './testDatabase';

/** The run's own test database (tests/globalSetup.ts): its name, its URL and the guard that refuses anything else. */
describe('the run database', () => {
  it('refuses a DATABASE_URL whose database is not a test one', () => {
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/visualex_platform')).toThrow(/Refusing to run tests/);
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/visualex_platform?sslrootcert=/certs/test-ca.pem')).toThrow();
    expect(() => assertTestDatabase('not a url')).toThrow();
    expect(() => assertTestDatabase('postgresql://u:p@localhost:5432/visualex_test')).not.toThrow();
  });

  it('names it after the test database, the process and a random suffix', () => {
    const name = runDatabaseName('visualex_test', 4242, 'a1b2c3');
    expect(name).toBe('visualex_test_run_4242_a1b2c3');
    expect(isRunDatabaseOf(name, 'visualex_test')).toBe(true);
  });

  it('refuses a run name that would not extend a test database', () => {
    expect(() => runDatabaseName('visualex_platform', 1, 'aa')).toThrow(/Refusing the run database name/);
    expect(() => runDatabaseName('visualex-test', 1, 'aa')).toThrow();
    expect(() => runDatabaseName(`${'t'.repeat(60)}test`, 1, 'aa')).toThrow();
  });

  it('drops only a database this naming made', () => {
    expect(isRunDatabaseOf('visualex_test', 'visualex_test')).toBe(false);
    expect(isRunDatabaseOf('visualex_platform_run_1_aa', 'visualex_platform')).toBe(false);
    expect(isRunDatabaseOf('other_test_run_1_aa', 'visualex_test')).toBe(false);
    expect(isRunDatabaseOf('visualex_test_run_1_zz', 'visualex_test')).toBe(false);
  });

  it('changes only the database in the URL', () => {
    const url = withDatabase('postgresql://u:p@db.example:5432/visualex_test?sslmode=disable', 'visualex_test_run_1_aa');
    expect(url).toBe('postgresql://u:p@db.example:5432/visualex_test_run_1_aa?sslmode=disable');
    expect(databaseName(url)).toBe('visualex_test_run_1_aa');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });

  it('is the database this file runs on', () => {
    const { url } = inject('testDatabase');
    expect(process.env.DATABASE_URL).toBe(url);
    expect(databaseName(url)).toMatch(/_run_\d+_[a-f0-9]+$/);
  });
});
