import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaudeMark } from './ClaudeMark';

describe('ClaudeMark', () => {
  it('says which connected application wrote the entry', () => {
    render(<ClaudeMark createdBy={{ clientName: 'Claude Code' }} />);
    expect(screen.getByText('scritta da Claude Code (applicazione collegata)')).toBeInTheDocument();
  });
  it('says so even when the application gave no name', () => {
    render(<ClaudeMark createdBy={{ clientName: null }} />);
    expect(screen.getByText("scritta da un'applicazione collegata")).toBeInTheDocument();
  });
  it("says nothing for the user's own entry", () => {
    const { container } = render(<ClaudeMark createdBy={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('keeps the whole sentence for a screen reader in its short form', () => {
    render(<ClaudeMark createdBy={{ clientName: 'Claude Code' }} compact />);
    expect(screen.getByText('scritta da Claude Code (applicazione collegata)')).toHaveClass('sr-only');
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });
});
