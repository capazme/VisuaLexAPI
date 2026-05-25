import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphFilterPanel } from '../GraphFilterPanel';

const nodeTypes = [
  { type: 'Norma', count: 12 },
  { type: 'ConcettoGiuridico', count: 5 },
];
const edgeTypes = [{ type: 'DISCIPLINA', count: 8 }];

function setup(overrides: Partial<Parameters<typeof GraphFilterPanel>[0]> = {}) {
  const props = {
    nodeTypes,
    edgeTypes,
    hiddenNodeTypes: new Set<string>(),
    hiddenEdgeTypes: new Set<string>(),
    onToggleNodeType: vi.fn(),
    onToggleEdgeType: vi.fn(),
    onSetAllNodes: vi.fn(),
    onSetAllEdges: vi.fn(),
    onHoverType: vi.fn(),
    ...overrides,
  };
  render(<GraphFilterPanel {...props} />);
  return props;
}

describe('GraphFilterPanel', () => {
  it('lists node and edge types with their counts', () => {
    setup();
    expect(screen.getByText('Norma')).toBeInTheDocument();
    expect(screen.getByText('ConcettoGiuridico')).toBeInTheDocument();
    expect(screen.getByText('DISCIPLINA')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('toggles a node type when its row is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByText('Norma'));
    expect(props.onToggleNodeType).toHaveBeenCalledWith('Norma');
  });

  it('toggles an edge type when its row is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByText('DISCIPLINA'));
    expect(props.onToggleEdgeType).toHaveBeenCalledWith('DISCIPLINA');
  });

  it('shows a row as hidden when its type is in hiddenNodeTypes', () => {
    setup({ hiddenNodeTypes: new Set(['Norma']) });
    const row = screen.getByText('Norma').closest('[role="checkbox"]');
    expect(row).toHaveAttribute('aria-checked', 'false');
  });

  it('emits hover for legend highlight on mouse enter/leave of a node row', () => {
    const props = setup();
    const row = screen.getByText('Norma').closest('[role="checkbox"]')!;
    fireEvent.mouseEnter(row);
    expect(props.onHoverType).toHaveBeenCalledWith('Norma');
    fireEvent.mouseLeave(row);
    expect(props.onHoverType).toHaveBeenCalledWith(null);
  });

  it('hide-all / show-all node controls call onSetAllNodes', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /nessuno/i }));
    expect(props.onSetAllNodes).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /tutti/i }));
    expect(props.onSetAllNodes).toHaveBeenCalledWith(false);
  });
});
