import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DecisionTextView } from './DecisionTextView';

const labels = (container: HTMLElement) =>
  [...container.querySelectorAll('section[data-label]')].map((s) => s.getAttribute('data-label'));

describe('DecisionTextView', () => {
  it('never adds, drops or changes a character of the received text but its newlines', () => {
    const testo = {
      epigrafe: 'LA CORTE COSTITUZIONALE\ncomposta dai signori:  Presidente',
      motivazione: '1.- Con ordinanza\ndel 17 maggio 2013,\n\nla Corte di cassazione',
      dispositivo: 'per questi motivi\n\n1) dichiara',
    };
    const { container } = render(<DecisionTextView testo={testo} />);
    const expected = [testo.epigrafe, testo.motivazione, testo.dispositivo].join('').replaceAll('\n', '');
    expect(container.textContent).toBe(expected);
    expect(labels(container)).toEqual(['Epigrafe', 'Motivazione', 'Dispositivo']);
  });

  it('labels an epigrafe without a motivazione «Testo»: the reasoning is in it, its start unmarked', () => {
    const { container } = render(
      <DecisionTextView testo={{ epigrafe: 'ha pronunciato la seguente\nRilevato che', dispositivo: 'per questi motivi' }} />,
    );
    expect(labels(container)).toEqual(['Testo', 'Dispositivo']);
    const reasoningOnly = render(<DecisionTextView testo={{ motivazione: 'Ritenuto che' }} />);
    expect(labels(reasoningOnly.container)).toEqual(['Motivazione']);
  });

  it('renders markup in the text as text', () => {
    const { container } = render(<DecisionTextView testo={{ motivazione: '<img src=x onerror=alert(1)>' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
