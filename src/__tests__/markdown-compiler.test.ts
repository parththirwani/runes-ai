import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { validateMarkdownSource } from '@/worker/markdown-compiler';
import { normalizeAssetPath } from '@/src/lib/markdown-assets';

const PNG_ASSET = { path: 'images/a.png', mediaType: 'image/png', data: 'iVBORw0KGgo=' };

describe('validateMarkdownSource — resource security', () => {
  it('rejects remote images with a clear unsupported-resource error', () => {
    const issues = validateMarkdownSource('![plot](https://evil.example/plot.png)', []);
    expect(issues.some((i) => i.code === 'remote-resource')).toBe(true);
  });

  it('rejects file:, data:, and other unsafe image schemes', () => {
    expect(validateMarkdownSource('![a](file:///etc/passwd)', []).some((i) => i.code === 'unsafe-scheme')).toBe(true);
    expect(validateMarkdownSource('![a](data:image/png;base64,AAAA)', []).some((i) => i.code === 'unsafe-scheme')).toBe(true);
  });

  it('rejects javascript: and file: link destinations but keeps http links', () => {
    expect(validateMarkdownSource('[click](javascript:alert(1))', []).some((i) => i.code === 'unsafe-scheme')).toBe(true);
    expect(validateMarkdownSource('[doc](https://example.com/page)', []).length).toBe(0);
    expect(validateMarkdownSource('[mail](mailto:a@b.com)', []).length).toBe(0);
  });

  it('rejects raw HTML but tolerates autolinks', () => {
    expect(validateMarkdownSource('text <script>alert(1)</script>', []).some((i) => i.code === 'raw-html')).toBe(true);
    expect(validateMarkdownSource('<img src=x onerror=alert(1)>', []).some((i) => i.code === 'raw-html')).toBe(true);
    expect(validateMarkdownSource('see <https://example.com>', []).length).toBe(0);
  });

  it('ignores lookalike syntax inside code blocks, inline code, and math', () => {
    expect(validateMarkdownSource('```\n![fake](https://not.an/image.png)\n<b>x</b>\n```', []).length).toBe(0);
    expect(validateMarkdownSource('use `<script>` inline', []).length).toBe(0);
    expect(validateMarkdownSource('math $a < b$ stays fine', []).length).toBe(0);
  });

  it('requires referenced local assets to exist in the snapshot', () => {
    expect(validateMarkdownSource('![a](images/missing.png)', []).some((i) => i.code === 'missing-asset')).toBe(true);
    expect(validateMarkdownSource('![a](images/a.png)', [PNG_ASSET]).length).toBe(0);
    expect(validateMarkdownSource('![a](/api/document/doc-9/assets/images/a.png)', [PNG_ASSET]).length).toBe(0);
  });

  it('rejects path traversal attempts in image references', () => {
    expect(validateMarkdownSource('![a](../../etc/passwd)', []).some((i) => i.code === 'invalid-path')).toBe(true);
    expect(validateMarkdownSource('![a](/etc/passwd)', []).some((i) => i.code === 'invalid-path')).toBe(true);
  });

  it('rejects oversized source', () => {
    const issues = validateMarkdownSource('x'.repeat(1_500_000), []);
    expect(issues[0].code).toBe('too-large');
  });
});

describe('normalizeAssetPath', () => {
  it('accepts normalized relative image paths', () => {
    expect(normalizeAssetPath('images/plot.png')).toEqual({ ok: true, path: 'images/plot.png' });
    expect(normalizeAssetPath('My Photo.JPG')).toEqual({ ok: true, path: 'my-photo.jpg' });
  });

  it('rejects absolute, traversal, hidden, oversized, and non-image paths', () => {
    expect(normalizeAssetPath('/etc/passwd').ok).toBe(false);
    expect(normalizeAssetPath('../escape.png').ok).toBe(false);
    expect(normalizeAssetPath('a/../../b.png').ok).toBe(false);
    expect(normalizeAssetPath('.hidden.png').ok).toBe(false);
    expect(normalizeAssetPath('C:\\evil.png').ok).toBe(false);
    expect(normalizeAssetPath('notes.pdf').ok).toBe(false);
    expect(normalizeAssetPath('evil.svg').ok).toBe(false);
    expect(normalizeAssetPath('x'.repeat(200) + '.png').ok).toBe(false);
    expect(normalizeAssetPath('https://cdn.example/a.png').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: the pinned Pandoc + Tectonic toolchain. Skipped when the
// binaries are not installed so unit runs stay portable.
// ---------------------------------------------------------------------------

const PANDOC = process.env.PANDOC_BIN || 'pandoc';
const ENGINE = process.env.PDF_ENGINE_BIN || 'tectonic';
let toolchain = false;
try {
  execFileSync(PANDOC, ['--version'], { stdio: 'pipe' });
  execFileSync(ENGINE, ['--version'], { stdio: 'pipe' });
  toolchain = true;
} catch {
  toolchain = false;
}

const FIXTURE = [
  '# Fixture Heading',
  '',
  'Prose with **bold**, a [link](https://example.com), inline math $E=mc^2$, and `some code`.',
  '',
  '| Column A | Column B |',
  '| -------- | -------- |',
  '| cell-one | cell-two |',
  '',
  '- [x] completed task',
  '- [ ] open task',
  '',
  '- nested list',
  '  - deeper item',
  '',
  '```python',
  'def fixture_value():',
  '    return 42',
  '```',
  '',
  '![local asset](images/a.png)',
  '',
  '$$\\int_0^1 x\\,dx = \\frac{1}{2}$$',
].join('\n');

// 1x1 transparent PNG for the asset fixture.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe.skipIf(!toolchain)('markdown PDF integration (pinned pandoc + tectonic)', () => {
  it('compiles the declared feature set to a readable non-empty PDF', async () => {
    const { compileMarkdownToPDF } = await import('@/worker/markdown-compiler');
    const result = await compileMarkdownToPDF(FIXTURE, 'fixture', {
      timeout: 170_000,
      assets: [{ path: 'images/a.png', mediaType: 'image/png', data: PNG_BYTES.toString('base64') }],
    });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const pdf = result.pdfBuffer!;
    expect(pdf.length).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Readability check via pdftotext when available.
    try {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const tmp = path.join(os.tmpdir(), `mdcheck-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, pdf);
      const text = execFileSync('pdftotext', [tmp, '-'], { encoding: 'utf-8' });
      expect(text).toContain('Fixture Heading');
      expect(text).toContain('cell-one');
      expect(text).toContain('def fixture_value():');
      expect(text).toContain('completed task');
      expect(text).toMatch(/[\u{1D400}-\u{1D7FF}]/u); // math rendered as math glyphs by the engine
      fs.unlinkSync(tmp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      console.log('pdftotext unavailable — skipped text-level assertions');
    }
  }, 180_000);

  it('fails with a useful error before invoking the compiler on unsafe input', async () => {
    const { compileMarkdownToPDF } = await import('@/worker/markdown-compiler');
    const remote = await compileMarkdownToPDF('![x](https://evil.example/x.png)', 'bad', { assets: [] });
    expect(remote.success).toBe(false);
    expect(remote.error).toContain('Remote images are not supported');

    const missing = await compileMarkdownToPDF('![x](images/gone.png)', 'bad', { assets: [] });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('Missing local image asset');

    const html = await compileMarkdownToPDF('<script>alert(1)</script>', 'bad', {});
    expect(html.success).toBe(false);
    expect(html.error).toContain('Raw HTML is not supported');
  });
});

describe.skipIf(toolchain)('markdown PDF integration', () => {
  it('is skipped when PANDOC_BIN / PDF_ENGINE_BIN are not installed', () => {
    expect(toolchain).toBe(false);
  });
});
