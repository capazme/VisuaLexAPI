import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BreadcrumbHistory } from '../BreadcrumbHistory';

describe('BreadcrumbHistory', () => {
  it('renders nothing when there are no entries', () => {
    const { container } = render(<BreadcrumbHistory entries={[]} onNavigate={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the entry labels', () => {
    render(
      <BreadcrumbHistory
        entries={[
          { urn: 'a', label: 'Art. 2043' },
          { urn: 'b', label: 'Colpa' },
        ]}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByText('Art. 2043')).toBeInTheDocument();
    expect(screen.getByText('Colpa')).toBeInTheDocument();
  });

  it('calls onNavigate with the urn when a crumb is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <BreadcrumbHistory
        entries={[
          { urn: 'a', label: 'Art. 2043' },
          { urn: 'b', label: 'Colpa' },
        ]}
        onNavigate={onNavigate}
      />
    );
    fireEvent.click(screen.getByText('Art. 2043'));
    expect(onNavigate).toHaveBeenCalledWith('a');
  });
});
