import { CircleCheck, Info, TriangleAlert, XCircle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  buttonText?: string;
}

const icons = {
  success: CircleCheck,
  error: XCircle,
  warning: TriangleAlert,
  info: Info
};

const iconColors = {
  success: 'bg-success-subtle text-success',
  error: 'bg-destructive-subtle text-destructive',
  warning: 'bg-warning-subtle text-warning',
  info: 'bg-primary-subtle text-primary'
};

const buttonVariants = {
  success: 'primary' as const,
  error: 'danger' as const,
  warning: 'secondary' as const,
  info: 'primary' as const
};

export default function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  variant = 'info',
  buttonText = 'Close'
}: AlertModalProps) {
  const Icon = icons[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <Button variant={buttonVariants[variant]} onClick={onClose}>
          {buttonText}
        </Button>
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
