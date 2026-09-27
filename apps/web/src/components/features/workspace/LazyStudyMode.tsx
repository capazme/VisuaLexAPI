import { lazy, Suspense, type ComponentProps } from 'react';

const StudyMode = lazy(() => import('./StudyMode').then((module) => ({ default: module.StudyMode })));

type LazyStudyModeProps = ComponentProps<typeof StudyMode>;

export function LazyStudyMode(props: LazyStudyModeProps) {
  return (
    <Suspense fallback={null}>
      <StudyMode {...props} />
    </Suspense>
  );
}
