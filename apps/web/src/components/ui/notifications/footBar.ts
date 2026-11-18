import { create } from 'zustand';

/**
 * The room a bar held at the foot of the window takes there (its height and its gap to the edge, in px; 0 with none),
 * over which the notifications' bottom stack rises: «Sposta l'evidenziazione» (`MoveProposalBar`). Held here, not as a
 * custom property on the root: rewriting the root's style while a notification animated crashed Chromium's page.
 */
export const footBarStore = create<{ room: number }>(() => ({ room: 0 }));

export const setFootBarRoom = (room: number) => footBarStore.setState({ room });

/**
 * Where the bottom notifications sit: 16 px over the window's foot, or over the bar held there (`--foot-bar`, its room,
 * set on the element from `footBarStore`); from `md` at least 32 px. One rule for the stack and for «Novità» (LC101).
 */
export const FOOT_STACK_BOTTOM = 'bottom-[calc(1rem+var(--foot-bar,0px))] md:bottom-[max(2rem,calc(1rem+var(--foot-bar,0px)))]';
