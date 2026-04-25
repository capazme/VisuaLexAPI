import type { ArticleData } from '../types';
import { ArticleMerltSlot } from '../features/merlt/ArticleMerltSlot';
import type { PluginSlotName, SlotComponent } from './types';

export interface ArticleContentAfterSlotProps {
    article: ArticleData;
    onToast?: (message: string, type?: 'success' | 'error') => void;
}

const slotComponents: SlotComponent<any>[] = [
    {
        id: 'merlt-article-content-after',
        pluginId: 'visualex-merlt',
        slot: 'article_content_after',
        component: ArticleMerltSlot,
        requiredFeature: 'merlt',
    },
];

export function getSlotComponents(slot: PluginSlotName): SlotComponent<any>[] {
    return slotComponents.filter(component => component.slot === slot);
}

export function PluginSlot<P extends Record<string, unknown>>({
    slot,
    props,
}: {
    slot: PluginSlotName;
    props: P;
}) {
    const components = getSlotComponents(slot);

    return (
        <>
            {components.map(({ id, component: Component }) => (
                <Component key={id} {...props} />
            ))}
        </>
    );
}
