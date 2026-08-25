import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock localStorage
const localStorageMock: Storage = {
  length: 0,
  getItem: (key: string) => {
    return (window.localStorage as Record<string, string>)[key] || null
  },
  setItem: (key: string, value: string) => {
    (window.localStorage as Record<string, string>)[key] = value
  },
  removeItem: (key: string) => {
    delete (window.localStorage as Record<string, string>)[key]
  },
  clear: () => {
    Object.keys(window.localStorage).forEach(key => delete (window.localStorage as Record<string, string>)[key])
  },
  key: (index: number) => {
    return Object.keys(window.localStorage)[index] || null
  }
}

global.localStorage = localStorageMock

// jsdom does not implement matchMedia. Several popover components (e.g.
// NotesPeekPanel, AddToDossierPopover) use it to switch between a
// desktop-anchored floating panel and a mobile bottom sheet — without this
// shim `window.matchMedia(...)` throws "is not a function" on mount.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom does not implement ResizeObserver either. @floating-ui/react's
// autoUpdate() observes the reference/floating elements for resizes; a
// no-op stub is enough for tests that only assert on render/interaction.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
