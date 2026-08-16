/**
 * The 16px form-control floor, guarded at the source.
 *
 * WHY THIS TEST IS A STRING ASSERTION RATHER THAN A RENDER
 *
 * jsdom does not apply `index.css`, so no amount of rendering can measure a computed font size —
 * which is exactly why this defect survived: it was invisible to the whole unit suite and only
 * appeared when the app was opened at 375px with a coarse pointer and the controls were measured.
 * A string assertion over the stylesheet is weaker than a real measurement, and much stronger
 * than nothing.
 *
 * THE DEFECT IT GUARDS
 *
 * The floor was `input, select, textarea { font-size: 16px }` — element selectors, specificity
 * 0,0,1. Sprint 5.5 added `.field`, a class (0,1,0) applying `text-sm` = 13px. A class beats an
 * element regardless of source order, so `.field` silently defeated the floor on every phone from
 * the moment it shipped, and iOS Safari zooms the viewport when a focused control computes below
 * 16px and does not zoom back.
 *
 * The floor and Sprint 5's retuned type scale are one change — `text-base` is 14px, so removing
 * either alone breaks phones. That is why this asserts the floor EXISTS as well as that it wins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** The body of the `@media (pointer: coarse)` block that carries the floor. */
function coarsePointerBlock(): string {
    const start = css.lastIndexOf('@media (pointer: coarse)');
    expect(start, 'the coarse-pointer media block has been removed').toBeGreaterThan(-1);

    // Walk braces so a nested rule does not truncate the block.
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
            depth--;
            if (depth === 0) return css.slice(start, i + 1);
        }
    }
    throw new Error('unbalanced braces in index.css');
}

describe('the iOS zoom floor', () => {
    it('still exists', () => {
        expect(coarsePointerBlock()).toMatch(/font-size:\s*16px/);
    });

    it('floors bare form controls', () => {
        const block = coarsePointerBlock();
        for (const tag of ['input', 'select', 'textarea']) {
            expect(block).toMatch(new RegExp(`(^|[^.\\w])${tag}[,\\s]`, 'm'));
        }
    });

    /*
     * THE ASSERTION THAT WOULD HAVE CAUGHT THE BUG.
     *
     * `.field` sets 13px at class specificity. Without an equally-or-more specific selector in
     * this block, every control carrying it is below the floor on a phone — which was true in
     * production for the whole of Sprint 5.5.
     */
    it('floors controls carrying the .field class, which outranks a bare element selector', () => {
        const block = coarsePointerBlock();

        expect(
            block,
            '`.field` applies text-sm (13px) at class specificity and beats a bare `input` selector, '
            + 'so the floor must name it explicitly or it protects nothing on a phone',
        ).toMatch(/input\.field/);
        expect(block).toMatch(/select\.field/);
        expect(block).toMatch(/textarea\.field/);
    });

    it('keeps `.field` itself dense, so desktop is unaffected', () => {
        // The floor is inside the media query on purpose: a mouse has no zoom-on-focus failure,
        // and forcing 16px everywhere is the "blown up" density Sprint 5 removed.
        const fieldRule = css.slice(css.indexOf('.field {'), css.indexOf('.field {') + 300);
        expect(fieldRule).toMatch(/text-sm/);
    });
});
