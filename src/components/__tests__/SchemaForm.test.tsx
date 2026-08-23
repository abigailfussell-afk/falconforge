/**
 * P-01's first named red test: *"`SchemaForm` renders each field type."*
 *
 * The form used to be hand-written JSX naming DECODE's fields one at a time. Every one of them
 * is now a row in a JSON file, and this is what says the renderer can actually produce each
 * kind — including the two that carry rules of their own (the counter's floor and the
 * textarea's cap), which are where a game-agnostic form is most likely to quietly lose a value.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchemaForm from '../scouting/SchemaForm';
import { blankReportData, type GameDefinition } from '../../lib/game-definition';

/**
 * One section holding one of every type. Not DECODE: this is about the RENDERER, and using the
 * real definition would make it a test of DECODE's current shape instead.
 */
const EVERY_TYPE: GameDefinition = {
    id: 'test-every-type',
    program: 'ftc',
    seasonKey: '2026-27',
    title: 'TESTGAME',
    version: 1,
    match: { allianceSize: 2, phases: [{ key: 'teleop', label: 'TeleOp' }] },
    field: { image: 'DecodeField.png', width: 100, height: 100 },
    scouting: {
        match: {
            sections: [
                {
                    key: 'all',
                    label: 'Everything',
                    fields: [
                        { key: 'aBool', label: 'A bool', type: 'bool' },
                        { key: 'aCounter', label: 'A counter', type: 'counter', min: 0, max: 3 },
                        { key: 'anInt', label: 'An int', type: 'int', min: 0 },
                        { key: 'aSelect', label: 'A select', type: 'select', options: ['One', 'Two'] },
                        { key: 'aRating', label: 'A rating', type: 'rating', min: 1, max: 5 },
                        { key: 'aText', label: 'A text', type: 'text', maxLength: 10 },
                        { key: 'aTextarea', label: 'A textarea', type: 'textarea', maxLength: 20 },
                    ],
                },
            ],
        },
    },
    scoring: { metrics: [] },
    planner: { partnerCapabilities: [] },
};

const renderForm = (over: Partial<React.ComponentProps<typeof SchemaForm>> = {}) => {
    const onChange = vi.fn();
    const value = over.value ?? blankReportData(EVERY_TYPE);
    render(
        <SchemaForm
            game={EVERY_TYPE}
            value={value}
            onChange={onChange}
            canEdit
            {...over}
        />,
    );
    return { onChange, value };
};

describe('every field type renders', () => {
    it.each([
        ['bool', 'field-aBool', 'checkbox'],
        ['counter', 'field-aCounter', 'number'],
        ['int', 'field-anInt', 'number'],
        ['rating', 'field-aRating', 'range'],
    ])('%s renders as an %s input', (_label, testId, type) => {
        renderForm();
        expect(screen.getByTestId(testId).getAttribute('type')).toBe(type);
    });

    it('select renders its options', () => {
        renderForm();
        const select = screen.getByTestId('field-aSelect') as HTMLSelectElement;
        expect([...select.options].map((o) => o.value)).toEqual(['One', 'Two']);
    });

    it('textarea renders, with a live counter', () => {
        renderForm({ value: { ...blankReportData(EVERY_TYPE), aTextarea: 'hello' } });
        expect(screen.getByTestId('field-aTextarea').tagName).toBe('TEXTAREA');
        expect(screen.getByTestId('field-aTextarea-count').textContent).toBe('5/20');
    });

    it('groups fields under their section label', () => {
        renderForm();
        expect(screen.getByTestId('schema-section-all')).toBeInTheDocument();
        expect(screen.getByText('Everything')).toBeInTheDocument();
    });
});

describe('the rules the renderer carries', () => {
    /*
     * B18 IN ITS ORIGINAL SHAPE: `parseInt('') → NaN → || 0` put a fabricated 0 into five of
     * nine live production rows. A cleared counter goes back to its MINIMUM — a value the scout
     * can see — rather than to a zero that looks like recorded data.
     */
    it('a cleared counter returns to its minimum, not to a fabricated value', () => {
        const { onChange } = renderForm({
            value: { ...blankReportData(EVERY_TYPE), aCounter: 2 },
        });

        fireEvent.change(screen.getByTestId('field-aCounter'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ aCounter: 0 }));
    });

    /*
     * ...and an `int` does the opposite, deliberately. A blank number field means "not
     * recorded", which is a different fact from zero — `docs/failure-modes.md` §4. A counter's
     * UI cannot produce that state; a typed number field can.
     */
    it('a cleared int becomes undefined, because absent is not zero', () => {
        const { onChange } = renderForm({
            value: { ...blankReportData(EVERY_TYPE), anInt: 7 },
        });

        fireEvent.change(screen.getByTestId('field-anInt'), { target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ anInt: undefined }));
    });

    it('the counter cannot go below its minimum, and says why', () => {
        renderForm({ value: { ...blankReportData(EVERY_TYPE), aCounter: 0 } });
        const minus = screen.getByTestId('field-aCounter-minus') as HTMLButtonElement;

        expect(minus.disabled).toBe(true);
        expect(minus.getAttribute('title')).toContain('minimum');
    });

    it('the counter cannot go above its maximum', () => {
        renderForm({ value: { ...blankReportData(EVERY_TYPE), aCounter: 3 } });
        expect((screen.getByTestId('field-aCounter-plus') as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows a field-level error for a value that breaks the rule', () => {
        renderForm({ value: { ...blankReportData(EVERY_TYPE), aCounter: 99 } });
        expect(screen.getByTestId('field-aCounter-error').textContent).toContain('At most 3');
    });
});

describe('read-only', () => {
    /*
     * The refusal REACHES EACH CONTROL, with its reason. A disabled Save tells a scout that
     * something is wrong and not which box; on an archived season or a lapsed licence the
     * answer is "all of them", and `docs/failure-modes.md` §8 says a control that cannot act is
     * disabled with a title saying why.
     */
    it('disables every control and gives each one the reason', () => {
        renderForm({ canEdit: false, refusalReason: 'This season is archived and read-only' });

        for (const testId of [
            'field-aBool', 'field-aCounter', 'field-anInt',
            'field-aSelect', 'field-aRating', 'field-aText', 'field-aTextarea',
        ]) {
            const el = screen.getByTestId(testId) as HTMLInputElement;
            expect(el.disabled, `${testId} was still live`).toBe(true);
            expect(el.getAttribute('title'), `${testId} gave no reason`).toBe(
                'This season is archived and read-only',
            );
        }
    });

    it('disables the counter buttons too, not just the box', () => {
        renderForm({ canEdit: false, refusalReason: 'nope', value: { aCounter: 1 } });
        expect((screen.getByTestId('field-aCounter-minus') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('field-aCounter-plus') as HTMLButtonElement).disabled).toBe(true);
    });
});
