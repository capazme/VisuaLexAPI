import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  variant: 'dossier' | 'history' | 'environment' | 'search' | 'bookmarks' | 'generic';
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

// SVG Illustrations for each variant
function DossierIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Folder back */}
      <path
        d="M20 35C20 31.134 23.134 28 27 28H45L52 38H93C96.866 38 100 41.134 100 45V85C100 88.866 96.866 92 93 92H27C23.134 92 20 88.866 20 85V35Z"
        className="fill-slate-200 dark:fill-slate-700"
      />
      {/* Folder front */}
      <path
        d="M15 42C15 38.134 18.134 35 22 35H98C101.866 35 105 38.134 105 42V88C105 91.866 101.866 95 98 95H22C18.134 95 15 91.866 15 88V42Z"
        className="fill-slate-100 dark:fill-slate-800"
      />
      {/* Document lines */}
      <rect x="30" y="52" width="40" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <rect x="30" y="62" width="55" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <rect x="30" y="72" width="35" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      {/* Plus icon */}
      <circle cx="85" cy="80" r="15" className="fill-blue-500" />
      <path d="M85 73V87M78 80H92" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Clock face */}
      <circle cx="60" cy="60" r="45" className="fill-slate-100 dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700" strokeWidth="4" />
      <circle cx="60" cy="60" r="38" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" />
      {/* Clock marks */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((angle) => (
        <line
          key={angle}
          x1="60"
          y1="25"
          x2="60"
          y2="30"
          className="stroke-slate-400 dark:stroke-slate-500"
          strokeWidth="2"
          strokeLinecap="round"
          transform={`rotate(${angle} 60 60)`}
        />
      ))}
      {/* Clock hands */}
      <line x1="60" y1="60" x2="60" y2="35" className="stroke-slate-600 dark:stroke-slate-300" strokeWidth="3" strokeLinecap="round" />
      <line x1="60" y1="60" x2="78" y2="60" className="stroke-blue-500" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="60" r="4" className="fill-blue-500" />
      {/* Search sparkle */}
      <path d="M95 25L97 30L102 28L97 32L99 37L95 33L91 37L93 32L88 28L93 30L95 25Z" className="fill-amber-400" />
    </svg>
  );
}

function EnvironmentIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Globe */}
      <circle cx="60" cy="60" r="40" className="fill-slate-100 dark:fill-slate-800 stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" />
      {/* Latitude lines */}
      <ellipse cx="60" cy="45" rx="30" ry="8" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.5" fill="none" />
      <ellipse cx="60" cy="75" rx="30" ry="8" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.5" fill="none" />
      {/* Longitude line */}
      <ellipse cx="60" cy="60" rx="15" ry="40" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.5" fill="none" />
      {/* Center line */}
      <line x1="20" y1="60" x2="100" y2="60" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.5" />
      {/* Pin marker */}
      <path
        d="M75 40C75 48.284 67.5 58 67.5 58C67.5 58 60 48.284 60 40C60 31.716 63.358 25 67.5 25C71.642 25 75 31.716 75 40Z"
        className="fill-blue-500"
      />
      <circle cx="67.5" cy="38" r="4" className="fill-white" />
      {/* Connection lines */}
      <path d="M30 80L45 70M90 35L78 42" className="stroke-blue-400 stroke-dashed" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}

function SearchIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Document stack */}
      <rect x="30" y="35" width="50" height="65" rx="4" className="fill-slate-200 dark:fill-slate-700" />
      <rect x="25" y="30" width="50" height="65" rx="4" className="fill-slate-100 dark:fill-slate-800" />
      {/* Document lines */}
      <rect x="32" y="42" width="30" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <rect x="32" y="52" width="38" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <rect x="32" y="62" width="25" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      <rect x="32" y="72" width="35" height="4" rx="2" className="fill-slate-300 dark:fill-slate-600" />
      {/* Magnifying glass */}
      <circle cx="78" cy="70" r="18" className="fill-white dark:fill-slate-900 stroke-blue-500" strokeWidth="4" />
      <line x1="91" y1="83" x2="102" y2="94" className="stroke-blue-500" strokeWidth="5" strokeLinecap="round" />
      {/* Search highlight */}
      <circle cx="78" cy="70" r="8" className="fill-blue-100 dark:fill-blue-900/30" />
    </svg>
  );
}

function BookmarksIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Bookmark back */}
      <path
        d="M35 20H65V95L50 80L35 95V20Z"
        className="fill-slate-200 dark:fill-slate-700"
      />
      {/* Bookmark front */}
      <path
        d="M55 25H85V100L70 85L55 100V25Z"
        className="fill-slate-100 dark:fill-slate-800 stroke-slate-300 dark:stroke-slate-600"
        strokeWidth="2"
      />
      {/* Star */}
      <path
        d="M70 40L72.5 48H81L74.5 53L77 61L70 56L63 61L65.5 53L59 48H67.5L70 40Z"
        className="fill-amber-400"
      />
      {/* Small stars */}
      <circle cx="45" cy="35" r="2" className="fill-amber-300" />
      <circle cx="90" cy="50" r="1.5" className="fill-amber-300" />
      <circle cx="38" cy="55" r="1.5" className="fill-amber-300" />
    </svg>
  );
}

function GenericIllustration() {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Box */}
      <path
        d="M60 20L100 40V80L60 100L20 80V40L60 20Z"
        className="fill-slate-100 dark:fill-slate-800 stroke-slate-300 dark:stroke-slate-600"
        strokeWidth="2"
      />
      <path d="M60 20L60 100" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" />
      <path d="M20 40L60 60L100 40" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" />
      {/* Sparkle */}
      <path d="M85 25L87 30L92 28L87 32L89 37L85 33L81 37L83 32L78 28L83 30L85 25Z" className="fill-blue-400" />
    </svg>
  );
}

const illustrations = {
  dossier: DossierIllustration,
  history: HistoryIllustration,
  environment: EnvironmentIllustration,
  search: SearchIllustration,
  bookmarks: BookmarksIllustration,
  generic: GenericIllustration,
};

export function EmptyState({ variant, title, description, action, className }: EmptyStateProps) {
  const Illustration = illustrations[variant];

  return (
    <div className={cn('text-center py-12 md:py-16 px-4', className)}>
      {/* Illustration container */}
      <div className="w-28 h-28 md:w-32 md:h-32 mx-auto mb-6">
        <Illustration />
      </div>

      {/* Title */}
      <h3 className="text-lg md:text-xl font-semibold text-slate-900 dark:text-white mb-2">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-sm md:text-base text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
          {description}
        </p>
      )}

      {/* Action */}
      {action && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {action}
        </div>
      )}
    </div>
  );
}
