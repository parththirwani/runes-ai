// src/app/components/ui/ConfirmModal.tsx
import React from 'react';
import Modal from './Modal';
import Button from './Button';
import { AlertTriangle, Trash2, Info } from 'lucide-react';

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
  const icons = {
    danger: <Trash2 className="w-6 h-6 text-red-600" />,
    warning: <AlertTriangle className="w-6 h-6 text-yellow-600" />,
    info: <Info className="w-6 h-6 text-blue-600" />
  };

  const iconBgColors = {
    danger: 'bg-red-100',
    warning: 'bg-yellow-100',
    info: 'bg-blue-100'
  };

  // Map modal variants to button variants
  const buttonVariants: Record<typeof variant, 'danger' | 'secondary' | 'primary'> = {
    danger: 'danger',
    warning: 'secondary',
    info: 'primary'
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
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
            variant={buttonVariants[variant]}
            onClick={onConfirm}
            loading={isLoading}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className={`shrink-0 w-12 h-12 rounded-full ${iconBgColors[variant]} flex items-center justify-center`}>
          {icons[variant]}
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-600">
            {message}
          </p>
        </div>
      </div>
    </Modal>
  );
}