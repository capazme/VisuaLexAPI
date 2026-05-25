import { getSlotComponents } from './registry';
import type { PluginSlotName } from './types';

/**
 * PluginSlot renders every component registered for the given slot.
 * Components receive `props` verbatim. If no plugin matches (or the
 * feature flag is off), the slot collapses to null.
 *
 * Kept in its own file (separate from registry.ts) so the registry module
 * exports only data/functions — required for React Fast Refresh, which wants
 * component and non-component exports to live in different modules.
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
