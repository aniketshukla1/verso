import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// PDF -> text with poppler's pdftotext (brew install poppler), keeping the
// layout so indentation still separates a definition from its tables. Only
// text is extracted; nothing in the file is executed.
export function pdfText(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'verso-pdf-'));
  try {
    const file = join(dir, 'source.pdf');
    writeFileSync(file, buf);
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('pdftotext not found: install poppler (brew install poppler)');
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
