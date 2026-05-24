import type { ReactNode } from 'react';

interface AppHeaderProps {
  onLogoClick: () => void;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export default function AppHeader({ onLogoClick, leftSlot, rightSlot }: AppHeaderProps) {
  return (
    <header
      className="flex-none flex items-center gap-3 px-6 border-b border-gray-200 bg-white"
      style={{ height: 56 }}
    >
      {leftSlot}
      <button
        onClick={onLogoClick}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity duration-150"
        aria-label="Go to home"
      >
        <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
          <defs>
            <clipPath id="visionaryEyeClip">
              <path d="M2 16 Q 16 4, 30 16 Q 16 28, 2 16 Z" />
            </clipPath>
          </defs>
          <path
            d="M2 16 Q 16 4, 30 16 Q 16 28, 2 16 Z"
            fill="none"
            stroke="#1e40af"
            strokeWidth="2"
          />
          <circle cx="16" cy="16" r="6" fill="#2563eb" clipPath="url(#visionaryEyeClip)" />
          <circle cx="16" cy="16" r="2.5" fill="#0b1220" />
          <circle cx="17.5" cy="14.5" r="0.9" fill="white" />
        </svg>
        <span className="text-xl font-medium tracking-tight text-gray-900">
          Visionary <span className="text-blue-600">AI</span>
        </span>
      </button>
      <div className="flex-1" />
      {rightSlot}
    </header>
  );
}
