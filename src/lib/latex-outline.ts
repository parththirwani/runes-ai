export type LatexOutlineNode = {
  id: string;
  name: string;
  type: 'file' | 'section';
  lineNumber: number;
  active?: boolean;
  expanded?: boolean;
  children?: LatexOutlineNode[];
};

type Heading = {
  id: string;
  title: string;
  level: number;
  lineNumber: number;
};

const HEADING_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
};

function parseHeadingLine(line: string, lineNumber: number): Heading | null {
  const commandMatch = line.match(/^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?/);
  if (!commandMatch) return null;

  const command = commandMatch[1];
  let index = commandMatch[0].length;

  if (line[index] === '[') {
    let bracketDepth = 1;
    index += 1;
    while (index < line.length && bracketDepth > 0) {
      if (line[index] === '[') bracketDepth += 1;
      else if (line[index] === ']') bracketDepth -= 1;
      index += 1;
    }
  }

  if (line[index] !== '{') return null;

  let braceDepth = 0;
  let title = '';
  for (; index < line.length; index += 1) {
    const char = line[index];
    if (char === '{') {
      braceDepth += 1;
      if (braceDepth > 1) title += char;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) break;
      title += char;
      continue;
    }
    if (braceDepth >= 1) {
      title += char;
    }
  }

  if (!title.trim()) return null;

  const cleanedTitle = cleanHeadingTitle(title);

  return {
    id: `${command}-${lineNumber}-${cleanedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section'}`,
    title: cleanedTitle,
    level: HEADING_LEVELS[command],
    lineNumber,
  };
}

function cleanHeadingTitle(rawTitle: string): string {
  let title = rawTitle.trim();
  let previous = '';

  while (title !== previous) {
    previous = title;
    title = title.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1');
  }

  title = title
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\_/g, '_')
    .replace(/\\#/g, '#')
    .replace(/\\\$/g, '$')
    .replace(/\\textbackslash\b/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();

  return title || 'Untitled section';
}

function collectHeadings(source: string): Heading[] {
  return source.split('\n').flatMap((line, index) => {
    const heading = parseHeadingLine(line, index + 1);
    return heading ? [heading] : [];
  });
}

function markActive(nodes: LatexOutlineNode[], activeId: string | null): LatexOutlineNode[] {
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

export function buildLatexOutline(source: string, fileName: string, activeLine: number = 1): LatexOutlineNode[] {
  const headings = collectHeadings(source);
  const activeHeading = [...headings].reverse().find((heading) => heading.lineNumber <= activeLine) ?? null;

  const root: LatexOutlineNode = {
    id: 'main-file',
    name: fileName,
    type: 'file',
    lineNumber: 1,
    active: activeHeading === null,
    children: [],
  };

  const stack: Array<{ level: number; node: LatexOutlineNode }> = [{ level: -1, node: root }];

  for (const heading of headings) {
    const node: LatexOutlineNode = {
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
