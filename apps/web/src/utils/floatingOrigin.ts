/**
 * Translate a floating-ui placement into the CSS transform-origin that
 * corresponds to the edge of the popover touching the reference — so
 * the scale-in animation grows FROM the anchor instead of from the
 * popover's geometric center (which otherwise reads as "dropping from
 * above" because the popover's centre is far from the toolbar button).
 */
export function getTransformOrigin(placement: string): string {
    const [side, align] = placement.split('-') as [string, string | undefined];
    const opposite: Record<string, string> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
    const main = opposite[side] ?? 'center';
    const crossAxisIsHorizontal = side === 'top' || side === 'bottom';
    const cross = !align
        ? 'center'
        : crossAxisIsHorizontal
            ? (align === 'start' ? 'left' : 'right')
            : (align === 'start' ? 'top' : 'bottom');
    return crossAxisIsHorizontal ? `${cross} ${main}` : `${main} ${cross}`;
}
