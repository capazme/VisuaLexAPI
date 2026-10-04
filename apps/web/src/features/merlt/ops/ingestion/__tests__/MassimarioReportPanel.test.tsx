// apps/web/src/features/merlt/ops/ingestion/__tests__/MassimarioReportPanel.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MassimarioReportPanel } from '../MassimarioReportPanel';
import type { MassimarioReport } from '../types';

const REPORT: MassimarioReport = {
  volume: { id: 96, titolo: 'Massimario 2024 CIVILE Vol. 1', anno: 2024, archivio: 'civile', numero: 1 },
  paragrafi: 1325,
  frammenti: 1360,
  citazioni: {
    rv_totali: 1208, rv_riconosciute: 1190, copertura_pct: 98.5,
    per_forma: { slash: 900 }, senza_identita: { archivio_ignoto: 2 },
    non_riconosciute: ['<b>testo</b> (Rv. 251820)'],
  },
  pronunce: { totali: 980, anno_implicito: 3, chiavi_con_piu_sezioni: [], gia_nel_grafo: 12 },
  norme: {
    riferimenti: 1138, articoli: 400, atti: 120, stub: 520, date_completate: 300, non_risolte: 2,
    partizioni: 5, campioni_non_risolti: [], gia_nel_grafo: 210,
  },
  sezioni_fuori_capitolo: 0,
};

describe('MassimarioReportPanel', () => {
  it('shows the coverage and the counts', () => {
    render(<MassimarioReportPanel report={REPORT} />);
    expect(screen.getByText(/98,5%/)).toBeInTheDocument();
    expect(screen.getByText(/1\.190 su 1\.208/)).toBeInTheDocument();
    expect(screen.getByText(/Massimario 2024 CIVILE Vol\. 1/)).toBeInTheDocument();
    expect(screen.queryByText(/sotto la soglia/)).not.toBeInTheDocument();
  });

  it('counts the decisions the portal linked as laws', () => {
    render(<MassimarioReportPanel report={{ ...REPORT, norme: { ...REPORT.norme, link_a_pronunce: 1234 } }} />);
    expect(screen.getByText(/1\.234 \(escluse dalle norme\)/)).toBeInTheDocument();
  });

  it('warns below 95%', () => {
    render(<MassimarioReportPanel report={{ ...REPORT, citazioni: { ...REPORT.citazioni, copertura_pct: 93.1 } }} />);
    expect(screen.getByText(/sotto la soglia del 95%/)).toBeInTheDocument();
  });

  it('renders samples as text', () => {
    const { container } = render(<MassimarioReportPanel report={REPORT} />);
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>testo</b> (Rv. 251820)')).toBeInTheDocument();
  });

  it('offers to resume vectors that stopped, only when the caller can resume', () => {
    const onResume = vi.fn();
    const { rerender } = render(
      <MassimarioReportPanel report={REPORT} vectors={{ done: 300, total: 1360, error: 'ReadTimeout' }} onResume={onResume} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Riprendi i vettori' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    rerender(<MassimarioReportPanel report={REPORT} vectors={{ done: 1360, total: 1360 }} onResume={onResume} />);
    expect(screen.queryByRole('button', { name: 'Riprendi i vettori' })).not.toBeInTheDocument();
    rerender(<MassimarioReportPanel report={REPORT} vectors={{ done: 300, total: 1360 }} />);
    expect(screen.queryByRole('button', { name: 'Riprendi i vettori' })).not.toBeInTheDocument();
  });

  it('shows the vector progress and its error', () => {
    render(<MassimarioReportPanel report={REPORT} vectors={{ done: 300, total: 1360, error: 'qdrant down' }} />);
    expect(screen.getByText(/300 su 1\.360/)).toBeInTheDocument();
    expect(screen.getByText(/qdrant down/)).toBeInTheDocument();
  });
});
