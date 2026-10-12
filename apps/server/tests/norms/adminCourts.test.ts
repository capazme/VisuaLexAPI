import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ADMIN_SECTION, FAMILY, SEATS, adminCourtName, adminSectionLabel } from '../../src/norms/adminCourts';

// The server's copy of the TAR seats against the convention's table
// (conventions/sources/tar-seats.json): a seat added or renamed there fails here.
function seatsFile(): { seats: Array<{ slug: string; sede: string; regione: string; principale: boolean; organo: string }> } {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const file = join(dir, 'conventions', 'sources', 'tar-seats.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    if (dirname(dir) === dir) throw new Error('conventions/sources/tar-seats.json not found');
  }
}


// The reader's families (services/visualex/.../decisions/model.py, FAMIGLIE): a kind it reads with a
// family must carry the same one here, or the citation loses its «ord.» or «decr.».
function readerFamilies(root: string): Record<string, string> {
  const python = readFileSync(join(root, 'services', 'visualex', 'visualex_api', 'services', 'decisions', 'model.py'), 'utf8');
  const start = python.indexOf('FAMIGLIE');
  const block = python.slice(start, python.indexOf('\n}', start));
  return Object.fromEntries([...block.matchAll(/"(\w+)":\s*\(([^)]*)\)/g)]
    .flatMap((m) => [...m[2].matchAll(/"(\w+)"/g)].map((k) => [k[1], m[1]])));
}
function repoRoot(): string {
  for (let dir = __dirname; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'conventions', 'sources', 'tar-seats.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('repository root not found');
  }
}

describe('the kinds\' families', () => {
  it('are the reader\'s', () => {
    const families = readerFamilies(repoRoot());
    expect(Object.keys(families).length).toBeGreaterThan(5);
    expect(FAMILY).toEqual(families);
  });
});

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
