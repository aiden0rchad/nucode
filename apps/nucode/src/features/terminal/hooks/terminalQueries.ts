// Adapted from t3code apps/server/src/terminal/Manager.ts (shouldStripCsiSequence,
// shouldStripDcsSequence, shouldStripOscSequence, isOscPaletteQuery).
// MIT License, Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_T3CODE.LICENSE.

function shouldStripCsi(body: string, finalByte: string): boolean {
  if (finalByte === "n") return true;
  if (finalByte === "R" && /^[0-9;?]*$/.test(body)) return true;
  if (finalByte === "c" && /^[>=0-9;?]*$/.test(body)) return true;
  // DECRQM/DECRPM; the $ guard keeps setters.
  if ((finalByte === "p" || finalByte === "y") && /^[0-9;?]*\$$/.test(body)) return true;
  // XTVERSION (>q); DECSCUSR (space-intermediate q) stays.
  if (finalByte === "q" && /^>[0-9;]*$/.test(body)) return true;
  // Kitty keyboard query/reply (?u); bare u (restore cursor) stays.
  return finalByte === "u" && body.startsWith("?");
}

// DECRQSS / XTGETTCAP.
const shouldStripDcs = (content: string) => /^[01]?[$+][qr]/.test(content);

const shouldStripOsc = (content: string) => /^(10|11|12);(?:\?|rgb:)/.test(content);

// OSC 4 whose every colour is "?" reports palette entries and sets none.
function isOscPaletteQuery(content: string): boolean {
  const [code, ...pairs] = content.split(";");
  return code === "4" && pairs.length > 1 && pairs.every((f, i) => i % 2 === 0 || f === "?");
}

/** Removes sequences that make a terminal answer (DA, DSR, OSC colour queries, ...) from replayed history. */
export function stripTerminalQueries(input: string): string {
  if (!input.includes("\x1b")) return input;
  let out = "";
  let i = 0;
  while (i < input.length) {
    const esc = input.indexOf("\x1b", i);
    if (esc === -1 || esc === input.length - 1) break;
    out += input.slice(i, esc);
    i = esc;
    const kind = input[esc + 1];
    if (kind === "[") {
      let j = esc + 2;
      while (j < input.length && input.charCodeAt(j) >= 0x20 && input.charCodeAt(j) <= 0x3f) j++;
      if (j >= input.length || input.charCodeAt(j) < 0x40 || input.charCodeAt(j) > 0x7e) {
        out += input.slice(i, j); // truncated or malformed: keep verbatim
        i = j;
      } else {
        if (!shouldStripCsi(input.slice(esc + 2, j), input[j])) out += input.slice(esc, j + 1);
        i = j + 1;
      }
    } else if (kind === "]" || kind === "P") {
      let j = esc + 2;
      let contentEnd = -1;
      let end = -1;
      for (; j < input.length; j++) {
        const c = input[j];
        if (c === "\x07" || c === "\u009c") { contentEnd = j; end = j + 1; break; }
        if (c === "\x1b" && input[j + 1] === "\\") { contentEnd = j; end = j + 2; break; }
      }
      if (end === -1) { // unterminated: keep verbatim
        out += input.slice(i);
        i = input.length;
        break;
      }
      const content = input.slice(esc + 2, contentEnd);
      const strip =
        kind === "]" ? shouldStripOsc(content) || isOscPaletteQuery(content) : shouldStripDcs(content);
      if (!strip) out += input.slice(esc, end);
      i = end;
    } else if (kind === "Z") { // DECID
      i = esc + 2;
    } else {
      out += input.slice(esc, esc + 2);
      i = esc + 2;
    }
  }
  return out + input.slice(i);
}
