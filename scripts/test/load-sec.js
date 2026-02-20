class SlidingWindowPerSecondLimiter {
  constructor(maxPerSecond) {
    this.maxPerSecond = maxPerSecond;
    this.acceptedTimestamps = [];
  }

  acquire(nowMs = Date.now()) {
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

function run() {
  const limiter = new SlidingWindowPerSecondLimiter(10);
  const now = 1_700_000_000_000;
  let accepted = 0;
  for (let i = 0; i < 200; i += 1) {
    if (limiter.acquire(now + i)) {
      accepted += 1;
    }
  }
  if (accepted > 10) {
    console.error(`sec_rate_limit failed: accepted=${accepted}`);
    process.exit(1);
  }

  const recovered = limiter.acquire(now + 1200);
  if (!recovered) {
    console.error("sec_rate_limit failed: limiter did not recover after 1s window");
    process.exit(1);
  }

  console.log(`sec_rate_limit passed: accepted=${accepted}`);
}

run();
