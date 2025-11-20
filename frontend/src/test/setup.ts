import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock localStorage
const localStorageMock = {
  getItem: (key: string) => {
    return window.localStorage[key] || null
  },
  setItem: (key: string, value: string) => {
    window.localStorage[key] = value
  },
  removeItem: (key: string) => {
    delete window.localStorage[key]
  },
  clear: () => {
    window.localStorage = {}
  }
}

global.localStorage = localStorageMock as any
