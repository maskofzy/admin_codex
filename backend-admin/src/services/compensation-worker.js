import { randomUUID } from 'node:crypto';

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_LEASE_MS = 30_000;

export class CompensationWorker {
  constructor({
    repository,
    eventStore,
    clock = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    leaseMs = DEFAULT_LEASE_MS,
    onError = error => console.error('compensation worker failed', error),
  }) {
    this.repository = repository;
    this.eventStore = eventStore;
    this.clock = clock;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pollIntervalMs = pollIntervalMs;
    this.leaseMs = leaseMs;
    this.onError = onError;
    this.running = false;
    this.timer = null;
    this.activeRun = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    await this.activeRun;
  }

  async runOnce() {
    const claimedAt = this.clock();
    const leaseToken = randomUUID();
    const claimed = await this.repository.claimNextCompensationItem({
      claimedAt,
      leaseToken,
      leaseExpiresAt: new Date(claimedAt.getTime() + this.leaseMs),
    });
    if (!claimed) return false;

    if (claimed.reconcileCancelled) {
      const alreadyEnqueued = await this.eventStore.hasEvent(claimed.event);
      if (alreadyEnqueued) {
        await this.repository.completeCompensationItem({
          itemId: claimed.itemId,
          leaseToken,
          status: 'enqueued',
          completedAt: this.clock(),
        });
      } else {
        await this.repository.failCompensationItem({
          itemId: claimed.itemId,
          leaseToken,
          error: new Error('cancelled before enqueue'),
          failedAt: this.clock(),
          releaseOnCancel: true,
        });
      }
      return true;
    }

    try {
      const accepted = await this.eventStore.enqueue(claimed.event, {
        permanentDedupe: true,
      });
      await this.repository.completeCompensationItem({
        itemId: claimed.itemId,
        leaseToken,
        status: accepted ? 'enqueued' : 'duplicate',
        completedAt: this.clock(),
      });
      return true;
    } catch (operationError) {
      let reportedError = operationError;
      let releaseOnCancel = false;
      try {
        if (await this.eventStore.hasEvent(claimed.event)) {
          await this.repository.completeCompensationItem({
            itemId: claimed.itemId,
            leaseToken,
            status: 'enqueued',
            completedAt: this.clock(),
          });
          return true;
        }
        releaseOnCancel = true;
      } catch (confirmationError) {
        reportedError = new AggregateError(
          [operationError, confirmationError],
          'compensation enqueue and Redis confirmation both failed',
        );
      }
      await this.repository.failCompensationItem({
        itemId: claimed.itemId,
        leaseToken,
        error: reportedError,
        failedAt: this.clock(),
        releaseOnCancel,
      });
      return true;
    }
  }

  #schedule(delay) {
    if (!this.running) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.activeRun = this.runOnce()
        .catch(this.onError)
        .finally(() => {
          this.activeRun = null;
          this.#schedule(this.pollIntervalMs);
        });
    }, delay);
  }
}
