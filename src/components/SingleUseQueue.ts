export class SingleUseQueue<T> {
    private queue: T[] = [];
    private seen: Set<unknown> = new Set();

    constructor(private readonly keyFn: (item: T) => unknown) {}

    enqueue(item: T): void {
        const key = this.keyFn(item);
        if (!this.seen.has(key)) {
            this.queue.push(item);
            this.seen.add(key);
        }
    }

    dequeue(): T | undefined {
        return this.queue.shift();
    }

    get isEmpty(): boolean {
        return this.queue.length === 0;
    }

    get isNotEmpty(): boolean {
        return this.queue.length > 0;
    }
}
