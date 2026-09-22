/**
 * Element ids: eight characters from [a-z0-9], made from a cryptographic source when
 * one exists. An id is stable for the element's life and becomes its CSS class .ae-<id>.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newElementId(random: (count: number) => Uint8Array = defaultRandom): string {
  const bytes = random(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}

function defaultRandom(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) return cryptoApi.getRandomValues(bytes);
  for (let i = 0; i < count; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** A fresh copy of an element tree with every id regenerated (for duplicate and paste). */
export function withFreshIds<T extends { id: string; children?: T[] }>(element: T): T {
  return { ...element, id: newElementId(), children: element.children?.map(withFreshIds) };
}
