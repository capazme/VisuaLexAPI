/**
 * Plugin host slot taxonomy.
 *
 * Each slot name marks a stable extension point in the host application.
 * Plugins register components against a slot and the host renders all of
 * them at runtime (filtered by feature flag).
 *
 * Only the slots actually registered/mounted are declared here — no
 * speculative placeholders for future extension surfaces (add a slot when a
 * plugin is built for it, not before).
 */
export type PluginSlotName =
    | 'article_sidebar'
    | 'article_content_after'
    // 'global' is mounted once in Layout — used for app-wide side-effect
    // components (e.g. forum-signal tracker) that listen to the merltEventBus
    // independent of any specific article or page.
    | 'global';

/**
 * A slot registration entry.
 *
 * `requiredFlag` is an optional Vite env var name (e.g. `VITE_FEATURE_MERLT`).
 * When set, the registry skips the component if `import.meta.env[flag]` is
 * not truthy. This lets us toggle whole plugins without removing code.
 */
export interface SlotComponent<P extends Record<string, unknown> = Record<string, unknown>> {
    id: string;
    pluginId: string;
    slot: PluginSlotName;
    component: React.ComponentType<P>;
    requiredFlag?: string;
}
