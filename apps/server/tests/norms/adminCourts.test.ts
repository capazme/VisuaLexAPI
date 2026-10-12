import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ADMIN_SECTION, SEATS, adminCourtName, adminSectionLabel } from '../../src/norms/adminCourts';

// The server's copy of the TAR seats against the convention's table
// (conventions/sources/tar-seats.json): a seat added or renamed there fails here.
function seatsFile(): { seats: Array<{ slug: string; sede: string; regione: string; principale: boolean; organo: string }> } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'tar-seats.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/tar-seats.json not found');
  }
}

describe('the TAR seats', () => {
  it('are the convention\'s', () => {
    const rows = Object.fromEntries(seatsFile().seats.map((s) => [s.slug, [s.sede, s.regione, s.principale, s.organo]]));
    expect(Object.keys(rows)).toHaveLength(29);
    expect(SEATS).toEqual(rows);
  });
  it('give each region one main seat', () => {
    const regions = new Set(Object.values(SEATS).map((s) => s[1]));
    for (const region of regions) {
      expect(Object.values(SEATS).filter((s) => s[1] === region && s[2])).toHaveLength(1);
    }
  });
});

describe('adminCourtName', () => {
  it('names the seat only where the region has several', () => {
    expect(adminCourtName('tar', 'roma')).toBe('TAR Lazio, Roma');
    expect(adminCourtName('tar', 'firenze')).toBe('TAR Toscana');
    expect(adminCourtName('tar', 'trento')).toBe('T.R.G.A. Trento');
    expect(adminCourtName('tar', 'atlantide')).toBe('TAR');
    expect(adminCourtName('cgars', null)).toBe('C.G.A.R.S.');
  });
});

describe('the sections', () => {
  it('take the suffixes of the TAR of Rome and the Adunanza plenaria', () => {
    for (const s of ['I', 'VI', 'II-quater', 'III-bis', 'plenaria']) expect(ADMIN_SECTION.test(s)).toBe(true);
    for (const s of ['6', 'unite', 'II-quinquies', 'XI', 'vi', '']) expect(ADMIN_SECTION.test(s)).toBe(false);
    expect(adminSectionLabel('plenaria')).toBe('ad. plen.');
    expect(adminSectionLabel('II-quater')).toBe('sez. II-quater');
    expect(adminSectionLabel('lavoro')).toBeNull();
  });
});
