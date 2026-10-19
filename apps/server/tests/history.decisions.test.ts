import { describe, expect, it, beforeEach } from 'vitest';
import { request, app, prisma, createTestUser, authHeader, type TestUser } from './helpers';

const CASS = 'cassazione:civile:99999:2024';
const CORTE = 'corte_costituzionale:99999:2020';

describe('decisions in the search history', () => {
  let alice: TestUser;
  beforeEach(async () => { alice = await createTestUser('history-alice'); });

  const post = (body: Record<string, unknown>) =>
    request(app).post('/api/history').set(authHeader(alice)).send(body);

  it('records a decision and lists it beside the norms', async () => {
    await post({ act_type: 'legge', act_number: '241', date: '1990' }).expect(201);
    const add = await post({ decision_key: CASS }).expect(201);
    expect(add.body).toMatchObject({ decision_key: CASS, act_type: null, act_number: null });
    const list = await request(app).get('/api/history').set(authHeader(alice)).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({ decision_key: CASS, act_type: null });
    expect(list.body[1]).toMatchObject({ decision_key: null, act_type: 'legge' });
  });

  it('refuses both kinds at once, neither, and a malformed key, in Italian', async () => {
    const both = await post({ decision_key: CASS, act_type: 'legge' }).expect(400);
    expect(both.body.detail).toBe('Una voce della cronologia è una norma o una sentenza, non entrambe');
    const neither = await post({}).expect(400);
    expect(neither.body.detail).toBe('Manca la norma o la sentenza');
    for (const key of ['cassazione:tributario:99999:2024', 'cassazione:civile:99999:2999', 'legge:241', 42]) {
      const bad = await post({ decision_key: key }).expect(400);
      expect(bad.body.detail).toBe('La chiave della sentenza non è valida');
    }
    expect(await prisma.searchHistory.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('de-duplicates a decision opened again within five minutes', async () => {
    const a = await post({ decision_key: CORTE }).expect(201);
    const b = await post({ decision_key: CORTE }).expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.searchHistory.count({ where: { userId: alice.id } })).toBe(1);
    const other = await post({ decision_key: CASS }).expect(201);
    expect(other.body.id).not.toBe(a.body.id);
  });

  it('keeps the norm path: de-duplicates a norm within five minutes and refuses a malformed one in Italian', async () => {
    const a = await post({ act_type: 'legge', act_number: '241', date: '1990' }).expect(201);
    const b = await post({ act_type: 'legge', act_number: '241', date: '1990' }).expect(200);
    expect(b.body.id).toBe(a.body.id);
    const bad = await post({ act_type: '' }).expect(400);
    expect(bad.body.detail).toBe('La norma della cronologia non è valida');
  });

  it('the database refuses a row with neither kind or with both', async () => {
    await expect(prisma.searchHistory.create({ data: { userId: alice.id } })).rejects.toThrow(/search_history_one_kind/);
    await expect(prisma.searchHistory.create({ data: { userId: alice.id, actType: 'legge', decisionKey: CASS } })).rejects.toThrow(/search_history_one_kind/);
  });

  it('exports the decision key with the history and erases the rows with the account', async () => {
    await post({ decision_key: CASS }).expect(201);
    const exported = await request(app).get('/api/auth/export').set(authHeader(alice)).expect(200);
    expect(exported.body.data.history).toHaveLength(1);
    expect(exported.body.data.history[0]).toMatchObject({ decisionKey: CASS, actType: null });

    await request(app).delete('/api/auth/account').set(authHeader(alice))
      .send({ password: 'test-password', confirmation: 'ELIMINA ACCOUNT' }).expect(204);
    expect(await prisma.searchHistory.count({ where: { userId: alice.id } })).toBe(0);
  });
});
