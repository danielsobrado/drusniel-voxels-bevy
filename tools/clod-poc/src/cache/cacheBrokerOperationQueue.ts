export class CacheBrokerOperationQueue {
  private gate: Promise<void> = Promise.resolve();
  private readonly active = new Set<Promise<unknown>>();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.gate.then(operation);
    this.track(result);
    return result;
  }

  barrier<T>(operation: () => Promise<T>): Promise<T> {
    const preceding = [...this.active];
    const result = this.gate
      .then(() => Promise.allSettled(preceding))
      .then(operation);
    this.gate = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private track(operation: Promise<unknown>): void {
    this.active.add(operation);
    void operation.then(
      () => this.active.delete(operation),
      () => this.active.delete(operation),
    );
  }
}
