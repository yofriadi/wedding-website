/** Shuffle a copy; never randomize the API's cached source array in place. */
export function shuffleTrail<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/** A shuffled queue, not a random pick every frame: every photo gets a turn. */
export class TrailSequence {
  private sources: string[] = [];
  private remaining: string[] = [];

  constructor(private random = Math.random) {}

  update(sources: readonly string[]): string[] {
    const previous = new Set(this.sources);
    this.sources = [...new Set(sources.filter(Boolean))];
    const retained = new Set(this.sources);
    const added = this.sources.filter((source) => !previous.has(source));
    this.remaining = [
      ...shuffleTrail(added, this.random),
      ...this.remaining.filter((source) => retained.has(source)),
    ];
    return added;
  }

  prioritize(sources: readonly string[]) {
    const priority = [...new Set(sources)].filter((source) => this.sources.includes(source));
    const promoted = new Set(priority);
    this.remaining = [...priority, ...this.remaining.filter((source) => !promoted.has(source))];
  }

  next(occupied: ReadonlySet<string>, previous?: string): string | undefined {
    if (!this.remaining.length) this.remaining = shuffleTrail(this.sources, this.random);
    // Prefer a photo not already on screen or reserved for another frame.
    const index = this.remaining.findIndex(
      (source) => source !== previous && !occupied.has(source),
    );
    // Every photo is already on screen: hold the current one instead of
    // duplicating a photo across two frames.
    if (index < 0) return undefined;
    return this.remaining.splice(index, 1)[0];
  }
}
