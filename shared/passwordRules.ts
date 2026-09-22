/**
 * Password rules for client logins, shared by the browser (so the form can say
 * what is wrong before sending anything) and the edge functions (which are the
 * ones that actually enforce them). Pure module: no imports, no globals besides
 * `crypto`, which the browser, Node and Deno all provide.
 */

export const MIN_PASSWORD_LENGTH = 10;

/** Length of a generated temporary password. */
export const GENERATED_PASSWORD_LENGTH = 14;

// Obvious sequences a person might type to get past the length rule.
const WEAK_SEQUENCES = ["1234567890", "0123456789", "0987654321", "qwertyuiop", "abcdefghij"];

/**
 * Why a password is not acceptable, in plain English, or null when it is fine.
 * `email` is the account's address: a password equal to it (or to the part before
 * the @) is refused.
 */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }
  const lower = password.toLowerCase();
  if (new Set(lower).size === 1) {
    return "The password cannot be the same character repeated.";
  }
  if (lower.includes("password")) {
    return 'The password cannot contain the word "password".';
  }
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail) {
    const localPart = cleanEmail.split("@")[0] ?? "";
    if (lower === cleanEmail || (localPart.length > 0 && lower === localPart)) {
      return "The password cannot be the email address.";
    }
  }
  if (WEAK_SEQUENCES.some((sequence) => lower.includes(sequence))) {
    return "The password is too easy to guess: it contains a keyboard or number sequence.";
  }
  return null;
}

// Letters and digits that are easy to read aloud and to type: no 0/O, 1/l/I.
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?+-=";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** A uniformly random index below `limit`, from the platform's secure generator. */
function randomIndex(limit: number): number {
  // Rejection sampling keeps every index equally likely.
  const max = 256 - (256 % limit);
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    const value = byte[0] ?? 0;
    if (value < max) return value % limit;
  }
}

function pick(alphabet: string): string {
  return alphabet.charAt(randomIndex(alphabet.length));
}

/**
 * A random temporary password of `length` characters (14 by default) that always
 * contains at least one lower-case letter, one upper-case letter, one digit and
 * one symbol, and always passes `passwordProblem`.
 */
export function generateTemporaryPassword(length = GENERATED_PASSWORD_LENGTH): string {
  const size = Math.max(length, MIN_PASSWORD_LENGTH, 12);
  for (;;) {
    const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < size) chars.push(pick(ALL));
    // Shuffle so the guaranteed characters are not always at the front.
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomIndex(i + 1);
      [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
    }
    const password = chars.join("");
    if (passwordProblem(password) === null) return password;
  }
}
