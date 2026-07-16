import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RuntimeConfigItem } from '../opsConfigApi';

const getOpsConfig = vi.fn();
const setOpsConfig = vi.fn();
const reinitEngine = vi.fn();

vi.mock('../opsConfigApi', async () => {
  const actual = await vi.importActual<typeof import('../opsConfigApi')>('../opsConfigApi');
  return {
    ...actual,
    getOpsConfig: () => getOpsConfig(),
    setOpsConfig: (key: string, value: number | boolean | string) => setOpsConfig(key, value),
    reinitEngine: () => reinitEngine(),
  };
});

import { OpsConfigPanel } from '../OpsConfigPanel';

const PARAMS: RuntimeConfigItem[] = [
  {
    key: 'gating_confidence_threshold',
    kind: 'float',
    value: 0.6,
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Soglia di confidenza della testa gating.',
    requires_restart: false,
  },
  {
    key: 'max_experts',
    kind: 'int',
    value: 2,
    default: 2,
    min: 1,
    max: 4,
    step: 1,
    description: 'Numero massimo di esperti attivabili.',
    requires_restart: false,
  },
  {
    key: 'disagreement_model_enabled',
    kind: 'bool',
    value: true,
    default: true,
    description: 'Abilita il modello di disaccordo.',
    requires_restart: false,
  },
  {
    key: 'react_enabled',
    kind: 'bool',
    value: false,
    default: false,
    description: 'Motore ReAct (stato del container).',
    requires_restart: true,
  },
  {
    key: 'gating_model',
    kind: 'enum',
    value: 'balanced',
    default: 'balanced',
    choices: ['fast', 'balanced', 'accurate'],
    description: 'Modello usato dalla testa gating.',
    requires_restart: false,
  },
];

beforeEach(() => {
  getOpsConfig.mockReset().mockResolvedValue({ params: PARAMS });
  setOpsConfig.mockReset();
  reinitEngine.mockReset();
});

describe('OpsConfigPanel', () => {
  it('loads and groups params by requires_restart', async () => {
    render(<OpsConfigPanel />);

    await waitFor(() => expect(screen.getByText('Regolazioni a caldo')).toBeInTheDocument());
    expect(screen.getByText('Stato del motore (richiede riavvio)')).toBeInTheDocument();

    expect(screen.getByText('gating_confidence_threshold')).toBeInTheDocument();
    expect(screen.getByText('max_experts')).toBeInTheDocument();
    expect(screen.getByText('disagreement_model_enabled')).toBeInTheDocument();
    expect(screen.getByText('react_enabled')).toBeInTheDocument();
  });

  it('moving a runtime slider calls setOpsConfig with the key and parsed value', async () => {
    setOpsConfig.mockResolvedValue({ ...PARAMS[0], value: 0.75 });

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('gating_confidence_threshold')).toBeInTheDocument());

    const slider = document.getElementById('ops-config-gating_confidence_threshold') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.75' } });

    await waitFor(() => expect(setOpsConfig).toHaveBeenCalledWith('gating_confidence_threshold', 0.75));
    await waitFor(() => expect(screen.getByText(/attivo dalla prossima domanda/i)).toBeInTheDocument());
  });

  it('toggling a runtime bool calls setOpsConfig with the flipped value', async () => {
    setOpsConfig.mockResolvedValue({ ...PARAMS[2], value: false });

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('disagreement_model_enabled')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('switch', { name: 'disagreement_model_enabled' }));

    await waitFor(() => expect(setOpsConfig).toHaveBeenCalledWith('disagreement_model_enabled', false));
  });

  it('reverts and toasts on a failed update', async () => {
    setOpsConfig.mockRejectedValue(new Error('down'));

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('disagreement_model_enabled')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('switch', { name: 'disagreement_model_enabled' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'disagreement_model_enabled' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('renders requires_restart params with the "richiede riavvio" badge', async () => {
    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByTestId('engine-row-react_enabled')).toBeInTheDocument());

    const row = screen.getByTestId('engine-row-react_enabled');
    expect(row).toHaveTextContent('richiede riavvio');
  });

  it('toggling a requires_restart bool calls setOpsConfig and shows a pending-restart note', async () => {
    setOpsConfig.mockResolvedValue({ ...PARAMS[3], value: true });

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('react_enabled')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('switch', { name: 'react_enabled' }));

    await waitFor(() => expect(setOpsConfig).toHaveBeenCalledWith('react_enabled', true));
    await waitFor(() => expect(screen.getByText(/in attesa di riavvio/i)).toBeInTheDocument());
  });

  it('renders an enum param as a select with its choices and commits the chosen value', async () => {
    setOpsConfig.mockResolvedValue({ ...PARAMS[4], value: 'accurate' });

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('gating_model')).toBeInTheDocument());

    const select = document.getElementById('ops-config-gating_model') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['fast', 'balanced', 'accurate']);

    fireEvent.change(select, { target: { value: 'accurate' } });

    await waitFor(() => expect(setOpsConfig).toHaveBeenCalledWith('gating_model', 'accurate'));
    await waitFor(() => expect(screen.getByText(/attivo dalla prossima domanda/i)).toBeInTheDocument());
  });

  it('shows an error state when the initial load fails', async () => {
    getOpsConfig.mockReset().mockRejectedValue(new Error('down'));
    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('clicking "Riavvia motore" calls reinitEngine and re-fetches config on success', async () => {
    reinitEngine.mockResolvedValue({ reinitialized: true, engine: {} });
    getOpsConfig.mockResolvedValueOnce({ params: PARAMS }).mockResolvedValueOnce({ params: PARAMS });

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('Riavvia motore')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Riavvia motore'));

    await waitFor(() => expect(reinitEngine).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getOpsConfig).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/motore riavviato/i)).toBeInTheDocument());
  });

  it('shows an error toast when the reinit call fails', async () => {
    reinitEngine.mockRejectedValue(new Error('down'));

    render(<OpsConfigPanel />);
    await waitFor(() => expect(screen.getByText('Riavvia motore')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Riavvia motore'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/riavvio del motore non riuscito/i);
  });
});
