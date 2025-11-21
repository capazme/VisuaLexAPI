import { useAppStore } from '../../../store/useAppStore';
import { FloatingPanel } from './FloatingPanel';
import type { ArticleData } from '../../../types';

interface FloatingPanelManagerProps {
  onViewPdf: (urn: string) => void;
  onCompareArticle: (article: ArticleData) => void;
  onCrossReference: (articleNumber: string, normaData: ArticleData['norma_data']) => void;
}

export function FloatingPanelManager({
  onViewPdf,
  onCompareArticle,
  onCrossReference
}: FloatingPanelManagerProps) {
  const { floatingPanels } = useAppStore();

  // Sort panels by zIndex to ensure proper stacking order
  const sortedPanels = [...floatingPanels].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
      {sortedPanels.map(panel => (
        <FloatingPanel
          key={panel.id}
          panel={panel}
          onViewPdf={onViewPdf}
          onCompareArticle={onCompareArticle}
          onCrossReference={onCrossReference}
        />
      ))}
    </>
  );
}
