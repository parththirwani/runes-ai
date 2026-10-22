import React, { useState, useEffect, useRef, useId } from 'react';
import Modal from './Modal';
import Button from './Button';

interface InputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  /** Visible label for the field. Falls back to the dialog title. */
  label?: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  submitText?: string;
  cancelText?: string;
  isLoading?: boolean;
  maxLength?: number;
  validation?: (value: string) => string | null; // Returns error message or null
}

export default function InputModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  label,
  description,
  placeholder = '',
  defaultValue = '',
  submitText = 'Create',
  cancelText = 'Cancel',
  isLoading = false,
  maxLength = 30,
  validation
}: InputModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const inputId = `${uid}-input`;
  const errorId = `${uid}-error`;
  const counterId = `${uid}-counter`;

  useEffect(() => {
    if (!isOpen) return undefined;
    // Reset + autofocus run in the same deferred tick so the effect body
    // stays free of synchronous setState (React compiler guidance).
    const timer = setTimeout(() => {
      setValue(defaultValue);
      setError(null);
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen, defaultValue]);

  const handleSubmit = () => {
    const trimmedValue = value.trim();
    
    if (!trimmedValue) {
      setError('This field is required');
      return;
    }

    if (validation) {
      const validationError = validation(trimmedValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    onSubmit(trimmedValue);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={isLoading}
          >
            {submitText}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="space-y-2"
      >
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
            {label ?? title}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={placeholder}
            maxLength={maxLength}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${error ? errorId + ' ' : ''}${counterId}`}
            className={`mt-2 w-full rounded-lg border bg-background px-4 py-2.5 text-sm text-foreground transition-colors placeholder:text-meta focus:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 ${
              error ? 'border-destructive' : 'border-border'
            }`}
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <span />
          )}
          <p id={counterId} className="shrink-0 font-mono text-xs text-meta">
            {value.length}/{maxLength}
          </p>
        </div>
      </form>
    </Modal>
  );
}