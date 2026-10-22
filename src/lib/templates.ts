// Creation templates for each supported document format.
// The server applies the template matching the requested format when the
// create request omits content, so every document starts from a tested,
// format-correct starting point.

export function latexTemplate(title: string): string {
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${title}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Start writing your document here.

\\end{document}`;
}

export function markdownTemplate(title: string): string {
  return `# ${title}

Start writing here. You can use **bold**, *italic*, [links](https://example.com), and inline math like $E = mc^2$.

## Section

- A task list item
- [ ] An unchecked task

\`\`\`js
const hello = "code blocks are supported";
\`\`\`
`;
}
