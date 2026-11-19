import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/taskService', () => ({ taskService: { create: vi.fn() } }));

import { QuickAddField } from './QuickAddField';
import { taskService } from '../../../services/taskService';
import { appStore } from '../../../store/useAppStore';
import type { Dossier } from '../../../types';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../../lib/motion';
import { FIELD_CONTROL, FIELD_SURFACE } from '../../ui/controlStyles';

// «Dettagli» of the task's quick add (U1b): its fields in a panel in place under the row, the box growing.
describe('QuickAddField — «Dettagli»', () => {
  it('opens the details in place under the row and closes them with Esc, the focus back on «Dettagli»', async () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const user = userEvent.setup();
    const details = screen.getByRole('button', { name: 'Dettagli' });
    const panelId = details.getAttribute('aria-controls')!;
    expect(details).toHaveAttribute('aria-expanded', 'false');
    // Closed, the space is not drawn (`ui/Expand`, LC105).
    expect(document.getElementById(panelId)).toBeNull();
    await user.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(panelId)!;
    expect(panel).not.toHaveAttribute('inert');
    // Its arrow turns with it.
    expect(details.querySelector('svg.rotate-180')).not.toBeNull();
    // Esc from one of its fields (a date, a select).
    const field = panel.querySelector<HTMLElement>('input, select')!;
    field.focus();
    await user.keyboard('{Escape}');
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(details).toHaveFocus();
  });

  // LC105: «Dettagli» opens and closes as every row of the app, on `ui/Expand` and the island's tokens.
  describe('its motion', () => {
    const calls: Array<{ frames: Keyframe[]; timing: KeyframeAnimationOptions; anim: { cancel: () => void; onfinish: (() => void) | null } }> = [];
    const originalMatchMedia = window.matchMedia;
    beforeEach(() => {
      calls.length = 0;
      Element.prototype.animate = function (frames: Keyframe[], timing: KeyframeAnimationOptions) {
        const anim = { cancel: vi.fn(), onfinish: null as (() => void) | null };
        calls.push({ frames, timing, anim });
        return anim as unknown as Animation;
      } as unknown as typeof Element.prototype.animate;
    });
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).animate;
      window.matchMedia = originalMatchMedia;
    });
    const heights = () => calls.filter((c) => 'height' in c.frames[0]);

    it('grows on the island\'s opening and shrinks on its closing', async () => {
      render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
      const user = userEvent.setup();
      const details = screen.getByRole('button', { name: 'Dettagli' });
      await user.click(details);
      expect(heights()).toHaveLength(1);
      expect(heights()[0].timing).toEqual(expect.objectContaining(ISLAND_OPEN));
      await user.click(details);
      expect(heights()[1].timing).toEqual(expect.objectContaining(ISLAND_CLOSE));
      act(() => calls.forEach((c) => c.anim.onfinish?.()));
      expect(document.getElementById(details.getAttribute('aria-controls')!)).toBeNull();
    });

    it('under reduced motion moves no height, only the fade', async () => {
      window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as unknown as typeof window.matchMedia;
      render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Dettagli' }));
      expect(heights()).toHaveLength(0);
      expect(calls.filter((c) => 'opacity' in c.frames[0])).toHaveLength(1);
    });
  });

  it('writes the title at 16 px on a phone, whatever the text size (Safari zooms under it)', () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const title = screen.getByLabelText('Nuovo compito');
    expect(title).toHaveClass('text-[length:max(1rem,16px)]', 'md:text-sm');
    expect(title).not.toHaveClass('text-base');
  });

  it('keeps its hint whole on a narrow row, the buttons going under it (cut to «Aggiun» at 320 px in the dossier)', () => {
    render(<QuickAddField view="dossier" today="2026-10-22" defaults={{ dossierId: 'd1' }} dossierLocked />);
    const title = screen.getByLabelText('Nuovo compito');
    // 12 em of its own text, whatever the page's rem (the «piccolo» size cut it again), never wider than its line.
    expect(title).toHaveClass('min-w-[min(12em,100%)]', 'flex-1');
    // The ＋ with the field, in one item of the row that wraps.
    expect(title.parentElement).toHaveClass('min-w-0');
    expect(title.parentElement!.parentElement).toHaveClass('flex-wrap');
    // The two buttons wrap together, at the right.
    const buttons = screen.getByRole('button', { name: /Aggiungi/ }).parentElement!;
    expect(buttons).toHaveClass('ml-auto');
    expect(buttons).toContainElement(screen.getByRole('button', { name: /Dettagli/ }));
  });

  it('leaves the details alone when Esc empties the title', async () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const user = userEvent.setup();
    const details = screen.getByRole('button', { name: 'Dettagli' });
    await user.click(details);
    const title = screen.getByLabelText('Nuovo compito');
    await user.type(title, 'Telefonare');
    await user.keyboard('{Escape}');
    expect(title).toHaveValue('');
    expect(details).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows its state by its arrow at every width', async () => {
    render(<QuickAddField view="today" today="2026-10-22" defaults={{}} />);
    const details = screen.getByRole('button', { name: 'Dettagli' });
    // Icon and arrow in a row at every width, never stacked (the planner's icon button is a grid).
    expect(details).toHaveClass('inline-flex');
    expect(details).not.toHaveClass('inline-grid');
    const arrow = details.querySelectorAll('svg')[1];
    expect(arrow.getAttribute('class')).not.toMatch(/\bhidden\b/);
    await userEvent.click(details);
    expect(arrow).toHaveClass('rotate-180');
  });
});

// LC78: the line read as it is typed, what was read as chips under the field, in the flow.
describe('QuickAddField — the line read', () => {
  const TODAY = '2026-11-17';
  const create = vi.mocked(taskService.create);
  const dossier = (id: string, title: string) => ({ id, title, items: [], createdAt: '', kind: 'lavoro' }) as unknown as Dossier;

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ completedAt: null, deletedAt: null, plannedDate: null, dueDate: null, dossierId: null } as never);
    appStore.setState({ dossiers: [dossier('d1', 'Rossi c. Bianchi'), dossier('d2', 'Verdi'), dossier('d3', 'Verdi appello')] });
  });

  const title = () => screen.getByLabelText('Nuovo compito');
  const chips = () => screen.queryByRole('list', { name: 'Letto nella riga' });
  const summaryLine = () => document.getElementById(title().getAttribute('aria-describedby')!)!;

  // LC111: a field must look like a field — the box on the common fields' ground, not a card's.
  it('draws its box on the ground of the common fields', () => {
    render(<QuickAddField view="today" today={TODAY} defaults={{}} />);
    expect(title().closest('form')).toHaveClass(FIELD_SURFACE);
    expect(FIELD_CONTROL.split(' ')).toEqual(expect.arrayContaining(FIELD_SURFACE.split(' ')));
  });

  // LC111: after «Aggiungi il compito» the focus is back in the field, for the next task (it was on the body).
  it('keeps the focus in the field after the button adds the task', async () => {
    render(<QuickAddField view="today" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Telefonare al cliente');
    await user.click(screen.getByRole('button', { name: /Aggiungi il compito/ }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(title()).toHaveValue('');
    expect(title()).toHaveFocus();
  });

  it('reads several symbols together and saves the line without them', async () => {
    render(<QuickAddField view="today" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Deposito memoria venerdì alle 10 #Rossi @udienza p1 {{20/11}');
    expect(chips()).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Pratica «Rossi c\. Bianchi»/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Termine finale/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Deposito memoria', plannedDate: '2026-11-20', plannedTime: '10:00', dossierId: 'd1', labels: ['udienza'],
      priority: 1, dueDate: '2026-11-20',
    }));
  });

  it('turns a chip clicked away back into text', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Call cliente domani');
    await user.click(screen.getByRole('button', { name: /^Domani: togli, «domani» resta nel titolo/ }));
    expect(chips()).toBeNull();
    expect(title()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call cliente domani', plannedDate: null }));
  });

  it('keeps a dossier that does not exist in the title, and says so', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Atto #Neri');
    expect(screen.getByText('Nessuna pratica «Neri»: resta nel titolo.')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Atto #Neri', dossierId: null }));
  });

  it('suggests the dossiers under the field, chosen with the keyboard without sending', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Atto #Ver');
    const list = screen.getByRole('listbox', { name: 'Pratiche' });
    // In the flow: not a layer over the list below (L-73).
    expect(list.className).not.toMatch(/\b(absolute|fixed)\b/);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Verdi', 'Verdi appello']);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(create).not.toHaveBeenCalled();
    expect(title()).toHaveValue('Atto #Verdi appello ');
    expect(screen.getByRole('button', { name: /^Pratica «Verdi appello»/ })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the suggestions with Esc, keeping the title', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Atto #Ve');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(title()).toHaveValue('Atto #Ve');
  });

  it('reads no dossier in the dossier panel, and says so instead of ignoring the # in silence (LC83)', async () => {
    render(<QuickAddField view="dossier" today={TODAY} defaults={{ dossierId: 'd2' }} dossierLocked />);
    const user = userEvent.setup();
    await user.type(title(), 'Atto #Rossi');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(chips()).toBeNull();
    expect(summaryLine()).toHaveTextContent('In una pratica il compito resta qui: «#» resta nel titolo.');
  });

  it('sums up only once something is typed, with the time and the labels, and says it aloud (LC83)', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const line = summaryLine();
    expect(line).toHaveAttribute('aria-live', 'polite');
    expect(line).toBeEmptyDOMElement();
    await userEvent.type(title(), 'Udienza domani alle 10 @cliente');
    expect(line).toHaveTextContent("Per domani alle 10:00 · etichetta «cliente» · nella lista d'ingresso");
    await userEvent.clear(title());
    expect(line).toBeEmptyDOMElement();
  });

  it('adds a new label as typed', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Studio @nuova');
    await user.keyboard('{Enter}');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Studio', labels: ['nuova'] }));
  });

  it('refuses a repetition with a deadline, in the existing words', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    const user = userEvent.setup();
    await user.type(title(), 'Controllo PEC ogni giorno lavorativo alle 9 {{domani}');
    await user.keyboard('{Enter}');
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Un compito con un termine finale non si ripete');
  });

  it('cannot add a line that is only symbols', async () => {
    render(<QuickAddField view="inbox" today={TODAY} defaults={{}} />);
    await userEvent.type(title(), 'domani p1');
    expect(screen.getByRole('button', { name: /Aggiungi/ })).toBeDisabled();
    // Still summed up, and said aloud: the line was read (LC83).
    expect(summaryLine()).toHaveTextContent("Per domani · priorità urgente · nella lista d'ingresso");
  });
});
