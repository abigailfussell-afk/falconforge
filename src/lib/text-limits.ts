/**
 * How long a title or a name may be (WALK-A-11).
 *
 * The walkthrough typed a 165-character title into a meeting and a 125-character name plus emoji
 * into a sub-team. Both were accepted and stored verbatim, and the meeting one then clipped off
 * the right edge of the detail header, because nothing anywhere in the stack had an opinion about
 * length — not the input, not the entity registry, not the column.
 *
 * 120, which is roughly two lines at the sizes these render at and about four times the longest
 * real title in the review data ("Engineering notebook — week 6 entry" is 34). The point is not
 * to be tight; it is to have a number at all, so a paste of a whole paragraph into a title field
 * fails at the keyboard instead of arriving in the database and breaking a layout.
 *
 * THE SAME NUMBER IN TWO PLACES, WHICH IS THE PART THAT ROTS. The client cap and the database
 * CHECK have to agree exactly: a client that allows more than the column does turns an ordinary
 * typo into a dead-lettered sync, and a column that allows more than the client is a limit that
 * an older bundle or a direct API call simply walks around. `docs/failure-modes.md` §12 is the
 * hand-maintained list, and this is one. `src/test/__tests__/title-length-limits.test.ts` reads
 * the migration and this file and requires the numbers to match, so the pair cannot drift
 * silently the way five overlapping SELECT policies did.
 *
 * Measured in JS string length (UTF-16 code units) against Postgres `char_length` (code points).
 * They differ only above the BMP — an emoji is 2 in JS and 1 in Postgres — so the client is
 * always the STRICTER of the two and the database never refuses something the client allowed.
 * That direction is the safe one: the user is told at the keyboard rather than by a failed sync.
 */
export const TITLE_MAX_LENGTH = 120;
