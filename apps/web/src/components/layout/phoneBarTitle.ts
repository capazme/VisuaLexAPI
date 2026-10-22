import { pageName } from '../../features/sections/pageNames';

/**
 * The name in the middle of the phone's bar (M1): the page's name as the menu writes it, from the one list of the
 * pages' names (`features/sections/pageNames.ts`), which the pages' titles read too (L-37). A page the list does not
 * name takes the section's name. The search page has no title: its bar is the search field.
 */
export function phoneBarTitle(pathname: string, sectionName: string): string {
  return pageName(pathname) ?? sectionName;
}
