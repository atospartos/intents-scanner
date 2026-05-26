import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';

export type Edge = {
  fromId: string;
  toId: string;
  rate: number;
  timestamp: number;
};

export class GraphManager {
  private edges: Map<string, Edge> = new Map();
  private tokenMap: Map<string, Token> = new Map();
  private allTokens: Token[] = [];
  private cachePath: string;

  constructor() {
    this.cachePath = path.join(process.cwd(), 'storage', 'rate_cache.json');
  }

  async init(): Promise<void> {
    const all = await nearIntentsClient.getTokens();
    this.allTokens = all.filter(t => config.whitelistAssets.includes(t.symbol) && config.allowedBlockchains.includes(t.blockchain));
    if (this.allTokens.length === 0) throw new Error('No whitelisted tokens');
    for (const t of this.allTokens) this.tokenMap.set(t.assetId, t);
    console.log(`📋 Loaded ${this.allTokens.length} whitelisted tokens`);

    await this.loadCache();
    // После await this.loadCache();
    console.log(`📊 После загрузки кэша: ${this.edges.size} рёбер`);
    if (this.edges.size > 0) {
      // Покажем первых 5 рёбер
      const sampleEdges = Array.from(this.edges.entries()).slice(0, 5);
      console.log('Примеры рёбер:');
      sampleEdges.forEach(([key, edge]) => {
        console.log(`  ${key} -> rate=${edge.rate}, timestamp=${new Date(edge.timestamp).toISOString()}`);
      });

      // Покажем соседей для первого токена в белом списке
      const firstToken = this.allTokens[0];
      if (firstToken) {
        const neighbors = this.getNeighbors(firstToken.assetId);
        console.log(`Соседи для ${firstToken.symbol}: ${neighbors.map(n => n.symbol).join(', ')}`);
      }
    } else {
      console.warn('⚠️ Кэш пуст! Рёбра не загружены.');
    }
    // await this.buildTopology(config.trading.testAmountUSD);
    console.log(`✅ Graph готов. Рёбер из кэша: ${this.edges.size}`);
  }

  private usdToAmount(usd: number, price: number, decimals: number): string {
    if (price <= 0) return '0';
    return Math.floor((usd / price) * Math.pow(10, decimals)).toString();
  }

  private async buildTopology(testAmountUSD: number): Promise<void> {
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
        if (quote?.quote?.amountOutUsd && quote.quote.amountOut && parseFloat(quote.quote.amountOut) > 0) {
          const outUsd = parseFloat(quote.quote.amountOutUsd);
          const rate = outUsd / testAmountUSD;
          if (rate > 0) {
            const edge: Edge = { fromId: pair.from.assetId, toId: pair.to.assetId, rate, timestamp: Date.now() };
            this.updateEdge(edge.fromId, edge.toId, edge.rate);
          }
        }
      } catch (err) {
        // console.warn(`Failed to get quote for ${pair.from.symbol}->${pair.to.symbol}: ${err}`);
      }
      completed++;
      if (completed % 100 === 0) console.log(`Progress: ${completed}/${pairs.length}, edges: ${this.edges.size}`);
    }));
    await Promise.all(tasks);
    console.log(`✅ Topology built: ${this.edges.size} edges found.`);
  }

  /**
   * Обновляет ребро в графе и в кэше (только если rate > 0).
   * Вызывается как при начальном построении, так и при успешной верификации.
   */
  updateEdge(fromId: string, toId: string, rate: number): void {
    if (rate <= 0) return;
    const key = `${fromId}|${toId}`;
    const edge: Edge = { fromId, toId, rate, timestamp: Date.now() };
    this.edges.set(key, edge);
    this.appendEdgeToCache(edge);
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

  private async loadCache(): Promise<void> {
    try {
      if (!fs.existsSync(this.cachePath)) return;
      const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
      for (const item of data.edges) {
        if (item.rate > 0) {
          this.edges.set(item.key, {
            fromId: item.fromId,
            toId: item.toId,
            rate: item.rate,
            timestamp: item.timestamp,
          });
        }
      }
      console.log(`📂 Loaded ${this.edges.size} valid edges from cache`);
    } catch (err) {
      console.warn('Failed to load cache', err);
    }
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
    return neighbors;
  }

  getEdgesCount(): number {
    return this.edges.size;
  }
}