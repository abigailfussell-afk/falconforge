import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMissingAttestations, recordAttestation, recordAttestations, ATTESTATION_VERSIONS } from '../attestations';
import { supabase, isSupabaseConfigured } from '../supabase';

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn()
    }
  },
  isSupabaseConfigured: vi.fn()
}));

const mockFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;
const mockGetUser = supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>;
const mockIsSupabaseConfigured = isSupabaseConfigured as unknown as ReturnType<typeof vi.fn>;

describe('attestations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
  });

  describe('getMissingAttestations', () => {
    it('returns empty array if supabase is not configured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      const result = await getMissingAttestations('user-1', ['terms', 'privacy']);
      expect(result).toEqual([]);
    });

    it('identifies missing attestations correctly', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: [{ attestation_type: 'terms', version: ATTESTATION_VERSIONS.terms }],
          error: null
        })
      });

      const missing = await getMissingAttestations('user-1', ['terms', 'privacy']);
      expect(missing).toEqual(['privacy']); // Terms exists, privacy is missing
    });

    it('treats outdated attestations as missing', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: [{ attestation_type: 'terms', version: '0.9' }], // Outdated
          error: null
        })
      });

      const missing = await getMissingAttestations('user-1', ['terms']);
      expect(missing).toEqual(['terms']);
    });

    it('returns all required types on supabase error', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: new Error('DB Error') })
      });

      const missing = await getMissingAttestations('user-1', ['terms', 'privacy']);
      expect(missing).toEqual(['terms', 'privacy']);
    });
  });

  describe('recordAttestation', () => {
    it('returns error if unauthenticated', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const result = await recordAttestation('terms');
      expect(result).toEqual({ success: false, error: 'Not authenticated' });
    });

    it('successfully records attestation', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } } });
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const result = await recordAttestation('terms');
      
      expect(result).toEqual({ success: true });
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          attestation_type: 'terms',
          version: ATTESTATION_VERSIONS.terms
        }),
        { onConflict: 'user_id,attestation_type' }
      );
    });

    it('returns error if upsert fails', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user-1' } } });
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: { message: 'Insert failed' } })
      });

      const result = await recordAttestation('terms');
      expect(result).toEqual({ success: false, error: 'Insert failed' });
    });
  });

  describe('recordAttestations', () => {
    it('records multiple attestations in sequence', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
      mockFrom.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: null }) });

      const result = await recordAttestations(['terms', 'privacy']);
      expect(result).toEqual({ success: true });
      expect(mockFrom().upsert).toHaveBeenCalledTimes(2);
    });

    it('stops and returns error if one fails', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
      
      const mockUpsert = vi.fn()
        .mockResolvedValueOnce({ error: null }) // terms succeeds
        .mockResolvedValueOnce({ error: { message: 'Failed on privacy' } }); // privacy fails
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const result = await recordAttestations(['terms', 'privacy']);
      expect(result).toEqual({ success: false, error: 'Failed on privacy' });
    });
  });
});
