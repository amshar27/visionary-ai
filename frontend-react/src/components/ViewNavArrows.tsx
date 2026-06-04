import { ArrowLeft, ArrowRight } from 'lucide-react';

interface ViewNavArrowsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/**
 * Browser-style back/forward arrow row for in-app sub-view history.
 * Sits directly below <AppHeader>. Arrows are bold blue when enabled and
 * blurred/greyed (non-interactive) when there is no history to move through.
 */
export default function ViewNavArrows({ canGoBack, canGoForward, onBack, onForward }: ViewNavArrowsProps) {
  const base = 'w-8 h-7 flex items-center justify-center rounded-lg transition-all duration-150 select-none';
  const enabled = 'text-blue-600 cursor-pointer hover:bg-blue-50';
  const disabled = 'text-blue-600 opacity-40 cursor-not-allowed';

  return (
    <div className="flex-none flex items-center gap-1 px-6 py-0.5 border-b border-gray-200">
      <button
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Go back"
        title="Back"
        className={`${base} ${canGoBack ? enabled : disabled}`}
      >
        <ArrowLeft size={18} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </button>
      <button
        onClick={onForward}
        disabled={!canGoForward}
        aria-label="Go forward"
        title="Forward"
        className={`${base} ${canGoForward ? enabled : disabled}`}
      >
        <ArrowRight size={18} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </button>
    </div>
  );
}
