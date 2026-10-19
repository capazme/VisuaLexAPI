import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { TappaIstituto } from '../../../../types/studia';
import { INSTITUTES_SHOWN, InstituteStops } from './InstituteStops';
import type { PercorsoState } from './usePercorso';

// The institutes of a subject on the road (Gymnasium spec §5.2, phase G5).

const tappa = (istituto: string, dovute: number, over: Partial<TappaIstituto> = {}): TappaIstituto => ({
  materia: 'DIRITTO_CIVILE', istituto, nuove: 1, apprendimento: dovute, consolidate: 2, dovute, ...over,
});

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderStops(percorso: PercorsoState, onRetry = vi.fn()) {
  const view = render(
    <MemoryRouter initialEntries={['/studia/ripasso']}>
      <Routes>
        <Route path="/studia/ripasso" element={<InstituteStops materia="DIRITTO_CIVILE" percorso={percorso} onRetry={onRetry} />} />
        <Route path="/studia/ripasso/sessione" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, onRetry };
}

const ready = (data: TappaIstituto[]): PercorsoState => ({ status: 'ready', data });
const list = () => screen.getByRole('list', { name: 'Istituti di Diritto civile' });

describe('InstituteStops', () => {
  it('draws one stop an institute of the subject, the most due first, with the cards due and the three states in words', () => {
    renderStops(ready([
      tappa('Usucapione', 0),
      tappa('Furto', 9, { materia: 'DIRITTO_PENALE' }),
      tappa('Risoluzione per inadempimento', 3),
      tappa('Azione revocatoria', 3),
    ]));
    const stops = within(list()).getAllByRole('listitem');
    expect(stops.map((li) => li.querySelector('button span')?.textContent)).toEqual(['Azione revocatoria', 'Risoluzione per inadempimento', 'Usucapione']);
    expect(stops[1]).toHaveTextContent('3 da ripassare');
    expect(stops[1]).toHaveTextContent('1 nuova · 3 in apprendimento · 2 consolidate');
    expect(stops[2]).toHaveTextContent('Niente da ripassare');
    // Free stops: nothing locked, every one a button.
    for (const stop of stops) expect(within(stop).getByRole('button')).toBeEnabled();
  });

  it('starts the session narrowed to the institute tapped, its name carried verbatim', async () => {
    const istituto = 'Contratto a favore del terzo (artt. 1411-1413 c.c.) & «patto»';
    renderStops(ready([tappa(istituto, 2)]));
    const stop = screen.getByRole('button', { name: `Ripassa ${istituto}: 2 da ripassare` });
    expect(stop).toHaveAccessibleDescription('1 nuova · 2 in apprendimento · 2 consolidate');
    await userEvent.setup().click(stop);
    const search = new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]);
    expect(search.get('materia')).toBe('DIRITTO_CIVILE');
    expect(search.get('istituto')).toBe(istituto);
  });

  it('holds a long name in its stop, wrapping it, never cutting it', () => {
    const long = 'Responsabilità precontrattuale per recesso ingiustificato dalle trattative e affidamento incolpevole della controparte'.repeat(2);
    renderStops(ready([tappa(long, 1)]));
    const name = screen.getByText(long);
    expect(name.className).toContain('[overflow-wrap:anywhere]');
    expect(name.className).not.toMatch(/truncate|line-clamp/);
  });

  it('shows the first stops of a subject with hundreds, and the rest on request', async () => {
    const many = Array.from({ length: 240 }, (_, i) => tappa(`Istituto ${String(i).padStart(3, '0')}`, i % 5));
    renderStops(ready(many));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(INSTITUTES_SHOWN);
    const more = screen.getByRole('button', { name: 'Mostra tutti gli istituti (240)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const user = userEvent.setup();
    await user.click(more);
    expect(within(list()).getAllByRole('listitem')).toHaveLength(240);
    await user.click(screen.getByRole('button', { name: `Mostra solo i primi ${INSTITUTES_SHOWN}` }));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(INSTITUTES_SHOWN);
  });

  it('enters with a 40 ms stagger, motion-safe only, the first screenful alone', async () => {
    renderStops(ready(Array.from({ length: 12 }, (_, i) => tappa(`Istituto ${String(i).padStart(2, '0')}`, 0))));
    let stops = within(list()).getAllByRole('listitem');
    expect(stops.map((li) => li.style.animationDelay)).toEqual(Array.from({ length: INSTITUTES_SHOWN }, (_, i) => `${i * 40}ms`));
    for (const stop of stops) expect(stop.className).toContain('motion-safe:animate-in');
    await userEvent.setup().click(screen.getByRole('button', { name: /Mostra tutti/ }));
    stops = within(list()).getAllByRole('listitem');
    // The stops shown on request do not wait for a turn, nor move.
    for (const stop of stops.slice(INSTITUTES_SHOWN)) {
      expect(stop.style.animationDelay).toBe('');
      expect(stop.className).not.toContain('animate-in');
    }
  });

  it('draws no line for a single institute', () => {
    renderStops(ready([tappa('Mora del debitore', 1)]));
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list().className).not.toContain('before:absolute');
  });

  it('says so when the subject has no institute to show', () => {
    renderStops(ready([tappa('Furto', 3, { materia: 'DIRITTO_PENALE' })]));
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('Nessun istituto da mostrare in questa materia, per ora.')).toBeInTheDocument();
  });

  it('holds places while the read travels', () => {
    const { container } = renderStops({ status: 'loading', data: null });
    expect(screen.getByText('Carico gli istituti…')).toBeInTheDocument();
    expect(container.querySelectorAll('.motion-safe\\:animate-pulse')).toHaveLength(3);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says a failed read and offers to read again, without an alert', async () => {
    const { onRetry } = renderStops({ status: 'error', data: null });
    expect(screen.getByText('Non riesco a leggere gli istituti di questa materia.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova gli istituti di Diritto civile' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the stops read before when a new read fails, says so, and offers to read again', async () => {
    const { onRetry } = renderStops({ status: 'error', data: [tappa('Mora del debitore', 1)] });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Non riesco ad aggiornare gli istituti: restano quelli letti prima.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova gli istituti di Diritto civile' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gives every stop and control a 44 px target', () => {
    renderStops(ready(Array.from({ length: 10 }, (_, i) => tappa(`Istituto ${i}`, 0))));
    for (const button of screen.getAllByRole('button')) expect(button.className).toContain('min-h-[44px]');
  });
});
