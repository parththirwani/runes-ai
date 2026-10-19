"use client";

import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';

interface MonacoEditorWrapperProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  fileName?: string;
  readOnly?: boolean;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => void;
  autocompleteEnabled?: boolean;
}

// LaTeX Monarch tokenizer definition
const latexLanguageDef = {
  defaultToken: 'invalid',
  tokenPostfix: '.latex',

  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
  ],

  keywords: [
    'documentclass', 'usepackage', 'begin', 'end', 'usepackage',
    'document', 'section', 'subsection', 'subsubsection', 'paragraph',
    'title', 'author', 'date', 'maketitle', 'tableofcontents',
    'label', 'ref', 'pageref', 'cite', 'bibitem', 'bibliography',
    'input', 'include', 'includegraphics',
    'textbf', 'textit', 'emph', 'underline', 'texttt',
    'textsc', 'textsf', 'textrm', 'textmd', 'textup',
    'itemize', 'enumerate', 'description', 'item',
    'figure', 'table', 'tabular', 'array',
    'equation', 'align', 'gather', 'split', 'cases',
    'caption', 'centering',
    'newpage', 'clearpage', 'newline', 'quad', 'qquad',
    'hline', 'vspace', 'hspace', 'bigskip', 'medskip', 'smallskip',
    'frac', 'sqrt', 'sum', 'int', 'prod', 'lim',
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta',
    'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
    'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau',
    'upsilon', 'phi', 'chi', 'psi', 'omega',
    'infty', 'partial', 'nabla', 'cdot', 'times', 'div',
    'left', 'right', 'big', 'bigg', 'Big', 'Bigg',
  ] as string[],

  typeKeywords: [] as string[],

  escapes: /\\(?:[a-zA-Z]+|.)/,

  tokenizer: {
    root: [
      [/\\begin\{/, { token: 'keyword', next: '@inEnvironment' }],
      [/\\end\{/, { token: 'keyword', next: '@inEnvironment' }],

      [/\\[a-zA-Z]+/, {
        cases: {
          '@keywords': 'keyword',
          '@default': 'tag',
        },
      }],

      [/%.*$/, 'comment'],

      [/\$\$/, 'string', '@displayMath'],
      [/\$/, 'string', '@inlineMath'],
      [/\\\(/, 'string', '@inlineMathParen'],
      [/\\\[/, 'string', '@displayMathBracket'],

      [/[{}()[\]]/, '@brackets'],

      [/[a-zA-Z0-9_]+/, 'identifier'],
      [/[^\s{}[\]()$\\%]+/, 'identifier'],
    ],

    inEnvironment: [
      [/[a-zA-Z*]+/, 'keyword'],
      [/}/, 'delimiter.curly', '@pop'],
    ],

    inComment: [
      [/\n/, '', '@pop'],
      [/./, 'comment'],
    ],

    inlineMath: [
      [/\$(?!\w)/, { token: 'string', next: '@pop' }],
      [/[^$\\]+/, 'string'],
      [/\\./, 'string.escape'],
    ],

    displayMath: [
      [/\$\$/, { token: 'string', next: '@pop' }],
      [/[^$\\]+/, 'string'],
      [/\\./, 'string.escape'],
    ],

    inlineMathParen: [
      [/\\\)/, { token: 'string', next: '@pop' }],
      [/[^\\]+/, 'string'],
      [/\\./, 'string.escape'],
    ],

    displayMathBracket: [
      [/\\\]/, { token: 'string', next: '@pop' }],
      [/[^\\]+/, 'string'],
      [/\\./, 'string.escape'],
    ],
  },
};

// Completion item provider for LaTeX commands
function createLatexCompletionProvider(monaco: typeof import('monaco-editor')) {
  const latexCompletions = [
    { label: '\\begin{document}', insertText: '\\begin{document}\n\n\\end{document}', kind: monaco.languages.CompletionItemKind.Snippet },
    { label: '\\section{}', insertText: '\\section{${1:title}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\subsection{}', insertText: '\\subsection{${1:title}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{itemize}', insertText: '\\begin{itemize}\n  \\item ${1:item}\n\\end{itemize}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{enumerate}', insertText: '\\begin{enumerate}\n  \\item ${1:item}\n\\end{enumerate}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{equation}', insertText: '\\begin{equation}\n  ${1:content}\n\\end{equation}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{align}', insertText: '\\begin{align}\n  ${1:content}\n\\end{align}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\textbf{}', insertText: '\\textbf{${1:text}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\textit{}', insertText: '\\textit{${1:text}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\emph{}', insertText: '\\emph{${1:text}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\cite{}', insertText: '\\cite{${1:key}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\ref{}', insertText: '\\ref{${1:label}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\label{}', insertText: '\\label{${1:label}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\includegraphics', insertText: '\\includegraphics{${1:file}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\frac{}{}', insertText: '\\frac{${1:num}}{${2:den}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{figure}', insertText: '\\begin{figure}[${1:htbp}]\n  \\centering\n  ${2:content}\n  \\caption{${3:caption}}\n  \\label{${4:fig:label}}\n\\end{figure}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{table}', insertText: '\\begin{table}[${1:htbp}]\n  \\centering\n  ${2:content}\n  \\caption{${3:caption}}\n  \\label{${4:tab:label}}\n\\end{table}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\begin{tabular}', insertText: '\\begin{tabular}{${1:cols}}\n  ${2:content}\n\\end{tabular}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\documentclass{}', insertText: '\\documentclass{${1:article}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
    { label: '\\usepackage{}', insertText: '\\usepackage{${1:package}}', kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet },
  ];

  return monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: latexCompletions.map((c) => ({
          ...c,
          range,
          kind: c.kind || monaco.languages.CompletionItemKind.Snippet,
        })),
      };
    },
  });
}

export default function MonacoEditorWrapper({
  value,
  onChange,
  language = 'latex',
  fileName = 'main.tex',
  readOnly = false,
  onEditorReady,
}: MonacoEditorWrapperProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional SSR guard: this runs once on mount to ensure Monaco renders client-side only
    setIsMounted(true);
  }, []);

  const handleEditorDidMount: OnMount = useCallback((editorInstance, monaco) => {
    editorRef.current = editorInstance;
    monacoRef.current = monaco;

    // Register LaTeX language if not already registered
    if (!monaco.languages.getEncodedLanguageId('latex')) {
      monaco.languages.register({ id: 'latex' });
      monaco.languages.setMonarchTokensProvider('latex', latexLanguageDef as unknown as languages.IMonarchLanguage);
      monaco.languages.setLanguageConfiguration('latex', {
        brackets: [
          ['{', '}'],
          ['[', ']'],
          ['(', ')'],
        ],
        autoClosingPairs: [
          { open: '{', close: '}' },
          { open: '[', close: ']' },
          { open: '(', close: ')' },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
      });
    }

    // Register snippet completion provider
    createLatexCompletionProvider(monaco);

    if (onEditorReady) {
      onEditorReady(editorInstance, monaco);
    }
  }, [onEditorReady]);

  const handleChange: OnChange = useCallback((newValue) => {
    if (newValue !== undefined && newValue !== null) {
      onChange(newValue);
    }
  }, [onChange]);

  if (!isMounted) {
    // SSR-safe placeholder
    return (
      <div className="h-full w-full bg-[#1e1e1e] text-gray-400 flex items-center justify-center text-sm">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={handleChange}
        theme="vs-dark"
        path={fileName}
        options={{
          readOnly,
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          automaticLayout: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          smoothScrolling: true,
          padding: { top: 12 },
          bracketPairColorization: { enabled: true },
          matchBrackets: 'always',
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          formatOnPaste: true,
          suggestOnTriggerCharacters: true,
          quickSuggestions: false,
          folding: true,
          foldingHighlight: true,
          renderLineHighlight: 'all',
          selectionHighlight: true,
          occurrencesHighlight: 'singleFile',
          renderWhitespace: 'selection',
          extraEditorClassName: 'latex-editor',
          'semanticHighlighting.enabled': true,
        }}
        onMount={handleEditorDidMount}
        loading={
          <div className="h-full w-full bg-[#1e1e1e] text-gray-400 flex items-center justify-center text-sm">
            Initializing editor...
          </div>
        }
      />
    </div>
  );
}

// Export helpers for use by DocumentEditor
export function getEditorApi() {
  return {
    getEditor: () => null as editor.IStandaloneCodeEditor | null,
    getMonaco: () => null as typeof import('monaco-editor') | null,
  };
}