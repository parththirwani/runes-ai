import React, { useEffect, useRef, useState } from 'react';
import Modal from '../design/Modal';
import Button from '../design/Button';
import type { DocumentFormatValue } from '@/src/types/compilation';

interface CreateDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (title: string, format: DocumentFormatValue) => void;
  isLoading?: boolean;
  existingTitles: string[];
  initialFormat?: DocumentFormatValue;
}

const FORMAT_CHOICES: { id: DocumentFormatValue; name: string; caption: string; hint: string }[] = [
  {
    id: 'MARKDOWN',
    name: 'Markdown',
    caption: 'Markdown, source, reading preview and PDF',
    hint: 'Write plain Markdown with a live rendered reading preview, then compile a PDF.',
  },
  {
    id: 'LATEX',
    name: 'LaTeX',
    caption: 'LaTeX, source and PDF',
    hint: 'Write TeX source and compile it to PDF with Tectonic.',
  },
];

export default function CreateDocumentModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
  existingTitles,
  initialFormat = 'MARKDOWN',
}: CreateDocumentModalProps) {
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<DocumentFormatValue>(initialFormat);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTitle('');
      setFormat(initialFormat);
      setError(null);
    }
  }

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSubmit = () => {
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setError('Title must be at least 3 characters');
      return;
    }
    if (trimmed.length > 30) {
      setError('Title cannot be longer than 30 characters');
      return;
    }
    if (existingTitles.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      setError('A document with this name already exists');
      return;
    }
    // The chosen format is sent explicitly with the create request.
    onSubmit(trimmed, format);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create document"
      description="Choose a name and a format. The format sets up the right editor and PDF pipeline."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={isLoading}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="new-document-title" className="mb-1 block text-sm font-medium text-foreground">
            Title
          </label>
          <input
            ref={inputRef}
            id="new-document-title"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="e.g., Research Paper, Notes, Report..."
            maxLength={30}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'new-document-title-error' : undefined}
            className={`w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-meta focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors ${
              error ? 'border-destructive' : 'border-border focus-visible:border-primary'
            }`}
          />
          <div className="flex items-center justify-between mt-2">
            {error ? (
              <p id="new-document-title-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : (
              <div />
            )}
            <p className="font-mono text-xs text-meta">{title.length}/30</p>
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">Format</legend>
          <div role="radiogroup" aria-label="Document format" className="space-y-2">
            {FORMAT_CHOICES.map((choice) => {
              const selected = format === choice.id;
              return (
                <label
                  key={choice.id}
                  className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
                    selected
                      ? 'border-primary bg-primary-subtle'
                      : 'border-border bg-surface-raised/40 hover:border-primary-border'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="document-format"
                      value={choice.id}
                      checked={selected}
                      onChange={() => setFormat(choice.id)}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        {choice.name}
                        <span className="ml-2 rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          .{choice.id === 'MARKDOWN' ? 'md' : 'tex'}
                        </span>
                      </span>
                      <span className="sr-only">{choice.caption}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{choice.hint}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
