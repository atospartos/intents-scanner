// services/RouteVerifier.ts
import { RateLimitedQueue } from './RateLimitedQueue';
import { GraphManager } from './GraphManager';
import { ScannedRoute, fileStorage } from './fileStorage';
import { config } from '../config';
import { Token } from '../clients/nearIntentsClient';

export class RouteVerifier {
  private queue: RateLimitedQueue;
  private graphManager: GraphManager;
  private cache: Map<string, { rate: number; timestamp: number }> = new Map();
  private cacheTTL = 2000;

  constructor(graphManager: GraphManager, queue: RateLimitedQueue) {
    this.graphManager = graphManager;
    this.queue = queue;
  }

  private async getRate(from: Token, to: Token, amountInRaw: string): Promise<number | null> {
    const key = `${from.assetId}|${to.assetId}|${amountInRaw}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.rate;
    }
    try {
      const quote = await this.queue.add({
        originAsset: from.assetId,
        destinationAsset: to.assetId,
        amount: amountInRaw,
        dry: true,
        quoteWaitingTimeMs: 5000,
      }, 0);
      if (quote?.quote?.amountOutUsd) {
        const inUsd = parseFloat(quote.quote.amountInUsd);
        const outUsd = parseFloat(quote.quote.amountOutUsd);
        const rate = outUsd / inUsd;
        this.cache.set(key, { rate, timestamp: Date.now() });
        return rate;
      }
    } catch (e) {}
    return null;
  }

  async verifyRoute(cycle: { path: Token[] }): Promise<ScannedRoute | null> {
    const { path } = cycle;
    const testAmountUSD = config.trading.testAmountUSD;
    const startToken = path[0];
    const startPrice = parseFloat(startToken.price);
    if (isNaN(startPrice)) return null;
    const startAmountRaw = Math.floor((testAmountUSD / startPrice) * Math.pow(10, startToken.decimals)).toString();

    const stepPromises: Promise<number | null>[] = [];
    for (let i = 0; i < path.length; i++) {
      const from = path[i];
      const to = path[(i + 1) % path.length];
      if (from.assetId === to.assetId) continue;
      stepPromises.push(this.getRate(from, to, startAmountRaw));
    }
    const rates = await Promise.all(stepPromises);
    if (rates.some(r => r === null)) return null;

    let totalRate = 1;
    for (const r of rates) totalRate *= r!;
    const profitPercent = (totalRate - 1) * 100;

    if (profitPercent >= config.scan.minProfitPercent && profitPercent < 50) {
      const scannedRoute: ScannedRoute = {
        id: path.map(t => t.symbol).join('→'),
        pathStr: path.map(t => `${t.symbol}(${t.blockchain})`).join(' → '),
        profitPercent,
        testAmountUSD,
        tokensInfo: path.map(t => ({
          symbol: t.symbol,
          assetId: t.assetId,
          blockchain: t.blockchain,
          decimals: t.decimals,
        })),
      };
      fileStorage.saveProfitableCycle(scannedRoute);
      console.log(`💰 New profitable route: ${scannedRoute.pathStr} (${profitPercent.toFixed(4)}%)`);
      return scannedRoute;
    }
    return null;
  }
}