import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePortfolioSummary, generateInterviewQuestions, summarizeMeeting } from '../geminiService';

vi.mock('../../lib/supabase', () => ({
  supabase: true,
  supabaseUrl: 'https://test-url',
  supabaseAnonKey: 'test-key'
}));

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      };
    }
  };
});

describe('geminiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('generatePortfolioSummary', () => {
    it('uses proxy when supabase is configured and no key is provided', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'Proxy Summary' })
      });

      const result = await generatePortfolioSummary([{ id: '1', title: 'Task', type: 'Feature', status: 'Done' }] as any);
      expect(result).toBe('Proxy Summary');
      expect(global.fetch).toHaveBeenCalledWith('https://test-url/functions/v1/gemini-proxy', expect.any(Object));
    });

    it('uses direct API internally when key is provided', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: 'Direct Summary' });

      const result = await generatePortfolioSummary([{ id: '1', title: 'Task', type: 'Feature', status: 'Done' }] as any, 'api-key');
      expect(result).toBe('Direct Summary');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('throws error when no proxy and no key (simulated)', async () => {
      // Proxy fetch fails
      (global.fetch as any).mockRejectedValueOnce(new Error('Proxy failed'));
      // And we have no API key
      await expect(generatePortfolioSummary([], undefined)).rejects.toThrow(/API Key missing/);
    });

    it('falls back to local GoogleGenAI if proxy fails and env key exists', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Fetch failed'));
      process.env.API_KEY = 'test-env-key';
      mockGenerateContent.mockResolvedValueOnce({ text: 'Fallback Summary' });

      const result = await generatePortfolioSummary([]);
      expect(result).toBe('Fallback Summary');
      process.env.API_KEY = undefined; // cleanup
    });
  });

  describe('generateInterviewQuestions', () => {
    it('uses proxy and parses JSON properly', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: '{"questions": [{"question": "Q1", "answer": "A1"}]}' })
      });

      const result = await generateInterviewQuestions('Context');
      expect(result).toEqual([{ question: 'Q1', answer: 'A1' }]);
    });

    it('uses direct API when key is provided', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: '```json\n{"questions": [{"question": "Q1", "answer": "A1"}]}\n```' });

      const result = await generateInterviewQuestions('Context', 'Guide', 'api-key');
      expect(result).toEqual([{ question: 'Q1', answer: 'A1' }]);
    });

    it('handles invalid JSON gracefully', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: 'Not JSON' });

      const result = await generateInterviewQuestions('Context', 'Guide', 'api-key');
      expect(result).toEqual([]);
    });
  });

  describe('summarizeMeeting', () => {
    it('uses proxy to summarize', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'Meeting Summary' })
      });

      const result = await summarizeMeeting('Notes');
      expect(result).toBe('Meeting Summary');
    });

    it('uses direct API to summarize', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: 'Direct Meeting Summary' });

      const result = await summarizeMeeting('Notes', 'api-key');
      expect(result).toBe('Direct Meeting Summary');
    });
  });
});
