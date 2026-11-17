import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Progressi, TappaIstituto } from '../../../../types/studia';
import { LearnPath, PATH_STOPS_SHOWN } from './LearnPath';
import { LESSON_MIN_CARDS } from '../lezione/lessonPaths';
import type { PercorsoState } from './usePercorso';

// «Il tuo sentiero» (LC23, LC62): a unit per subject with cards, its institutes as stops, «Sei qui» on the first to do.

const tappa = (materia: TappaIstituto['materia'], istituto: string, dovute: number, over: Partial<TappaIstituto> = {}): TappaIstituto => ({
  materia, istituto, nuove: 1, apprendimento: dovute, consolidate: 0, dovute, ...over,
});

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderPath(percorso: PercorsoState, materie: Progressi['materie'] | null = null) {
  const onRetry = vi.fn();
  const onOpenCommunity = vi.fn();
  render(
    <MemoryRouter initialEntries={['/learn/ripasso']}>
      <Routes>
        <Route path="/learn/ripasso" element={<LearnPath percorso={percorso} materie={materie} onRetry={onRetry} onOpenCommunity={onOpenCommunity} />} />
        <Route path="/learn/ripasso/sessione" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onRetry, onOpenCommunity };
}

const ready = (data: TappaIstituto[]): PercorsoState => ({ status: 'ready', data });
const road = () => screen.getByRole('region', { name: 'Il tuo sentiero' });
const units = () => within(road()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const unit = (label: string) => screen.getByRole('region', { name: label });

describe('LearnPath', () => {
  it('draws a unit per subject with institutes, the most cards due first', () => {
    renderPath(ready([
      tappa('DIRITTO_CIVILE', 'Mora del debitore', 1),
      tappa('DIRITTO_PENALE', 'Furto', 4),
      tappa('DIRITTO_PENALE', 'Rapina', 2),
      tappa('DIRITTO_AMMINISTRATIVO', 'Silenzio assenso', 3),
    ]));
    expect(units()).toEqual(['Diritto penale', 'Diritto amministrativo', 'Diritto civile']);
    // LC23: the prototype's surface, not white.
    expect(unit('Diritto penale')).toHaveClass('bg-card');
    expect(unit('Diritto penale')).not.toHaveClass('bg-white');
  });

  it('orders the stops by the cards due, then by name, and says only the states a stop has', () => {
    renderPath(ready([
      tappa('DIRITTO_CIVILE', 'Usucapione', 0, { nuove: 3, apprendimento: 0, consolidate: 2 }),
      tappa('DIRITTO_CIVILE', 'Risoluzione', 3, { nuove: 0, apprendimento: 3, consolidate: 0 }),
      tappa('DIRITTO_CIVILE', 'Azione revocatoria', 3, { nuove: 1, apprendimento: 3, consolidate: 1 }),
    ]));
    const stops = within(screen.getByRole('list', { name: 'Istituti di Diritto civile' })).getAllByRole('button');
    expect(stops.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Ripassa Azione revocatoria: 3 da ripassare · 1 nuova · 3 in apprendimento · 1 consolidata, sei qui',
      'Ripassa Risoluzione: 3 da ripassare · 3 in apprendimento',
      // A stop with no card due names what it holds (Papiniano, 15 Nov: not «niente da ripassare»).
      'Ripassa Usucapione: 3 nuove · 2 consolidate',
    ]);
    expect(stops[0]).toHaveTextContent('3 da ripassare · 1 nuova · 3 in apprendimento · 1 consolidata');
    expect(stops[1]).toHaveTextContent(/3 da ripassare · 3 in apprendimento$/);
    expect(stops[2]).toHaveTextContent(/3 nuove · 2 consolidate$/);
    expect(stops[2]).not.toHaveTextContent(/\b0 /);
  });

  it('counts a unit\'s cards from the day\'s read when given, else from its stops, with its institutes and cards due', () => {
    const data = [tappa('DIRITTO_CIVILE', 'Mora', 2), tappa('DIRITTO_CIVILE', 'Usucapione', 0)];
    const materie: Progressi['materie'] = [{ materia: 'DIRITTO_CIVILE', nuove: 4, apprendimento: 5, consolidate: 6, ripassi30: 0 }];
    renderPath(ready(data), materie);
    expect(unit('Diritto civile')).toHaveTextContent('15 schede · 2 istituti · 2 da ripassare');
  });

  it('counts the stops\' cards when the day\'s read is not there', () => {
    // 1 new + 2 learning, 1 new + 0: 4 cards; no card due, no «da ripassare».
    renderPath(ready([tappa('DIRITTO_CIVILE', 'Mora', 0, { apprendimento: 2 }), tappa('DIRITTO_CIVILE', 'Usucapione', 0)]));
    const header = unit('Diritto civile').querySelector('header')!;
    expect(header).toHaveTextContent('4 schede · 2 istituti');
    expect(header).not.toHaveTextContent('da ripassare');
  });

  it('marks «Sei qui» on the first stop with cards due across the road, once, with «Inizia»', () => {
    renderPath(ready([
      tappa('DIRITTO_CIVILE', 'Mora', 1),
      tappa('DIRITTO_PENALE', 'Furto', 5),
      tappa('DIRITTO_PENALE', 'Appropriazione indebita', 0),
    ]));
    const here = road().querySelectorAll('[aria-current="step"]');
    expect(here).toHaveLength(1);
    expect(here[0]).toHaveAttribute('aria-label', 'Ripassa Furto: 5 da ripassare · 1 nuova · 5 in apprendimento, sei qui');
    expect(within(here[0] as HTMLElement).getByText('Inizia')).toBeInTheDocument();
    expect(within(road()).getAllByText('Inizia')).toHaveLength(1);
  });

  it('marks the first stop with new cards when nothing is due, and none with neither', () => {
    renderPath(ready([
      tappa('DIRITTO_CIVILE', 'Azione revocatoria', 0, { nuove: 0, consolidate: 3 }),
      tappa('DIRITTO_CIVILE', 'Mora', 0, { nuove: 2 }),
    ]));
    const here = road().querySelectorAll('[aria-current="step"]');
    expect(here).toHaveLength(1);
    expect(here[0]).toHaveAttribute('aria-label', 'Ripassa Mora: 2 nuove, sei qui');
  });

  it('marks no stop when nothing is due and nothing is new', () => {
    renderPath(ready([tappa('DIRITTO_CIVILE', 'Mora', 0, { nuove: 0, consolidate: 3 })]));
    expect(road().querySelector('[aria-current]')).toBeNull();
    expect(within(road()).queryByText('Inizia')).toBeNull();
  });

  it('starts the session narrowed to the institute tapped', async () => {
    const istituto = 'Contratto a favore del terzo & «patto»';
    renderPath(ready([tappa('DIRITTO_CIVILE', istituto, 2)]));
    await userEvent.setup().click(screen.getByRole('button', { name: (n: string) => n.startsWith(`Ripassa ${istituto}: 2 da ripassare`) && n.endsWith(', sei qui') }));
    const search = new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]);
    expect(search.get('materia')).toBe('DIRITTO_CIVILE');
    expect(search.get('istituto')).toBe(istituto);
  });

  it('starts the session narrowed to the subject from the unit\'s «Ripassa»', async () => {
    renderPath(ready([tappa('DIRITTO_PENALE', 'Furto', 2), tappa('DIRITTO_CIVILE', 'Mora', 1)]));
    await userEvent.setup().click(within(unit('Diritto penale')).getByRole('button', { name: 'Ripassa Diritto penale' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/learn/ripasso/sessione?materia=DIRITTO_PENALE');
  });

  it('names once the subjects with no card, and opens the community\'s cards from there', async () => {
    const { onOpenCommunity } = renderPath(ready([tappa('DIRITTO_CIVILE', 'Mora', 1)]));
    expect(units()).toEqual(['Diritto civile']);
    const box = screen.getByText('Diritto penale, Diritto amministrativo, Diritto processuale civile, Diritto processuale penale').closest('div')!;
    expect(box).toHaveTextContent(': nessuna scheda, per ora.');
    expect(box).not.toHaveTextContent('Il percorso nasce dalle tue schede.');
    expect(within(road()).queryByRole('button', { name: /^Ripassa Diritto penale/ })).toBeNull();
    await userEvent.setup().click(within(box).getByRole('button', { name: 'Scegli le schede della comunità' }));
    expect(onOpenCommunity).toHaveBeenCalledTimes(1);
  });

  it('says where the road comes from when there is no card at all', () => {
    renderPath(ready([]));
    expect(within(road()).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(road()).toHaveTextContent('Il percorso nasce dalle tue schede.');
    expect(road()).toHaveTextContent('Diritto civile, Diritto penale, Diritto amministrativo, Diritto processuale civile, Diritto processuale penale');
  });

  it('shows the first stops and the rest on request', async () => {
    const many = Array.from({ length: PATH_STOPS_SHOWN + 1 }, (_, i) => tappa('DIRITTO_CIVILE', `Istituto ${String.fromCharCode(65 + i)}`, 0));
    renderPath(ready(many));
    const list = () => within(screen.getByRole('list', { name: 'Istituti di Diritto civile' })).getAllByRole('listitem');
    expect(list()).toHaveLength(PATH_STOPS_SHOWN);
    const user = userEvent.setup();
    const more = screen.getByRole('button', { name: `Mostra tutti gli istituti (${PATH_STOPS_SHOWN + 1})` });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(list()).toHaveLength(PATH_STOPS_SHOWN + 1);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent(`Mostra solo i primi ${PATH_STOPS_SHOWN}`);
    await user.click(more);
    expect(list()).toHaveLength(PATH_STOPS_SHOWN);
  });

  it('offers no toggle with few stops', () => {
    renderPath(ready([tappa('DIRITTO_CIVILE', 'Mora', 1)]));
    expect(screen.queryByRole('button', { name: /^Mostra/ })).toBeNull();
  });

  it('holds its place while the first read travels', () => {
    renderPath({ status: 'loading', data: null });
    expect(road()).toHaveAttribute('aria-busy', 'true');
    expect(road().querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
    expect(within(road()).queryByRole('button')).toBeNull();
  });

  it('says it cannot read the road, with «Riprova», when the first read fails', async () => {
    const { onRetry } = renderPath({ status: 'error', data: null });
    expect(road()).toHaveTextContent('Non riesco a leggere il tuo sentiero.');
    expect(road()).toHaveAttribute('aria-busy', 'false');
    expect(road().querySelector('.motion-safe\\:animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.setup().click(within(road()).getByRole('button', { name: 'Riprova' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the road read before when a new read fails, and says so', async () => {
    const { onRetry } = renderPath({ status: 'error', data: [tappa('DIRITTO_CIVILE', 'Mora', 1)] });
    expect(road()).toHaveTextContent('Non riesco ad aggiornare il sentiero: resta quello letto prima.');
    expect(screen.getByRole('button', { name: (n: string) => n.startsWith('Ripassa Mora: 1 da ripassare') && n.endsWith(', sei qui') })).toBeInTheDocument();
    await userEvent.setup().click(within(road()).getByRole('button', { name: 'Riprova' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the road read before while a new read travels', () => {
    renderPath({ status: 'loading', data: [tappa('DIRITTO_CIVILE', 'Mora', 1)] });
    expect(road()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: (n: string) => n.startsWith('Ripassa Mora: 1 da ripassare') && n.endsWith(', sei qui') })).toBeInTheDocument();
    expect(road()).not.toHaveTextContent('Non riesco');
  });

  it('opens a short lesson as the first node of a subject with enough cards', () => {
    renderPath(ready([tappa('DIRITTO_CIVILE', 'Mora', 2), tappa('DIRITTO_CIVILE', 'Usucapione', 0, { nuove: 2 })]));
    const lesson = within(unit('Diritto civile')).getByRole('link', { name: /^Lezione breve di Diritto civile/ });
    expect(lesson).toHaveAttribute('href', '/learn/lezione?materia=DIRITTO_CIVILE');
  });

  it('closes the lesson, saying why, when a subject has fewer cards than a lesson needs', () => {
    renderPath(ready([tappa('DIRITTO_PENALE', 'Furto', 1, { nuove: 1 })]));
    const penal = unit('Diritto penale');
    expect(within(penal).queryByRole('link', { name: /Lezione breve/ })).toBeNull();
    expect(within(penal).getByText('Lezione breve').closest('[aria-label]')).toHaveAttribute(
      'aria-label',
      `Lezione breve di Diritto penale, chiusa: servono almeno ${LESSON_MIN_CARDS} schede (ne hai 2)`,
    );
  });

  it('lets the keyboard reach the closed lesson, which says why it is closed', () => {
    renderPath(ready([tappa('DIRITTO_PENALE', 'Furto', 1, { nuove: 1 })]));
    const closed = within(unit('Diritto penale')).getByRole('group', { name: /^Lezione breve di Diritto penale, chiusa/ });
    expect(closed).toHaveAttribute('tabindex', '0');
  });
});
