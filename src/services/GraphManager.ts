// services/GraphManager.ts
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { RateLimitedQueue } from './RateLimitedQueue';
import { config } from '../config';

export type Edge = {
  fromId: string;
  toId: string;
  rate: number;
  timestamp: number;
};

export class GraphManager {
  private edges: Map<string, Edge> = new Map();
  private queue: RateLimitedQueue;
  private tokenMap: Map<string, Token> = new Map();
  private allTokens: Token[] = [];
  private cachePath: string;
  private updateTimer: NodeJS.Timeout | null = null;

  constructor(queue: RateLimitedQueue) {
    this.queue = queue;
    this.cachePath = path.join(process.cwd(), 'storage', 'rate_cache.json');
  }

  async init(): Promise<void> {
    const all = await nearIntentsClient.getTokens();
    this.allTokens = all.filter(t => config.whitelistAssets.includes(t.symbol));
    if (this.allTokens.length === 0) throw new Error('No whitelisted tokens');
    for (const t of this.allTokens) this.tokenMap.set(t.assetId, t);
    console.log(`📋 Loaded ${this.allTokens.length} whitelisted tokens`);

    this.loadCache();
    await this.buildTopology(config.trading.testAmountUSD);
    this.startPeriodicUpdates(30000);
  }

  private usdToAmount(usd: number, price: number, decimals: number): string {
    if (price <= 0) return '0';
    return Math.floor((usd / price) * Math.pow(10, decimals)).toString();
  }

  private appendEdgeToCache(edge: Edge): void {
    let data: any = { edges: [] };
    if (fs.existsSync(this.cachePath)) {
      try {
        data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      } catch (e) { }
    }
    const key = `${edge.fromId}|${edge.toId}`;
    const existingIndex = data.edges.findIndex((e: any) => e.key === key);
    if (existingIndex >= 0) {
      data.edges[existingIndex] = { key, ...edge };
    } else {
      data.edges.push({ key, ...edge });
    }
    const dir = path.dirname(this.cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
  }

  async buildTopology(testAmountUSD: number): Promise<void> {
    const tokens = this.allTokens;
    if (tokens.length < 2) return;
    console.log(`🔨 Building topology for ${tokens.length} tokens...`);
    const pairs: { from: Token; to: Token }[] = [];
    for (const from of tokens) {
      for (const to of tokens) {
        if (from.assetId === to.assetId) continue;
        pairs.push({ from, to });
      }
    }
    console.log(`Total pairs: ${pairs.length}`);

    const concurrency = 50;
    const limit = pLimit(concurrency);
    let completed = 0;
    const tasks = pairs.map(pair => limit(async () => {
      const amountIn = this.usdToAmount(testAmountUSD, parseFloat(pair.from.price), pair.from.decimals);
      try {
        const quote = await nearIntentsClient.getQuote({
          originAsset: pair.from.assetId,
          destinationAsset: pair.to.assetId,
          amount: amountIn,
          dry: true,
          quoteWaitingTimeMs: 3000,
        });
        if (quote?.quote?.amountOutUsd) {
          const outUsd = parseFloat(quote.quote.amountOutUsd);
          const rate = outUsd / testAmountUSD;
          const edge: Edge = { fromId: pair.from.assetId, toId: pair.to.assetId, rate, timestamp: Date.now() };
          const key = `${edge.fromId}|${edge.toId}`;
          if (!this.edges.has(key)) {
            this.edges.set(key, edge);
            this.appendEdgeToCache(edge);
          }
        }
      } catch (e) { }
      completed++;
      if (completed % 100 === 0) console.log(`Progress: ${completed}/${pairs.length}, edges: ${this.edges.size}`);
      return null;
    }));
    await Promise.all(tasks);
    console.log(`✅ Topology built: ${this.edges.size} edges found.`);
  }

  private loadCache(): void {
    try {
      if (!fs.existsSync(this.cachePath)) return;
      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      for (const item of data.edges) {
        this.edges.set(item.key, {
          fromId: item.fromId,
          toId: item.toId,
          rate: item.rate,
          timestamp: item.timestamp,
        });
      }
      console.log(`📂 Loaded ${this.edges.size} edges from cache`);
    } catch (err) {
      console.warn('Failed to load cache', err);
    }
  }

  scheduleUpdate(fromId: string, toId: string, priority = 5): void {
    const key = `${fromId}|${toId}`;
    const existing = this.edges.get(key);
    if (existing && (Date.now() - existing.timestamp) < 60000) return;
    const from = this.tokenMap.get(fromId);
    const to = this.tokenMap.get(toId);
    if (!from || !to) return;

    const testAmountUSD = config.trading.testAmountUSD;
    const amountIn = this.usdToAmount(testAmountUSD, parseFloat(from.price), from.decimals);
    this.queue.add({
      originAsset: fromId,
      destinationAsset: toId,
      amount: amountIn,
      dry: true,
      quoteWaitingTimeMs: 3000,
    }, priority)
      .then(quote => {
        if (quote?.quote?.amountOutUsd) {
          const outUsd = parseFloat(quote.quote.amountOutUsd);
          const rate = outUsd / testAmountUSD;
          const edge: Edge = { fromId, toId, rate, timestamp: Date.now() };
          this.edges.set(key, edge);
          this.appendEdgeToCache(edge);
        } else {
          if (this.edges.has(key)) {
            this.edges.delete(key);
            this.appendEdgeToCache({ fromId, toId, rate: 0, timestamp: 0 } as Edge); // удалить
          }
        }
      })
      .catch(() => {
        if (this.edges.has(key)) {
          this.edges.delete(key);
          this.appendEdgeToCache({ fromId, toId, rate: 0, timestamp: 0 } as Edge);
        }
      });
  }

  startPeriodicUpdates(intervalMs = 30000): void {
    if (this.updateTimer) clearInterval(this.updateTimer);
    this.updateTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, edge] of this.edges.entries()) {
        if (now - edge.timestamp > 60000) {
          const [fromId, toId] = key.split('|');
          this.scheduleUpdate(fromId, toId, 5);
        }
      }
    }, intervalMs);
  }

  getRate(fromId: string, toId: string): number | undefined {
    return this.edges.get(`${fromId}|${toId}`)?.rate;
  }

  getTokens(): Token[] {
    return this.allTokens;
  }

  getNeighbors(assetId: string): Token[] {
    const neighbors: Token[] = [];
    for (const [key, edge] of this.edges.entries()) {
      if (key.startsWith(assetId + '|')) {
        const toId = key.split('|')[1];
        const toToken = this.tokenMap.get(toId);
        if (toToken) neighbors.push(toToken);
      }
    }
    // Логируем только если запрашиваем стейбл (для отладки)
    const token = this.tokenMap.get(assetId);
    if (token && config.stableSymbols.includes(token.symbol)) {
      console.log(`    Neighbors for ${token.symbol} (${token.blockchain}): ${neighbors.map(n => `${n.symbol}(${n.blockchain})`).join(', ')}`);
    }
    return neighbors;
  }

  getEdgesCount(): number {
    return this.edges.size;
  }

  stop(): void {
    if (this.updateTimer) clearInterval(this.updateTimer);
  }
}