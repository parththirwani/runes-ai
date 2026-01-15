"use client";

import React, { useState } from 'react';
import TopNavBar from './TopNavBar';
import FileTree from './FileTree';
import MonacoEditorWrapper from './MonacoEditorWrapper';
import PDFPreview from './PDFPreview';

type ViewMode = 'editor' | 'split' | 'preview';

const initialCode = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{My LaTeX Document}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
This is the introduction section of your document.

\\section{Main Content}
Add your main content here. You can use various LaTeX commands to format your text.

\\subsection{A Subsection}
This is a subsection with some mathematical notation: $E = mc^2$

\\begin{equation}
    \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
\\end{equation}

\\section{Conclusion}
Summarize your findings here.

\\end{document}`;

export default function DocumentEditor() {
  const [code, setCode] = useState(initialCode);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showFileTree, setShowFileTree] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>();

  const handleSave = () => {
    setIsSaving(true);
    // Simulate save
    setTimeout(() => {
      setIsSaving(false);
      console.log('Document saved');
    }, 1000);
  };

  const handleCompile = () => {
    setIsCompiling(true);
    // Simulate compilation
    setTimeout(() => {
      setIsCompiling(false);
      // In real implementation, this would be the actual PDF URL
      setPdfUrl('about:blank');
    }, 2000);
  };

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] overflow-hidden">
      <TopNavBar
        documentTitle="Untitled Document"
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onMenuToggle={() => setShowFileTree(!showFileTree)}
        onSave={handleSave}
        onCompile={handleCompile}
        onAIToggle={() => setShowAI(!showAI)}
        isSaving={isSaving}
        isCompiling={isCompiling}
      />

      <div className="flex-1 relative overflow-hidden">
        <FileTree
          isOpen={showFileTree}
          onClose={() => setShowFileTree(false)}
          onNewFile={() => console.log('New file')}
        />

        <div className="h-full flex">
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} border-r border-[#3e3e3e]`}>
              <MonacoEditorWrapper
                value={code}
                onChange={setCode}
                fileName="main.tex"
              />
            </div>
          )}

          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <PDFPreview
                pdfUrl={pdfUrl}
                isLoading={isCompiling}
                onCompile={handleCompile}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}