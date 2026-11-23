// Rewrites the computed fields of conventions/contract/anchors.json (projection, passages) from its frozen texts,
// with the server's code. From apps/server:
//   npx dotenv -e .env.test -- tsx tests/assistant/writeAnchorsContract.ts
// Then the web's suite says whether its renderer still draws every passage (anchorsContract.test.ts there).
import { readFileSync, writeFileSync } from 'node:fs';
import { anchorsPath, computeAnchors, serializeAnchors, type Anchors } from './anchorsContract';

const file = anchorsPath();
const stored = JSON.parse(readFileSync(file, 'utf8')) as Anchors;
writeFileSync(file, serializeAnchors(computeAnchors(stored)));
console.log('rewrote ' + file);
