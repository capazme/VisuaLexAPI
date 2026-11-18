/* eslint-disable react-hooks/refs -- the harness reads the hook's state in render; it holds the root's ref, which is only read in its effects */
import { act, render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useState, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ISLAND_CLOSE, ISLAND_OPEN } from '../../../lib/motion';
import { useGlossMargin } from './useGlossMargin';

/** Every `animate` call, with a `finished` the test resolves. */
type Call = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void };
let calls: Call[] = [];

function fakeAnimate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    calls.push({ el: this, keyframes, options, finish });
    return { finished, cancel: vi.fn(), pause: vi.fn(), play: vi.fn() } as unknown as Animation;
}

function reducedMotion(on: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

/** A card (`data-glosses-room`, 704 px) in a frame of 1152: room to widen by the margin. */
function Harness({ open }: { open: boolean }) {
    // A plain ref object: the hook only reads `.current` in its effects.
    const [rootRef] = useState<RefObject<HTMLDivElement | null>>(() => ({ current: null }));
    const m = useGlossMargin({ open, rootRef, columnShown: false });
    return (
        <div data-testid="outer">
            <div data-glosses-room="" data-testid="room">
                <div ref={rootRef} data-glosses-beside={m.shown && m.placement === 'beside' ? '' : undefined}>
                    <div ref={m.setBelowSlot} />
                    {m.placement === 'beside' && <div ref={m.setBesideSlot} data-testid="beside" hidden={!m.shown} />}
                </div>
            </div>
            {m.host && createPortal(m.shown ? <section><div data-gloss-row="">a</div><div data-gloss-row="">b</div><div data-gloss-row="">c</div></section> : null, m.host)}
            <output data-testid="state">{`${m.placement} ${m.shown}`}</output>
        </div>
    );
}

beforeEach(() => {
    calls = [];
    Element.prototype.animate = fakeAnimate as unknown as Element['animate'];
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === 'outer' ? 1152 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const wide = this.dataset.testid === 'room' && this.querySelector('[data-glosses-beside]');
        const width = this.dataset.testid === 'room' ? (wide ? 1068 : 704) : 678;
        return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 100, width, height: 100, toJSON: () => ({}) } as DOMRect;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (Element.prototype as Partial<Element>).animate;
});

const state = (c: HTMLElement) => c.querySelector('[data-testid="state"]')!.textContent;

describe('useGlossMargin (LC74)', () => {
    it('opening beside: the card widens and the margin is uncovered on the island\'s opening, then the rows, 30 ms apart, faded and 8 px low', () => {
        reducedMotion(false);
        const { container, rerender } = render(<Harness open={false} />);
        expect(state(container)).toBe('beside false');
        rerender(<Harness open />);
        expect(state(container)).toBe('beside true');
        const room = calls.find((c) => c.el === container.querySelector('[data-testid="room"]'))!;
        expect(room.keyframes).toEqual([{ maxWidth: '704px' }, { maxWidth: '1068px' }]);
        expect(room.options).toMatchObject({ duration: ISLAND_OPEN.duration, easing: ISLAND_OPEN.easing });
        const clip = calls.find((c) => c.el === container.querySelector('[data-testid="beside"]'))!;
        expect(clip.keyframes[0]).toEqual({ clipPath: expect.stringMatching(/^inset\(0px 364px 0px 0px\)$/) });
        const rows = calls.filter((c) => (c.el as HTMLElement).hasAttribute('data-gloss-row'));
        expect(rows.map((r) => r.options.delay)).toEqual([80, 110, 140]);
        expect(rows[0].keyframes[0]).toEqual({ opacity: 0, transform: 'translateY(8px)' });
    });

    it('closing: the rows fade and the card narrows back on the island\'s closing; drawn until it ends', async () => {
        reducedMotion(false);
        const { container, rerender } = render(<Harness open={false} />);
        rerender(<Harness open />);
        calls = [];
        rerender(<Harness open={false} />);
        expect(state(container)).toBe('beside true');
        expect(calls.every((c) => c.options.duration === ISLAND_CLOSE.duration && c.options.easing === ISLAND_CLOSE.easing)).toBe(true);
        const room = calls.find((c) => c.el === container.querySelector('[data-testid="room"]'))!;
        expect(room.keyframes.at(-1)).toEqual({ maxWidth: '704px' });
        await act(async () => { calls.forEach((c) => c.finish()); });
        expect(state(container)).toBe('beside false');
    });

    it('under reduced motion, only the fade: nothing widens, nothing moves', () => {
        reducedMotion(true);
        const { container, rerender } = render(<Harness open={false} />);
        rerender(<Harness open />);
        expect(calls.length).toBeGreaterThan(0);
        for (const c of calls) {
            expect(Object.keys(c.keyframes[0]).sort()).toEqual(['opacity', 'transform']);
            expect(c.keyframes.every((k) => k.transform === undefined || k.transform === 'none')).toBe(true);
        }
        expect(container.querySelector('[data-glosses-beside]')).not.toBeNull();
    });
});
