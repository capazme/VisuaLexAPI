import { create } from 'zustand';

/**
 * The switch `lingo_courses` (spec 2026-10-23 §10.10), as `GET /api/features` says it (`lingoCourses`): read with
 * `assistantPassages` in the one features read (`loadAssistantFeatures`), as the app starts, at login, as «Percorsi»
 * mounts and when the browser is back online with it never read. `unknown` until the first answer, so a page never says
 * «not available» before the server has; a failed read keeps what was known. Off, nothing of the courses is drawn (the
 * sidebar's entry, «Oggi»'s row, the pages), and a 404 on the list turns it off.
 */
export type CoursesSwitch = 'unknown' | 'on' | 'off';

export const coursesSwitchStore = create<{ state: CoursesSwitch }>()(() => ({ state: 'unknown' }));

export function setCoursesSwitch(on: boolean): void {
  coursesSwitchStore.setState({ state: on ? 'on' : 'off' });
}

/** At logout: the next account's answer is read again. */
export function resetCoursesSwitch(): void {
  coursesSwitchStore.setState({ state: 'unknown' });
}

export const useCoursesSwitch = (): CoursesSwitch => coursesSwitchStore((s) => s.state);
