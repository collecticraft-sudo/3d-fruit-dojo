// Tells the asset tests whether the heavy art sources of design/ are on disk. The published repository keeps design/assets.csv, the fonts,
// the tools and the small sprite, UI and icon sources, but NOT the 4k backdrops and the raw generated sheets, so the tests that rebuild
// public/assets from design/ (or compare hashes with it) cannot run there. They must SKIP with a clear message instead of failing.
// Node built-ins and tools/lib/csv.mjs only. OWNER: integrator.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvObjects } from '../../tools/lib/csv.mjs';

/**
 * @param {string} root the project root
 * @returns {{ complete: boolean, hasCsv: boolean, total: number, missing: string[], message: string }}
 *   `complete` is true only when design/assets.csv exists and every image source file named by it exists.
 */
export function designSources(root) {
  const csvFile = join(root, 'design', 'assets.csv');
  if (!existsSync(csvFile)) return { complete: false, hasCsv: false, total: 0, missing: ['design/assets.csv'], message: 'design/assets.csv is not present' };
  const rows = parseCsvObjects(readFileSync(csvFile, 'utf8')).filter((r) => /^png/.test(r.type));
  const missing = [];
  for (const r of rows) {
    const m = r.source.match(/design\/[A-Za-z0-9_./-]+\.png/g);
    const file = m ? m[m.length - 1] : `design/?/${r.id}.png`;
    if (!existsSync(join(root, file))) missing.push(file);
  }
  const complete = missing.length === 0;
  const message = complete ? '' : `the art sources of design/ are incomplete (${missing.length} of ${rows.length} files missing, for example ${missing[0]}): the 4k backdrops and the raw sheets are not part of the published repository`;
  return { complete, hasCsv: true, total: rows.length, missing, message };
}
