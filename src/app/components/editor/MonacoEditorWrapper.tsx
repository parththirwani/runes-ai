"use client";

import React, { useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';

interface MonacoEditorWrapperProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  fileName?: string;
  readOnly?: boolean;
}

export default function MonacoEditorWrapper({
  value,
  onChange,
  language = 'latex',
  fileName = 'main.tex',
  readOnly = false
}: MonacoEditorWrapperProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.style.height = 'auto';
      editorRef.current.style.height = editorRef.current.scrollHeight + 'px';
    }
  }, [value]);

  // Line numbers
  const lineCount = value.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(lineCount, 30) }, (_, i) => i + 1);

  return (
    <div className="h-full w-full relative bg-[#1e1e1e] text-white overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 h-10 bg-[#2d2d2d] border-b border-[#3e3e3e] flex items-center px-4 text-xs text-gray-400 z-10">
        <FileText className="w-3.5 h-3.5 mr-2" />
        <span>{fileName}</span>
        <span className="ml-auto text-gray-500">{language.toUpperCase()}</span>
      </div>

      {/* Editor Container */}
      <div className="absolute top-10 left-0 right-0 bottom-0 flex">
        {/* Line Numbers */}
        <div className="w-14 bg-[#1e1e1e] border-r border-[#3e3e3e] flex flex-col items-end pr-3 pt-3 text-xs text-gray-600 font-mono select-none overflow-hidden">
          {lineNumbers.map((num) => (
            <div key={num} className="leading-6 h-6">
              {num}
            </div>
          ))}
        </div>

        {/* Editor Area */}
        <div className="flex-1 relative overflow-auto custom-scrollbar">
          <textarea
            ref={editorRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full min-h-full p-3 bg-transparent text-white font-mono text-sm resize-none focus:outline-none leading-6"
            style={{
              tabSize: 2,
              caretColor: '#fff'
            }}
            spellCheck={false}
            readOnly={readOnly}
            placeholder="Start typing your LaTeX code..."
          />
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1e1e1e;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #3e3e3e;
          border-radius: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4e4e4e;
        }
        .custom-scrollbar::-webkit-scrollbar-corner {
          background: #1e1e1e;
        }
      `}</style>
    </div>
  );
}