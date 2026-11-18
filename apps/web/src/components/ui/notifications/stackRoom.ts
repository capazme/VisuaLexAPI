import { create } from 'zustand';

/**
 * The room the bottom stack of notifications takes over the window's foot (px from its top to the window's bottom; 0
 * with none), which the page keeps free under its content while they show, so no row stays under them (LC85). A store,
 * as `footBar.ts`, not a custom property on the root.
 */
export const stackRoomStore = create<{ room: number }>(() => ({ room: 0 }));
