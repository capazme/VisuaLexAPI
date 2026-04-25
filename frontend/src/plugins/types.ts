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

export interface SlotComponent<P = Record<string, unknown>> {
    id: string;
    pluginId: string;
    slot: PluginSlotName;
    component: React.ComponentType<P>;
    requiredFeature?: string;
}
