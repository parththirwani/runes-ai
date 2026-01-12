"use client";

import { useState } from "react";

interface LatexTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

const templates: LatexTemplate[] = [
  {
    id: "basic-article",
    name: "Basic Article",
    description: "Simple article template with sections",
    content: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\title{Document Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Write your introduction here.

\\section{Main Content}
Add your main content here.

\\section{Conclusion}
Write your conclusion here.

\\end{document}`
  },
  {
    id: "report",
    name: "Report",
    description: "Professional report with chapters",
    content: `\\documentclass{report}
\\usepackage[utf8]{inputenc}
\\usepackage{graphicx}

\\title{Project Report}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents

\\chapter{Introduction}
Introduction text here.

\\section{Background}
Background information.

\\chapter{Methodology}
Describe your methodology.

\\chapter{Results}
Present your results.

\\chapter{Conclusion}
Summarize your findings.

\\end{document}`
  },
  {
    id: "letter",
    name: "Letter",
    description: "Formal letter template",
    content: `\\documentclass{letter}
\\usepackage[utf8]{inputenc}

\\signature{Your Name}
\\address{Your Address \\\\ City, State ZIP}

\\begin{document}

\\begin{letter}{Recipient Name \\\\ Recipient Address \\\\ City, State ZIP}

\\opening{Dear Sir or Madam,}

Write your letter content here.

\\closing{Sincerely,}

\\end{letter}

\\end{document}`
  },
  {
    id: "math-document",
    name: "Math Document",
    description: "Document with mathematical equations",
    content: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\title{Mathematical Document}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Equations}

Inline equation: $E = mc^2$

Display equation:
\\begin{equation}
    \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
\\end{equation}

\\section{Theorem}

\\begin{theorem}
For any real numbers $a$ and $b$, $(a+b)^2 = a^2 + 2ab + b^2$.
\\end{theorem}

\\end{document}`
  },
  {
    id: "beamer-presentation",
    name: "Presentation (Beamer)",
    description: "Slide presentation template",
    content: `\\documentclass{beamer}
\\usetheme{Madrid}
\\usecolortheme{default}

\\title{Presentation Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\frame{\\titlepage}

\\begin{frame}
\\frametitle{Table of Contents}
\\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}
\\frametitle{Introduction}
\\begin{itemize}
    \\item Point 1
    \\item Point 2
    \\item Point 3
\\end{itemize}
\\end{frame}

\\section{Main Content}
\\begin{frame}
\\frametitle{Main Content}
Your content here.
\\end{frame}

\\section{Conclusion}
\\begin{frame}
\\frametitle{Conclusion}
Summary and final thoughts.
\\end{frame}

\\end{document}`
  }
];

interface TemplateModalProps {
  onSelect: (content: string) => void;
  onClose: () => void;
}

export default function LatexTemplateModal({ onSelect, onClose }: TemplateModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<LatexTemplate | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");

  const handleTemplateClick = (template: LatexTemplate) => {
    setSelectedTemplate(template);
    setPreviewContent(template.content);
  };

  const handleUseTemplate = () => {
    if (selectedTemplate) {
      onSelect(selectedTemplate.content);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">LaTeX Templates</h2>
            <p className="text-sm text-gray-600 mt-1">
              Choose a template to get started quickly
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex h-[60vh]">
          {/* Template List */}
          <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
            <div className="p-4 space-y-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => handleTemplateClick(template)}
                  className={`w-full text-left p-4 rounded-lg transition-colors ${
                    selectedTemplate?.id === template.id
                      ? "bg-blue-50 border-2 border-blue-500"
                      : "bg-gray-50 border-2 border-transparent hover:bg-gray-100"
                  }`}
                >
                  <h3 className="font-semibold text-gray-900">{template.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 p-6 overflow-y-auto bg-gray-50">
            {selectedTemplate ? (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Preview</h3>
                <pre className="bg-white p-4 rounded-lg border border-gray-200 text-sm font-mono overflow-x-auto">
                  {previewContent}
                </pre>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p>Select a template to preview</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUseTemplate}
            disabled={!selectedTemplate}
            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Use This Template
          </button>
        </div>
      </div>
    </div>
  );
}