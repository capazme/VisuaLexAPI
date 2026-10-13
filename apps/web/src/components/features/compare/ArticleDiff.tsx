import { useMemo } from 'react';
import { cn } from '../../../lib/utils';
import { diffSequences } from '../../../utils/articleCompare';

interface ArticleDiffProps {
  leftText: string;
  rightText: string;
  leftLabel: string;
  rightLabel: string;
}

interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/**
 * Word-level diff of two texts, whitespace kept as tokens of its own.
 */
function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  const result: DiffSegment[] = [];
  for (const op of diffSequences(oldWords, newWords)) {
    const text = op.type === 'insert' ? newWords[op.b!] : oldWords[op.a!];
    const last = result[result.length - 1];
    if (last && last.type === op.type) {
      last.text += text;
    } else {
      result.push({ type: op.type, text });
    }
  }
  return result;
}

function DiffWord({ segment }: { segment: DiffSegment }) {
  if (segment.type === 'equal') {
    return <span>{segment.text}</span>;
  }

  if (segment.type === 'delete') {
    return (
      <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 line-through px-0.5 rounded">
        {segment.text}
      </span>
    );
  }

  return (
    <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-0.5 rounded">
      {segment.text}
    </span>
  );
}

export function ArticleDiff({ leftText, rightText, leftLabel, rightLabel }: ArticleDiffProps) {
  const diff = useMemo(() => computeDiff(leftText, rightText), [leftText, rightText]);

  // Calculate statistics
  const stats = useMemo(() => {
    let deletions = 0;
    let insertions = 0;
    let unchanged = 0;

    for (const segment of diff) {
      const words = segment.text.trim().split(/\s+/).filter(Boolean).length;
      if (segment.type === 'delete') deletions += words;
      else if (segment.type === 'insert') insertions += words;
      else unchanged += words;
    }

    const total = deletions + insertions + unchanged;
    const similarity = total > 0 ? Math.round((unchanged / (unchanged + Math.max(deletions, insertions))) * 100) : 100;

    return { deletions, insertions, unchanged, similarity };
  }, [diff]);

  return (
    <div className="space-y-6">
      {/* Statistics */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Similarita:</span>
          <span className={cn(
            "text-sm font-bold px-2 py-0.5 rounded",
            stats.similarity >= 80
              ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
              : stats.similarity >= 50
              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
              : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
          )}>
            {stats.similarity}%
          </span>
        </div>
        <div className="h-4 w-px bg-slate-300 dark:bg-slate-600" />
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-red-200 dark:bg-red-900/50" />
            <span className="text-slate-600 dark:text-slate-400">
              {stats.deletions} rimoss{stats.deletions === 1 ? 'a' : 'e'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900/50" />
            <span className="text-slate-600 dark:text-slate-400">
              {stats.insertions} aggiunt{stats.insertions === 1 ? 'a' : 'e'}
            </span>
          </span>
        </div>
      </div>

      {/* Labels */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span className="font-medium text-slate-700 dark:text-slate-300 truncate">{leftLabel}</span>
        </div>
        <span className="text-slate-400">vs</span>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-emerald-500" />
          <span className="font-medium text-slate-700 dark:text-slate-300 truncate">{rightLabel}</span>
        </div>
      </div>

      {/* Diff Content */}
      <div className="p-6 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="prose prose-slate dark:prose-invert prose-sm max-w-none leading-relaxed">
          {diff.map((segment, index) => (
            <DiffWord key={index} segment={segment} />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 line-through rounded">testo</span>
          = Rimosso nel secondo articolo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded">testo</span>
          = Aggiunto nel secondo articolo
        </span>
      </div>
    </div>
  );
}
