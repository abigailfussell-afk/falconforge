import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PortfolioAI from '../PortfolioAI';
import { useAppStore } from '@/lib/store';

// Mock global DOMMatrix which is used by pdfjs in jsdom environment
if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix { } as any;
}

import * as geminiService from '@/services/geminiService';

vi.mock('@/services/geminiService', () => ({
    generatePortfolioSummary: vi.fn(),
    generateInterviewQuestions: vi.fn(),
}));

describe('PortfolioAI', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(geminiService.generatePortfolioSummary).mockResolvedValue(
            '# AI Generated Portfolio\n\nThis is a test.'
        );

        useAppStore.setState({
            geminiApiKey: 'test-key',
            tasks: [
                { id: '1', title: 'Task 1', description: 'Test', assignedTo: 'user-1', status: 'Done', department: 'Build', type: 'Feature', checklist: [], timeline: [], createdAt: 1000, tags: [] },
            ],
            portfolioHistory: [],
            addPortfolioEntry: vi.fn(),
        });
    });

    it('renders the header and generation controls', () => {
        render(<PortfolioAI tasks={[]} view="portfolio" />);

        expect(screen.getByText('Portfolio Helper')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Generate Summary/i })).toBeInTheDocument();
    });

    it('calls the API and displays the result when generated', async () => {
        render(<PortfolioAI tasks={[]} view="portfolio" />);

        const generateBtn = screen.getByRole('button', { name: /Generate Summary/i });
        fireEvent.click(generateBtn);

        // Should eventually show the result
        await waitFor(() => {
            expect(screen.getByText(/AI Generated Portfolio/i)).toBeInTheDocument();
            expect(screen.getByText(/This is a test\./i)).toBeInTheDocument();
        });
    });
});
