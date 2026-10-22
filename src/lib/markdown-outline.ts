// Markdown heading outline. Mirrors the shape of latex-outline so the
// existing outline tree UI can render either format. ATX headings only
// (the declared profile); headings inside fenced code are ignored.

import type { LatexOutlineNode } from './latex-outline';

export type MarkdownOutlineNode = LatexOutlineNode;

type Heading = {
  id: string;
  title: string;
  level: number;
  lineNumber: number;
};

function cleanHeadingTitle(raw: string): string {
  let title = raw
    .replace(/!\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g, '$1') // images -> alt
    .replace(/\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g, '$1')  // links -> text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(?<!\w)([*_])(?=\S)([^*_]+?)(?<=\S)\1(?!\w)/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) title = raw.trim();
  return title || 'Untitled heading';
}

function collectHeadings(source: string): Heading[] {
  const headings: Heading[] = [];
  const lines = source.split('\n');
  let inFence = false;
  let fenceMarker: string | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!fenceMarker) { fenceMarker = fence[1][0]; inFence = true; }
      else if (fence[1][0] === fenceMarker) { fenceMarker = null; inFence = false; }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!heading) continue;
    const title = cleanHeadingTitle(heading[2]);
    if (!title) continue;
    headings.push({
      id: `h${heading[1].length}-${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'heading'}`,
      title,
      level: heading[1].length - 1,
      lineNumber: index + 1,
    });
  }
  return headings;
}

function markActive(nodes: MarkdownOutlineNode[], activeId: string | null): MarkdownOutlineNode[] {
  return nodes.map((node) => {
    const children = node.children ? markActive(node.children, activeId) : undefined;
    const hasExpandedChild = children?.some((child) => child.active || child.expanded) ?? false;
    return {
      ...node,
      active: activeId === null ? !!node.active : node.id === activeId,
      expanded: hasExpandedChild,
      children,
    };
  });
}

export function buildMarkdownOutline(source: string, fileName: string, activeLine: number = 1): MarkdownOutlineNode[] {
  const headings = collectHeadings(source);
  const activeHeading = [...headings].reverse().find((heading) => heading.lineNumber <= activeLine) ?? null;

  const root: MarkdownOutlineNode = {
    id: 'main-file',
    name: fileName,
    type: 'file',
    lineNumber: 1,
    active: activeHeading === null,
    children: [],
  };

  const stack: Array<{ level: number; node: MarkdownOutlineNode }> = [{ level: -1, node: root }];

  for (const heading of headings) {
    const node: MarkdownOutlineNode = {
      id: heading.id,
      name: heading.title,
      type: 'section',
      lineNumber: heading.lineNumber,
      children: [],
    };
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;
    parent.children = [...(parent.children ?? []), node];
    stack.push({ level: heading.level, node });
  }

  return markActive([root], activeHeading?.id ?? null);
}
