/**
 * The geometry of a confirmation drawn from its button (K1b): a lead from the button to the card's outline, then the
 * outline drawn from that point both ways, the two ends meeting on the far side. Pure: rectangles in, SVG paths out.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Point = readonly [number, number];

/** Points per rounded corner: enough for a 16 px radius to read as a curve. */
const CORNER_STEPS = 8;

/** The card's outline clockwise (y down), from the top edge's left end, the corners as short runs of points. */
export function outlinePoints(card: Box, radius: number): Point[] {
  const r = Math.max(0, Math.min(radius, card.width / 2, card.height / 2));
  const { left: x, top: y, width: w, height: h } = card;
  const corner = (cx: number, cy: number, from: number): Point[] =>
    Array.from({ length: CORNER_STEPS }, (_, i) => {
      const angle = from + ((i + 1) / CORNER_STEPS) * (Math.PI / 2);
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
    });
  return [
    [x + r, y],
    [x + w - r, y],
    ...corner(x + w - r, y + r, -Math.PI / 2),
    [x + w, y + h - r],
    ...corner(x + w - r, y + h - r, 0),
    [x + r, y + h],
    ...corner(x + r, y + h - r, Math.PI / 2),
    [x, y + r],
    ...corner(x + r, y + r, Math.PI),
  ];
}

/** Where the lead meets the card: on the edge that faces the button, as close to it as the corners allow. */
export function attachPoint(card: Box, from: Point, radius: number): { point: Point; edge: 'top' | 'right' | 'bottom' | 'left' } {
  const r = Math.max(0, Math.min(radius, card.width / 2, card.height / 2));
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  const [fx, fy] = from;
  const right = card.left + card.width;
  const bottom = card.top + card.height;
  if (fy >= bottom) return { point: [clamp(fx, card.left + r, right - r), bottom], edge: 'bottom' };
  if (fy <= card.top) return { point: [clamp(fx, card.left + r, right - r), card.top], edge: 'top' };
  if (fx <= card.left) return { point: [card.left, clamp(fy, card.top + r, bottom - r)], edge: 'left' };
  if (fx >= right) return { point: [right, clamp(fy, card.top + r, bottom - r)], edge: 'right' };
  // A button under the card (it covers it): the nearer of top and bottom.
  return fy - card.top < bottom - fy
    ? { point: [clamp(fx, card.left + r, right - r), card.top], edge: 'top' }
    : { point: [clamp(fx, card.left + r, right - r), bottom], edge: 'bottom' };
}

/** The index in `outlinePoints` after which an attach point on `edge` sits. */
function insertAfter(points: Point[], edge: 'top' | 'right' | 'bottom' | 'left'): number {
  // The straight edges start at 0 (top), 1 + CORNER_STEPS (right), 2 + 2·CORNER_STEPS (bottom), 3 + 3·CORNER_STEPS (left).
  const starts = { top: 0, right: 1 + CORNER_STEPS, bottom: 2 + 2 * CORNER_STEPS, left: 3 + 3 * CORNER_STEPS };
  return starts[edge] % points.length;
}

const pathOf = (points: Point[]) => points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

export interface WirePaths {
  /** From the button to the card. */
  lead: string;
  /** The whole outline from the attach point, clockwise and the other way: each drawn to half its length. */
  clockwise: string;
  counter: string;
  /** Where the lead starts: the button's edge that faces the card. */
  start: Point;
  /** Where it meets the card. */
  attach: Point;
}

/** The three paths of the wire, from the button's box to the card's. */
export function wirePaths(button: Box, card: Box, radius: number): WirePaths {
  const centre: Point = [button.left + button.width / 2, button.top + button.height / 2];
  const { point: attach, edge } = attachPoint(card, centre, radius);
  // The lead leaves the button from its side that faces the card.
  // A button above the card leaves from its bottom; one the card covers (its centre inside it) from its top, the side
  // nearer the edge the wire meets.
  const covered = centre[1] > card.top && centre[1] < card.top + card.height && centre[0] > card.left && centre[0] < card.left + card.width;
  const start: Point =
    edge === 'bottom' ? [centre[0], button.top]
      : edge === 'top' ? [centre[0], covered ? button.top : button.top + button.height]
        : edge === 'left' ? [button.left + button.width, centre[1]]
          : [button.left, centre[1]];
  const points = outlinePoints(card, radius);
  const at = insertAfter(points, edge);
  const around = [...points.slice(at + 1), ...points.slice(0, at + 1)];
  const clockwise = [attach, ...around, attach];
  const counter = [...clockwise].reverse();
  return { lead: pathOf([start, attach]), clockwise: pathOf(clockwise), counter: pathOf(counter), start, attach };
}
