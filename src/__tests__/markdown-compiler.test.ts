import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { validateMarkdownSource, rewriteAssetUrlsForEngine, detectCompilerIsolation } from '@/worker/markdown-compiler';
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

  it('allows ordinary reference-style links with a following definition', () => {
    expect(validateMarkdownSource('See [example][site].\n\n[site]: https://example.com', []).length).toBe(0);
    expect(validateMarkdownSource('See [example][].\n\n[example]: https://example.com', []).length).toBe(0);
    expect(validateMarkdownSource('See [site].\n\n[site]: https://example.com', []).length).toBe(0);
    expect(validateMarkdownSource('See <https://example.com> and [example][site].\n\n[site]: https://example.com/docs', []).length).toBe(0);
  });

  it('still blocks unsafe destinations reached through reference definitions', () => {
    expect(validateMarkdownSource('![a][pic]\n\n[pic]: https://evil.example/x.png', []).some((i) => i.code === 'remote-resource')).toBe(true);
    expect(validateMarkdownSource('![a][pic]\n\n[pic]: file:///etc/passwd', []).some((i) => i.code === 'unsafe-scheme')).toBe(true);
    expect(validateMarkdownSource('[click][j]\n\n[j]: javascript:alert(1)', []).some((i) => i.code === 'unsafe-scheme')).toBe(true);
    expect(validateMarkdownSource('![a][pic]\n\n[pic]: images/missing.png', []).some((i) => i.code === 'missing-asset')).toBe(true);
    expect(validateMarkdownSource('![a][pic]\n\n[pic]: images/a.png', [PNG_ASSET]).length).toBe(0);
    expect(validateMarkdownSource('![a][pic]\n\n[pic]: /api/document/doc-9/assets/images/a.png', [PNG_ASSET]).length).toBe(0);
  });

  it('ignores unresolved reference labels (they render as literal text)', () => {
    expect(validateMarkdownSource('![a][undeclared] and [b][missing]', []).length).toBe(0);
  });

  it('treats definitions inside fenced code as literal text', () => {
    expect(validateMarkdownSource('```\n![a][pic]\n\n[pic]: https://evil.example/x.png\n```', []).length).toBe(0);
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

describe('rewriteAssetUrlsForEngine', () => {
  it('rewrites canonical asset URLs to the job-relative paths pandoc receives', () => {
    const src = '![Logo](/api/document/abc-123/assets/images/logo.png)\n\nsee [doc](/api/document/abc-123/assets/notes.md)\n\n[pic]: /api/document/abc-123/assets/imgs/p.png';
    expect(rewriteAssetUrlsForEngine(src)).toBe('![Logo](images/logo.png)\n\nsee [doc](notes.md)\n\n[pic]: imgs/p.png');
  });

  it('leaves fenced code blocks untouched', () => {
    const src = 'before\n```\n/api/document/abc/assets/keep.png\n```\nafter /api/document/abc/assets/x.png';
    const out = rewriteAssetUrlsForEngine(src);
    expect(out).toContain('/api/document/abc/assets/keep.png');
    expect(out.endsWith('after x.png')).toBe(true);
  });
});

describe('compiler process isolation', () => {
  it('detects whether a private network namespace is available', async () => {
    const mode = await detectCompilerIsolation();
    expect(mode === null || Array.isArray(mode)).toBe(true);
    if (mode) {
      expect(mode[1]).toBe('--net');
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const { stdout } = await promisify(execFile)(mode[0], [...mode.slice(1), 'sh', '-c', 'cat /proc/net/dev'], { timeout: 10_000 });
      // A fresh network namespace exposes only the loopback interface.
      const devices = stdout
        .split('\n')
        .filter((line: string) => /^\s*\S+:/.test(line))
        .map((line: string) => line.split(':')[0].trim());
      expect(devices).toEqual(['lo']);
    }
  });
});

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

  it('embeds an uploaded image referenced with the canonical asset URL syntax', async () => {
    const { compileMarkdownToPDF } = await import('@/worker/markdown-compiler');
    const slug = 'doc-embed-check';
    const withImage = [
      '# Embedded Image Check',
      '',
      `![Logo](/api/document/${slug}/assets/images/a.png)`,
      '',
      'Paragraph after the image.',
    ].join('\n');
    const withoutImage = '# Embedded Image Check\n\nParagraph after the image.\n';
    const assets = [{ path: 'images/a.png', mediaType: 'image/png', data: PNG_BYTES.toString('base64') }];

    const control = await compileMarkdownToPDF(withoutImage, slug, { timeout: 170_000, assets: [] });
    expect(control.success).toBe(true);
    const controlText = control.pdfBuffer!.toString('latin1');
    expect(controlText).not.toContain('/Subtype /Image');

    const result = await compileMarkdownToPDF(withImage, slug, { timeout: 170_000, assets });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const pdf = result.pdfBuffer!;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // An embedded raster image appears as an image XObject in the PDF objects.
    const text = pdf.toString('latin1');
    expect(text).toMatch(/\/Subtype\s*\/Image/);
    expect(pdf.length).toBeGreaterThan(control.pdfBuffer!.length);
  }, 360_000);

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
