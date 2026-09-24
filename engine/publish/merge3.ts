/**
 * A dependency-free three-way line merge, the same idea as diff3.
 *
 * Both sides are diffed against the common base (an LCS diff on lines). The
 * resulting change hunks are walked in base order. A hunk that only one side
 * made is applied as is. Hunks from both sides that touch the same base lines
 * form a region: when both sides produced the same lines for it the change is
 * taken once, otherwise the region is a conflict and the merge fails.
 *
 * Pure module: no I/O, nothing but strings in and out.
 */

export type Merge3Result = { ok: true; merged: string } | { ok: false; conflicts: number };

/** One changed run of lines: base[oStart, oStart+oLength) became side[abStart, abStart+abLength). */
type Hunk = { side: "a" | "b"; oStart: number; oLength: number; abStart: number; abLength: number };

/** Above this many DP cells the middle of the diff is treated as one coarse hunk. */
const MAX_DP_CELLS = 4_000_000;

function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === "") return { lines: [], trailingNewline: false };
  const lines = text.split("\n");
  const trailingNewline = lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/**
 * Matched line pairs (i in `o`, j in `ab`) in order, from an LCS. Common prefix and
 * suffix are peeled off first so the quadratic table only covers the part that
 * actually changed.
 */
function matchPairs(o: string[], ab: string[]): [number, number][] {
  const pairs: [number, number][] = [];
  let prefix = 0;
  while (prefix < o.length && prefix < ab.length && o[prefix] === ab[prefix]) {
    pairs.push([prefix, prefix]);
    prefix += 1;
  }
  let suffix = 0;
  while (suffix < o.length - prefix && suffix < ab.length - prefix && o[o.length - 1 - suffix] === ab[ab.length - 1 - suffix]) {
    suffix += 1;
  }
  const oMid = o.slice(prefix, o.length - suffix);
  const abMid = ab.slice(prefix, ab.length - suffix);
  const n = oMid.length;
  const m = abMid.length;

  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= MAX_DP_CELLS) {
    // Classic LCS table, then a backtrack that collects the matched pairs.
    const width = m + 1;
    const table = new Int32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        const here = i * width + j;
        if (oMid[i] === abMid[j]) table[here] = (table[here + width + 1] ?? 0) + 1;
        else table[here] = Math.max(table[here + width] ?? 0, table[here + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (oMid[i] === abMid[j]) {
        pairs.push([prefix + i, prefix + j]);
        i += 1;
        j += 1;
      } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  // When the middle is too big for the table, no pairs are added for it and the
  // whole middle becomes one replacement hunk. Coarse, but still a correct diff.

  for (let k = suffix - 1; k >= 0; k -= 1) {
    pairs.push([o.length - 1 - k, ab.length - 1 - k]);
  }
  return pairs;
}

/** The change hunks that turn `o` into `ab`, in base order. */
function diffHunks(side: "a" | "b", o: string[], ab: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let oPos = 0;
  let abPos = 0;
  const push = (oEnd: number, abEnd: number) => {
    if (oEnd > oPos || abEnd > abPos) {
      hunks.push({ side, oStart: oPos, oLength: oEnd - oPos, abStart: abPos, abLength: abEnd - abPos });
    }
  };
  for (const [i, j] of matchPairs(o, ab)) {
    push(i, j);
    oPos = i + 1;
    abPos = j + 1;
  }
  push(o.length, ab.length);
  return hunks;
}

function sameLines(x: string[], y: string[]): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * Does `hunk` belong to the region [regionStart, regionEnd) already being built?
 * Hunks are sorted by start, so only the tail matters. A pure insertion joins a
 * region when it lands strictly inside it, or when the region is itself a pure
 * insertion at the same spot (two inserts at one place cannot be ordered).
 */
function joinsRegion(hunk: Hunk, regionStart: number, regionEnd: number): boolean {
  if (hunk.oLength > 0) return hunk.oStart < regionEnd;
  if (regionStart === regionEnd) return hunk.oStart === regionStart;
  return hunk.oStart < regionEnd;
}

export function merge3(base: string, mine: string, theirs: string): Merge3Result {
  const o = splitLines(base);
  const a = splitLines(mine);
  const b = splitLines(theirs);

  const hunks = [...diffHunks("a", o.lines, a.lines), ...diffHunks("b", o.lines, b.lines)];
  // Insertions sort before changes that start at the same line, so an insert in
  // front of an edited block goes in front of it. Ties fall to "mine" first.
  hunks.sort((x, y) => x.oStart - y.oStart || x.oLength - y.oLength || (x.side === y.side ? 0 : x.side === "a" ? -1 : 1));

  const out: string[] = [];
  let conflicts = 0;
  let copied = 0;
  let index = 0;

  while (index < hunks.length) {
    const first = hunks[index];
    if (!first) break;
    index += 1;
    const regionStart = first.oStart;
    let regionEnd = first.oStart + first.oLength;
    const region: Hunk[] = [first];
    while (index < hunks.length) {
      const next = hunks[index];
      if (!next || !joinsRegion(next, regionStart, regionEnd)) break;
      regionEnd = Math.max(regionEnd, next.oStart + next.oLength);
      region.push(next);
      index += 1;
    }

    // Base lines nobody touched since the previous region.
    for (let i = copied; i < regionStart; i += 1) out.push(o.lines[i] ?? "");
    copied = regionEnd;

    if (region.length === 1) {
      const side = first.side === "a" ? a.lines : b.lines;
      for (let i = first.abStart; i < first.abStart + first.abLength; i += 1) out.push(side[i] ?? "");
      continue;
    }

    // Both sides changed this stretch of the base. Work out what each side has
    // in place of the whole region: outside a side's own hunks its lines shift
    // by a constant offset, so the region's edges map through the nearest hunk.
    const bounds: Record<"a" | "b", { abMin: number; abMax: number; oMin: number; oMax: number } | null> = { a: null, b: null };
    for (const hunk of region) {
      const current = bounds[hunk.side];
      const abEnd = hunk.abStart + hunk.abLength;
      const oEnd = hunk.oStart + hunk.oLength;
      bounds[hunk.side] = current
        ? { abMin: Math.min(current.abMin, hunk.abStart), abMax: Math.max(current.abMax, abEnd), oMin: Math.min(current.oMin, hunk.oStart), oMax: Math.max(current.oMax, oEnd) }
        : { abMin: hunk.abStart, abMax: abEnd, oMin: hunk.oStart, oMax: oEnd };
    }
    const sliceFor = (side: "a" | "b"): string[] => {
      const lines = side === "a" ? a.lines : b.lines;
      const bound = bounds[side];
      if (!bound) return o.lines.slice(regionStart, regionEnd);
      return lines.slice(bound.abMin + (regionStart - bound.oMin), bound.abMax + (regionEnd - bound.oMax));
    };
    const mineLines = sliceFor("a");
    const theirLines = sliceFor("b");
    if (sameLines(mineLines, theirLines)) {
      out.push(...mineLines);
    } else {
      conflicts += 1;
    }
  }
  for (let i = copied; i < o.lines.length; i += 1) out.push(o.lines[i] ?? "");

  if (conflicts > 0) return { ok: false, conflicts };
  if (out.length === 0) return { ok: true, merged: "" };
  // The side that changed the file ending wins; when neither did, keep the base's.
  const trailingNewline = a.trailingNewline !== o.trailingNewline ? a.trailingNewline : b.trailingNewline;
  return { ok: true, merged: out.join("\n") + (trailingNewline ? "\n" : "") };
}
