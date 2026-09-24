/**
 * A ring buffer of log lines per site: the preview's install and dev server output,
 * kept to the last N lines so GET /sites/log can show what happened without the
 * server holding on to megabytes of npm output.
 */
export class RingLog {
  private readonly lines: string[] = [];
  private readonly capacity: number;

  constructor(capacity = 200) {
    this.capacity = capacity;
  }

  /** Multi-line text is split so the buffer holds one line per entry. */
  push(text: string): void {
    for (const line of text.split("\n")) {
      this.lines.push(line);
      if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
    }
  }

  tail(count = this.capacity): string[] {
    return this.lines.slice(-count);
  }

  clear(): void {
    this.lines.length = 0;
  }
}
