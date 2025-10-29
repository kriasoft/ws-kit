/**
 * Ring buffer for storing operation history with fixed memory footprint.
 *
 * Maintains a fixed-size circular buffer of recent operations.
 * Older operations fall off automatically to prevent unbounded memory growth.
 */
export class RingBuffer<T extends { rev: number }> {
  private buffer: T[] = [];
  private readonly maxSize: number;
  private firstRev = 0; // Revision of oldest item in buffer

  constructor(maxSize = 1024) {
    this.maxSize = maxSize;
  }

  /**
   * Add an operation to the buffer
   */
  push(item: T): void {
    if (this.buffer.length === 0) {
      this.firstRev = item.rev;
    }

    this.buffer.push(item);

    // Remove oldest item if over capacity
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
      this.firstRev = this.buffer[0]?.rev ?? item.rev;
    }
  }

  /**
   * Get operations in a revision range (exclusive fromRev, inclusive toRev)
   *
   * @returns operations matching the range, or undefined if range is outside buffer
   */
  range(fromRev: number, toRev: number): T[] | undefined {
    // Check if range is outside buffer window
    if (fromRev < this.firstRev - 1 || toRev > this.lastRev) {
      return undefined; // Out of range, need snapshot
    }

    return this.buffer.filter(
      (item) => item.rev > fromRev && item.rev <= toRev,
    );
  }

  /**
   * Check if we can provide deltas for this revision
   */
  canProvideDeltas(fromRev: number): boolean {
    if (this.buffer.length === 0) return fromRev === 0;
    return fromRev >= this.firstRev - 1;
  }

  /**
   * Get the revision of the most recent operation in buffer
   */
  get lastRev(): number {
    return this.buffer[this.buffer.length - 1]?.rev ?? 0;
  }

  /**
   * Get buffer occupancy (0 to maxSize)
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Clear all operations
   */
  clear(): void {
    this.buffer = [];
    this.firstRev = 0;
  }
}
