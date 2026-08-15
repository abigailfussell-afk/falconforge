import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordAttestation, ATTESTATION_VERSIONS } from '../attestations';
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

const mockFrom = supabase!.from as any;
const mockGetUser = supabase!.auth.getUser as any;
const mockIsSupabaseConfigured = isSupabaseConfigured as any;

describe('attestations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
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

});
