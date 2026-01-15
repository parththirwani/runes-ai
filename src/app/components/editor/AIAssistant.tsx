// src/app/components/editor/AIAssistant.tsx
import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles, Send, Lightbulb, Code, FileText, Wand2 } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onSuggestionApply?: (suggestion: string) => void;
}

const QuickActions = ({ onAction }: { onAction: (prompt: string) => void }) => {
  const actions = [
    { icon: <Code />, label: 'Fix LaTeX errors', prompt: 'Can you help me fix any LaTeX errors in my document?' },
    { icon: <FileText />, label: 'Format document', prompt: 'Help me format this document properly' },
    { icon: <Lightbulb />, label: 'Improve writing', prompt: 'Suggest improvements for my writing' },
    { icon: <Wand2 />, label: 'Add section', prompt: 'Help me add a new section' }
  ];

  return (
    <div className="grid grid-cols-2 gap-2 p-4 border-b border-gray-200">
      {actions.map((action, idx) => (
        <button
          key={idx}
          onClick={() => onAction(action.prompt)}
          className="flex items-center gap-2 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-left"
        >
          <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center shrink-0">
            {React.cloneElement(action.icon, { className: 'w-4 h-4' })}
          </div>
          <span className="text-xs text-gray-700 font-medium">{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default function AIAssistant({
  isOpen,
  onClose,
  onSuggestionApply
}: AIAssistantProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hi! I\'m your AI LaTeX assistant. I can help you with:\n\n• Writing and fixing LaTeX code\n• Formatting documents\n• Explaining LaTeX commands\n• Suggesting improvements\n\nHow can I help you today?',
      timestamp: new Date()
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I can help you with that! Here\'s a suggestion for your LaTeX document...',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <div
      className={`absolute top-0 right-0 bottom-0 w-96 bg-white border-l border-gray-200 transform transition-transform duration-300 z-20 flex flex-col ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="h-14 border-b border-gray-200 flex items-center justify-between px-4 bg-linear-to-r from-purple-50 to-blue-50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-linear-to-r from-purple-600 to-blue-600 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-sm">AI Assistant</h3>
            <p className="text-xs text-gray-500">Powered by Claude</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Actions */}
      {messages.length === 1 && <QuickActions onAction={handleSend} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-linear-to-r from-emerald-600 to-emerald-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {msg.content}
              </p>
              <span className="text-xs opacity-70 mt-2 block">
                {msg.timestamp.toLocaleTimeString([], { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </span>
            </div>
          </div>
        ))}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask me anything about LaTeX..."
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
          <Button
            variant="primary"
            size="md"
            icon={<Send className="w-4 h-4" />}
            onClick={() => handleSend()}
            disabled={!input.trim() || isTyping}
          />
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }
      `}</style>
    </div>
  );
}