import { describe, expect, it } from 'vitest'
import { notificationStore, notify } from '../components/ui/notifications/notifications'

// The global afterEach in setup.ts clears what a test left on screen, countdown included (LC136).
describe('setup: notifications between tests', () => {
  it('leaves a notification with its countdown running', () => {
    notify({ type: 'info', message: 'left behind', duration: 60000 })
    expect(notificationStore.getState().entries).toHaveLength(1)
  })

  it('starts the next test with none', () => {
    expect(notificationStore.getState().entries).toHaveLength(0)
  })
})
