import { create } from 'zustand';

/**
 * The room a bar held at the foot of the window takes there (its height and its gap to the edge, in px; 0 with none),
 * over which the notifications' bottom stack rises: «Sposta l'evidenziazione» (`MoveProposalBar`). Held here, not as a
 * custom property on the root: rewriting the root's style while a notification animated crashed Chromium's page.
 */
export const footBarStore = create<{ room: number }>(() => ({ room: 0 }));

export const setFootBarRoom = (room: number) => footBarStore.setState({ room });
