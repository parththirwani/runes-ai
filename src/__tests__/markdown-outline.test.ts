import { describe, expect, it } from 'vitest';
import { buildMarkdownOutline } from '@/src/lib/markdown-outline';

const SOURCE = [
  '# Top Title',
  '',
  'Some prose.',
  '',
  '## Section One',
  '',
  '### Deep *emphasis* section',
  '',
  '```',
  '# not a heading',
  '```',
  '',
  '## Section [two](https://example.com) with link',
].join('\n');

describe('buildMarkdownOutline', () => {
  it('builds the heading hierarchy from ATX headings only', () => {
    const outline = buildMarkdownOutline(SOURCE, 'notes.md', 1);
    expect(outline[0].name).toBe('notes.md');
    const top = outline[0].children!;
    expect(top.length).toBe(1);
    expect(top[0].name).toBe('Top Title');
    const sections = top[0].children!;
    expect(sections.map((s) => s.name)).toEqual(['Section One', 'Section two with link']);
    expect(sections[0].children![0].name).toBe('Deep emphasis section');
  });

  it('marks the heading above the active line as active', () => {
    const outline = buildMarkdownOutline(SOURCE, 'notes.md', 6);
    const top = outline[0].children![0];
    expect(top.name).toBe('Top Title');
    expect(top.children![0].active).toBe(true);
    expect(top.children![0].name).toBe('Section One');
  });

  it('ignores headings inside fenced code', () => {
    const outline = buildMarkdownOutline(SOURCE, 'notes.md', 1);
    const names = JSON.stringify(outline);
    expect(names).not.toContain('not a heading');
  });
});
