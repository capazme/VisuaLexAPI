import { ArticleMerltSlot } from '../features/merlt/ArticleMerltSlot';
import { GlobalMerltSlot } from '../features/merlt/GlobalMerltSlot';
import { ArticleGraphSideRail } from '../features/merlt/graph/side-rail/ArticleGraphSideRail';
import type { PluginSlotName, SlotComponent } from './types';

/**
 * Static slot registry for Slice 1.
 *
 * Future stories (Slice 2-3) may register additional slots here for Q&A
 * panels, graph viewer, admin pages, etc. For Slice 1 the registry only
 * mounts the MERL-T tracker via `article_content_after`.
 */
// Cast individual components to the generic slot signature. Slots accept
// `Record<string, unknown>` props at the registry boundary; the host
// passes typed props at the call site (see <PluginSlot ... props={{...}}>),
// and each slot component knows its own real prop shape.
const slotComponents: SlotComponent<Record<string, unknown>>[] = [
    {
        id: 'merlt-article-tracker',
        pluginId: 'visualex-merlt',
        slot: 'article_content_after',
        component: ArticleMerltSlot as unknown as React.ComponentType<Record<string, unknown>>,
        requiredFlag: 'VITE_FEATURE_MERLT',
    },
    {
        id: 'merlt-global-tracker',
        pluginId: 'visualex-merlt',
        slot: 'global',
        component: GlobalMerltSlot as unknown as React.ComponentType<Record<string, unknown>>,
        requiredFlag: 'VITE_FEATURE_MERLT',
    },
    {
        id: 'merlt-article-graph-side-rail',
        pluginId: 'visualex-merlt',
        slot: 'article_sidebar',
        component: ArticleGraphSideRail as unknown as React.ComponentType<Record<string, unknown>>,
        requiredFlag: 'VITE_FEATURE_MERLT_GRAPH',
    },
];

/**
 * Check whether a Vite env flag is truthy. Vite injects flags as strings
 * ("true" / "false" / undefined). We accept the absence of the env var
 * as "feature enabled" so devs without a frontend/.env still get MERL-T
 * mounted by default; explicit "false" disables.
 */
function isFlagEnabled(flag: string | undefined): boolean {
    if (!flag) return true;
    const value = (import.meta.env as Record<string, string | undefined>)[flag];
    if (value === undefined) return true;
    return value !== 'false' && value !== '0' && value !== '';
}

export function getSlotComponents(slot: PluginSlotName): SlotComponent<Record<string, unknown>>[] {
    return slotComponents.filter(
        (entry) => entry.slot === slot && isFlagEnabled(entry.requiredFlag)
    );
}

// PluginSlot lives in ./PluginSlot.tsx — keeping it out of this module lets the
// registry export only data/functions (React Fast Refresh boundary). Re-export
// removed on purpose: import PluginSlot from './PluginSlot' directly.
