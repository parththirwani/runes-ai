import React from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

const icons = {
  danger: TriangleAlert,
  warning: TriangleAlert,
  info: Info
};

const iconColors = {
  danger: 'bg-destructive-subtle text-destructive',
  warning: 'bg-warning-subtle text-warning',
  info: 'bg-primary-subtle text-primary'
};

const confirmVariants: Record<ConfirmModalProps['variant'] & string, 'danger' | 'secondary' | 'primary'> = {
  danger: 'danger',
  warning: 'secondary',
  info: 'primary'
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false
}: ConfirmModalProps) {
  const Icon = icons[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button variant={confirmVariants[variant]} onClick={onConfirm} loading={isLoading}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md ${iconColors[variant]}`}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
      </div>
    </Modal>
  );
}
