export interface Position {
  readonly line: number;
  readonly col: number;
  readonly byte: number;
}

function utf8Length(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < to) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Maps UTF-16 indices to 0-based line, col (UTF-16 units) and UTF-8 byte offset, and back. */
export class LineIndex {
  private readonly starts: number[] = [0];
  private readonly byteStarts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        const prev = this.starts[this.starts.length - 1] ?? 0;
        this.byteStarts.push((this.byteStarts[this.byteStarts.length - 1] ?? 0) + utf8Length(text, prev, i + 1));
        this.starts.push(i + 1);
      }
    }
  }

  position(index: number): Position {
    const i = Math.max(0, Math.min(index, this.text.length));
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= i) lo = mid;
      else hi = mid - 1;
    }
    const start = this.starts[lo] ?? 0;
    return { line: lo, col: i - start, byte: (this.byteStarts[lo] ?? 0) + utf8Length(this.text, start, i) };
  }

  index(pos: { readonly line: number; readonly col: number }): number {
    return (this.starts[pos.line] ?? this.text.length) + pos.col;
  }

  lineText(line: number): string {
    const s = this.starts[line] ?? this.text.length;
    const e = this.starts[line + 1] ?? this.text.length + 1;
    return this.text.slice(s, e - 1);
  }
}
