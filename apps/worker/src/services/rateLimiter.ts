export class SlidingWindowPerSecondLimiter {
  private readonly acceptedTimestamps: number[] = [];

  constructor(private readonly maxPerSecond: number) {}

  acquire(nowMs = Date.now()): boolean {
    while (this.acceptedTimestamps.length > 0) {
      const oldest = this.acceptedTimestamps[0];
      if (oldest === undefined || nowMs - oldest < 1000) {
        break;
      }
      this.acceptedTimestamps.shift();
    }

    if (this.acceptedTimestamps.length >= this.maxPerSecond) {
      return false;
    }

    this.acceptedTimestamps.push(nowMs);
    return true;
  }
}
