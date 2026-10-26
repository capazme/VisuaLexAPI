import { describe, expect, it } from 'vitest';
import { appStore } from '../useAppStore';

type AppState = ReturnType<typeof appStore.getState>;
const merge = (saved: unknown) =>
  (appStore.persist.getOptions() as unknown as { merge: (persisted: unknown, current: AppState) => AppState })
    .merge(JSON.parse(JSON.stringify(saved)), appStore.getState());

describe('persist: the colour of new highlights (H1), as a reload finds it', () => {
  it('keeps the one chosen', () => {
    expect(merge({ settings: { theme: 'dark', highlightColor: 'blue' } }).settings.highlightColor).toBe('blue');
  });

  it('is yellow for settings saved before it existed', () => {
    const settings = merge({ settings: { theme: 'dark', fontSize: 18 } }).settings;
    expect(settings.highlightColor).toBe('yellow');
    expect(settings.theme).toBe('dark');
  });

  it.each([['a colour this app does not draw', 'purple'], ['no colour', null], ['not a word', 3]])(
    'is yellow when the save holds %s',
    (_, saved) => {
      expect(merge({ settings: { highlightColor: saved } }).settings.highlightColor).toBe('yellow');
    },
  );
});
