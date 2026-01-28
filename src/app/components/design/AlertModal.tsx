import Modal from './Modal';
import Button from './Button';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  buttonText?: string;
}

export default function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  variant = 'info',
  buttonText = 'OK'
}: AlertModalProps) {
  const icons = {
    success: <CheckCircle className="w-6 h-6 text-green-600" />,
    error: <XCircle className="w-6 h-6 text-red-600" />,
    warning: <AlertTriangle className="w-6 h-6 text-yellow-600" />,
    info: <Info className="w-6 h-6 text-blue-600" />
  };

  const iconBgColors = {
    success: 'bg-green-100',
    error: 'bg-red-100',
    warning: 'bg-yellow-100',
    info: 'bg-blue-100'
  };

  const buttonVariants = {
    success: 'primary' as const,
    error: 'danger' as const,
    warning: 'secondary' as const,
    info: 'primary' as const
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <Button
          variant={buttonVariants[variant]}
          onClick={onClose}
        >
          {buttonText}
        </Button>
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