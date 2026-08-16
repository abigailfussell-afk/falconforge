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
        /*
         * VERSION IS PART OF THE CONFLICT TARGET, and this assertion is the reason to state it
         * rather than loosen the matcher.
         *
         * Sprint 6 widened the unique key to (user_id, attestation_type, version) so that
         * accepting v2 of the terms keeps the record of having accepted v1 — the one question a
         * legal attestation exists to answer. An upsert naming only two of those columns matches
         * no unique index and errors outright, so the two have to move together.
         */
        { onConflict: 'user_id,attestation_type,version' }
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
