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
