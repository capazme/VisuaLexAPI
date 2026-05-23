import { ArticleMerltSlot } from '../features/merlt/ArticleMerltSlot';
import { GlobalMerltSlot } from '../features/merlt/GlobalMerltSlot';
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

/**
 * PluginSlot renders every component registered for the given slot.
 * Components receive `props` verbatim. If no plugin matches (or the
 * feature flag is off), the slot collapses to null.
 */
export function PluginSlot<P extends Record<string, unknown>>({
    slot,
    props,
}: {
    slot: PluginSlotName;
    props: P;
}) {
    const components = getSlotComponents(slot);
    if (components.length === 0) return null;

    return (
        <>
            {components.map(({ id, component: Component }) => (
                <Component key={id} {...(props as Record<string, unknown>)} />
            ))}
        </>
    );
}
