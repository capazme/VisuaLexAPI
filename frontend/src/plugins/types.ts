/**
 * Plugin host slot taxonomy.
 *
 * Each slot name marks a stable extension point in the host application.
 * Plugins register components against a slot and the host renders all of
 * them at runtime (filtered by feature flag).
 *
 * Slice 1 only uses `article_content_after`; the others are placeholders
 * for Slice 2+ extension surfaces (graph viewer, admin, etc.).
 */
export type PluginSlotName =
    | 'article_toolbar'
    | 'article_sidebar'
    | 'content_overlay'
    | 'article_content_after'
    | 'graph_view'
    | 'profile_tabs'
    | 'admin_dashboard'
    | 'dossier_actions'
    | 'bulletin_community';

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
