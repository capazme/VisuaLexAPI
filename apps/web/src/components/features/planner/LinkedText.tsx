import { Fragment } from 'react';
import { splitLinks } from './splitLinks';

/** A task's description with its addresses as links, opened in a new tab. */
export function LinkedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitLinks(text).map((part, index) =>
        part.href ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary-700 underline underline-offset-2 hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-100"
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}
