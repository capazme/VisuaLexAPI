import { HubAction } from './HubCard';
import { gateLabel, type ConsentGate } from './hubStyles';

/** A card's action when it needs more consent than the user gave: its words, or none while the consent is read. */
export function gatedAction(gate: ConsentGate, needed: 'base' | 'completo') {
  const label = gateLabel(gate, needed);
  return label ? <HubAction gated={label} /> : undefined;
}
