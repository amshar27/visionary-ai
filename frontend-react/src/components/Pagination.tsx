import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  scrollTargetRef?: React.RefObject<HTMLElement | null>;
}

function buildPageList(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const set = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const nums = Array.from(set).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: (number | 'ellipsis')[] = [];
  for (let i = 0; i < nums.length; i++) {
    out.push(nums[i]);
    if (i < nums.length - 1 && nums[i + 1] - nums[i] > 1) out.push('ellipsis');
  }
  return out;
}

export default function Pagination({
  totalItems,
  itemsPerPage,
  currentPage,
  onPageChange,
  scrollTargetRef,
}: PaginationProps) {
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (scrollTargetRef?.current) {
      scrollTargetRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentPage, scrollTargetRef]);

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  if (totalItems <= itemsPerPage || totalPages <= 1) return null;

  const pages = buildPageList(currentPage, totalPages);
  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  const navBase = 'min-w-[36px] h-9 px-3 rounded-md text-sm font-medium transition-colors flex items-center justify-center';
  const navEnabled = 'text-gray-600 hover:bg-gray-100 cursor-pointer';
  const navDisabled = 'text-gray-300 cursor-not-allowed';

  return (
    <div className="flex items-center justify-center gap-2 mt-6 mb-2">
      <button
        type="button"
        onClick={() => { if (!prevDisabled) onPageChange(currentPage - 1); }}
        disabled={prevDisabled}
        className={`${navBase} ${prevDisabled ? navDisabled : navEnabled}`}
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>

      {pages.map((p, i) => {
        if (p === 'ellipsis') {
          return <span key={`e-${i}`} className="text-gray-400 px-1 select-none">…</span>;
        }
        const isActive = p === currentPage;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`min-w-[36px] h-9 px-3 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                : 'text-gray-600 hover:bg-gray-100 cursor-pointer'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            {p}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => { if (!nextDisabled) onPageChange(currentPage + 1); }}
        disabled={nextDisabled}
        className={`${navBase} ${nextDisabled ? navDisabled : navEnabled}`}
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
