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

describe('persist: the colours\' meanings, as a reload finds them', () => {
  it('keeps the user\'s own', () => {
    expect(merge({ settings: { highlightColorMeanings: { green: 'Termini e scadenze' } } }).settings.highlightColorMeanings)
      .toEqual({ green: 'Termini e scadenze' });
  });

  it('is none for settings saved before it existed', () => {
    expect(merge({ settings: { theme: 'dark', highlightColor: 'blue' } }).settings.highlightColorMeanings).toEqual({});
  });

  it('drops what is not a meaning of a colour this app draws', () => {
    expect(merge({ settings: { highlightColorMeanings: { purple: 'Viola', red: '', blue: 'x'.repeat(41), yellow: ' Tesi ' } } })
      .settings.highlightColorMeanings).toEqual({ yellow: 'Tesi' });
    expect(merge({ settings: { highlightColorMeanings: 'giallo' } }).settings.highlightColorMeanings).toEqual({});
  });

  it('is kept on the device with the other settings, and Impostazioni\'s opening is not', () => {
    const saved = (appStore.persist.getOptions() as unknown as { partialize: (s: AppState) => Record<string, unknown> })
      .partialize(appStore.getState());
    expect(saved.settings).toHaveProperty('highlightColorMeanings');
    expect(saved).not.toHaveProperty('settingsDialog');
  });
});
