import { describe, expect, it } from 'vitest';
import { isLocalAssetUrl, safePreviewUrl } from '@/src/lib/markdown-preview';

describe('safePreviewUrl — links', () => {
  it('keeps ordinary links usable', () => {
    expect(safePreviewUrl('https://example.com/a?b=1', 'link')).toBe('https://example.com/a?b=1');
    expect(safePreviewUrl('http://example.com', 'link')).toBe('http://example.com');
    expect(safePreviewUrl('mailto:me@example.com', 'link')).toBe('mailto:me@example.com');
    expect(safePreviewUrl('#section-one', 'link')).toBe('#section-one');
  });

  it('blocks script, file, data, blob, and scheme-relative URLs', () => {
    expect(safePreviewUrl('javascript:alert(1)', 'link')).toBeNull();
    expect(safePreviewUrl('JaVaScRiPt:alert(1)', 'link')).toBeNull();
    expect(safePreviewUrl('vbscript:msgbox(1)', 'link')).toBeNull();
    expect(safePreviewUrl('file:///etc/passwd', 'link')).toBeNull();
    expect(safePreviewUrl('data:text/html,<script>alert(1)</script>', 'link')).toBeNull();
    expect(safePreviewUrl('blob:https://evil.example/uuid', 'link')).toBeNull();
    expect(safePreviewUrl('//evil.example/x', 'link')).toBeNull();
    expect(safePreviewUrl(' java\tscript:alert(1)', 'link')).toBeNull();
    expect(safePreviewUrl('java\u0000script:alert(1)', 'link')).toBeNull();
  });
});

describe('safePreviewUrl — images', () => {
  it('resolves only validated same-origin asset paths', () => {
    expect(isLocalAssetUrl('/api/document/my-doc/assets/images/plot.png')).toBe(true);
    expect(safePreviewUrl('https://evil.example/track.gif?u=1', 'image')).toBeNull();
    expect(safePreviewUrl('//evil.example/x.png', 'image')).toBeNull();
    expect(safePreviewUrl('data:image/png;base64,AAAA', 'image')).toBeNull();
    expect(safePreviewUrl('images/plot.png', 'image')).toBeNull();
    expect(safePreviewUrl('/api/document/../assets/x.png', 'image')).toBeNull();
  });
});
