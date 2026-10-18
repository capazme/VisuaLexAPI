import { formatDecisionShort, identityFromKey } from '../../../utils/decisionLinks';

/** What an annotation's `normaKey` is called to the user: a decision by its short citation, a norm by its key spelled out. */
export function annotationTargetLabel(normaKey: string): string {
  const identity = identityFromKey(normaKey);
  return identity ? formatDecisionShort(identity) : normaKey.replace(/--/g, ' ').replace(/-/g, ' ');
}
