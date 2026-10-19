import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiClients } from '../aiClients';
import {
  LEGAL_IT_CLIENTS,
  LEGAL_IT_PRIVACY,
  LEGAL_IT_RELEASES_URL,
  LEGAL_IT_REPO_URL,
  LEGAL_IT_UNSUPPORTED,
  UV_INSTALL,
} from '../legalItClients';

// The file as written, comments included: what it may never say is checked on the source, so a
// version number or a stray link cannot hide in a string the page does not happen to draw today.
const source = readFileSync(join(__dirname, '..', 'legalItClients.ts'), 'utf8');

const ALLOWED_LINKS = ['https://github.com/capazme/mcp-legal-it', 'https://github.com/capazme/mcp-legal-it/releases/latest'];

describe('legalItClients', () => {
  it('gives each card the shape of a VisuaLex client card, without the deletion line', () => {
    expect(LEGAL_IT_CLIENTS.map((client) => client.name)).toEqual(['Claude Desktop (consigliato)', 'Claude Code (plugin)']);
    for (const client of LEGAL_IT_CLIENTS) {
      expect(client.id).toMatch(/^legal-it-/);
      expect(client.kind).not.toBe('');
      expect(client.steps.length).toBeGreaterThan(0);
      for (const step of client.steps) expect(step.text).not.toBe('');
      for (const step of client.steps.filter((s) => s.code)) expect(step.codeLabel).toMatch(/^il comando /);
      expect(Array.isArray(client.limits)).toBe(true);
      expect('confirmsDeletions' in client).toBe(false);
    }
  });

  it('shares no id and no name with the VisuaLex cards, so the page names each card once', () => {
    const visualex = aiClients('https://visualex.example/mcp');
    const ids = new Set(visualex.map((client) => client.id));
    const names = new Set(visualex.map((client) => client.name));
    for (const client of LEGAL_IT_CLIENTS) {
      expect(ids.has(client.id)).toBe(false);
      expect(names.has(client.name)).toBe(false);
    }
  });

  it('links only to the repository and its latest release', () => {
    expect([LEGAL_IT_REPO_URL, LEGAL_IT_RELEASES_URL]).toEqual(ALLOWED_LINKS);
    const links = LEGAL_IT_CLIENTS.flatMap((client) => client.steps.flatMap((step) => (step.link ? [step.link.href] : [])));
    for (const href of links) expect(ALLOWED_LINKS).toContain(href);
    // Any other address in the file is inside a command to copy (uv's installer), never a link.
    const commands = [...UV_INSTALL, ...LEGAL_IT_CLIENTS.flatMap((client) => client.steps)].flatMap((step) => (step.code ? [step.code] : []));
    for (const url of source.match(/https?:\/\/[^\s'"`)]+/g) ?? []) {
      if (ALLOWED_LINKS.includes(url)) continue;
      expect([url, commands.some((code) => code.includes(url))]).toEqual([url, true]);
    }
  });

  it('never points at GitHub’s source archives, which do not hold the server', () => {
    expect(source).not.toMatch(/\/archive\//);
    expect(source).not.toMatch(/\.tar\.gz|\.zip\b|Download ZIP/i);
  });

  it('writes no version number and no tagged uvx command', () => {
    expect(source).not.toMatch(/\bv?\d+\.\d+(?:\.\d+)?\b/);
    expect(source).not.toMatch(/@v\d/);
    expect(source).not.toMatch(/\bv\d+\b/);
    expect(source).not.toMatch(/legal-it-\d/);
    expect(source).not.toMatch(/\buvx\b/);
    expect(source).toContain('legal-it-….mcpb');
  });

  it('names neither the licence nor Brocardi', () => {
    expect(source).not.toMatch(/\blicenz|\bApache\b|\bMPL\b/i);
    expect(source).not.toMatch(/brocardi/i);
  });

  it('keeps the privacy sentence word for word', () => {
    expect(LEGAL_IT_PRIVACY).toBe(
      'Il server gira sul tuo computer e interroga direttamente le fonti pubbliche; non manda i tuoi dati a VisuaLex. Quello che scrivi all’app AI resta soggetto alle sue condizioni.',
    );
  });

  it('installs uv on macOS and Linux and on Windows, and lists what cannot run the server', () => {
    expect(UV_INSTALL.map((step) => step.code)).toEqual([
      'curl -LsSf https://astral.sh/uv/install.sh | sh',
      'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
    ]);
    expect(LEGAL_IT_UNSUPPORTED).toEqual(['claude.ai sul web', 'Le app mobili di Claude', 'L’agente cloud di Claude Desktop (Cowork)']);
  });
});
