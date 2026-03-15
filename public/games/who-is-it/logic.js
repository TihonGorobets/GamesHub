/**
 * /public/games/who-is-it/logic.js
 * Client-side helper utilities for the "Who Is It?" game.
 *
 * Keeps any client-only game logic isolated and reusable.
 */

/**
 * Returns a greeting string based on the result of a reveal.
 * @param {boolean} guessedCorrectly
 * @param {string} authorName
 * @returns {string}
 */
export function buildRevealHeadline(guessedCorrectly, authorName) {
  if (guessedCorrectly) {
    return `✅ You guessed it! It was ${authorName}!`;
  }
  return `😅 Nope! It was actually ${authorName}!`;
}

/**
 * Formats a score change message.
 * @param {number} delta
 * @returns {string}
 */
export function formatScoreDelta(delta) {
  if (delta > 0) return `+${delta} pts 🎉`;
  if (delta < 0) return `${delta} pts`;
  return 'No points this round';
}

/**
 * Returns a random encouraging writing prompt.
 */
export function getWritingPrompt() {
  const prompts = [
    'Something embarrassing that happened to you…',
    'A weird talent nobody knows about…',
    'The strangest food you've ever eaten…',
    'A childhood memory that sounds made up…',
    'Something you've done that nobody would believe…',
    'An unusual fear you have…',
    'The weirdest job you've ever had…',
    'A strange habit you can't explain…',
  ];
  return prompts[Math.floor(Math.random() * prompts.length)];
}

/**
 * Validates that a fact string is acceptable.
 * @param {string} fact
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFact(fact) {
  const trimmed = (fact || '').trim();
  if (!trimmed) return { valid: false, error: 'Write something!' };
  if (trimmed.length < 10) return { valid: false, error: 'Too short — add a bit more detail.' };
  if (trimmed.length > 200) return { valid: false, error: 'Maximum 200 characters.' };
  return { valid: true };
}
