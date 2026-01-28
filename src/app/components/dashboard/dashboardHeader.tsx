import { Plus } from 'lucide-react';
import Image from 'next/image';
import Button from '../design/Button';

interface DashboardHeaderProps {
  onCreateDocument: () => void;
}

export default function DashboardHeader({ onCreateDocument }: DashboardHeaderProps) {
  return (
    <header className="border-b border-white/5 backdrop-blur-xl bg-[#2d2d2d] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <button className="flex gap-2 hover:opacity-80 transition-opacity cursor-pointer w-48">
            <Image
              src="/logo.png"
              alt="RunesAI Logo"
              width={200}
              height={32}
              className="object-contain"
            />
          </button>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={onCreateDocument}
            className="cursor-pointer"
          >
            New
          </Button>
        </div>
      </div>
    </header>
  );
}