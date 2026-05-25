// services/RateLimitedQueue.ts
import { nearIntentsClient } from '../clients/nearIntentsClient';
import { QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { config } from '../config';

export type QueueTask = {
  id: string;
  priority: number;
  params: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    dry: boolean;
    quoteWaitingTimeMs?: number;
  };
  resolve: (value: QuoteResponse | null) => void;
  reject: (reason: any) => void;
};

export class RateLimitedQueue {
  private queue: QueueTask[] = [];
  private pending = false;
  private intervalMs: number;
  private lastCallTime = 0;

  constructor() {
    this.intervalMs = 1000 / config.api.rateLimitPerSecond;
  }

  add(params: QueueTask['params'], priority: number = 5): Promise<QuoteResponse | null> {
    return new Promise((resolve, reject) => {
      const id = `${params.originAsset}|${params.destinationAsset}|${params.dry}`;
      this.queue.push({ id, priority, params, resolve, reject });
      this.queue.sort((a, b) => a.priority - b.priority);
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    while (this.queue.length) {
      const now = Date.now();
      const wait = Math.max(0, this.lastCallTime + this.intervalMs - now);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const task = this.queue.shift()!;
      this.lastCallTime = Date.now();
      try {
        const result = await nearIntentsClient.getQuote(task.params);
        task.resolve(result);
      } catch (err) {
        task.reject(err);
      }
    }
    this.pending = false;
  }
}