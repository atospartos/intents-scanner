import { RateLimitedQueue } from './RateLimitedQueue';
import { GraphManager } from './GraphManager';
import { ScannedRoute, fileStorage } from './fileStorage';
import { config } from '../config';
import { Token } from '../clients/nearIntentsClient';

export class RouteVerifier {
  private queue: RateLimitedQueue;
  private graphManager: GraphManager;
  private cache: Map<string, { rate: number; timestamp: number }> = new Map();
  private cacheTTL = 60000;

  constructor(graphManager: GraphManager, queue: RateLimitedQueue) {
    this.graphManager = graphManager;
    this.queue = queue;
  }

  /**
   * Получает свежую котировку (высокий приоритет) и, если успешно,
   * обновляет граф через graphManager.updateEdge.
   */
  private async getRateAndUpdate(from: Token, to: Token, amountInRaw: string): Promise<number | null> {
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
        quoteWaitingTimeMs: 3000,
      }, 0);
      if (quote?.quote?.amountOutUsd && quote.quote.amountOut && parseFloat(quote.quote.amountOut) > 0) {
        const inUsd = parseFloat(quote.quote.amountInUsd);
        const outUsd = parseFloat(quote.quote.amountOutUsd);
        const rate = outUsd / inUsd;
        // Обновляем граф (перезаписываем ребро)
        this.graphManager.updateEdge(from.assetId, to.assetId, rate);
        // Кэшируем локально
        this.cache.set(key, { rate, timestamp: Date.now() });
        return rate;
      } else {
        console.warn(`RouteVerifier: no valid quote for ${from.symbol}->${to.symbol}`);
      }
    } catch (err) {
      console.error(`RouteVerifier: error getting quote for ${from.symbol}->${to.symbol}:`, err);
    }
    return null;
  }

  async verifyPath(path: Token[]): Promise<ScannedRoute | null> {
    if (path.length < 2) return null;
    const testAmountUSD = config.trading.testAmountUSD;
    const startToken = path[0];
    const startPrice = parseFloat(startToken.price);
    if (isNaN(startPrice)) return null;
    let currentAmountRaw = Math.floor((testAmountUSD / startPrice) * Math.pow(10, startToken.decimals)).toString();

    const stepRates: number[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const rate = await this.getRateAndUpdate(from, to, currentAmountRaw);
      if (rate === null) return null;
      stepRates.push(rate);
      currentAmountRaw = Math.floor(parseInt(currentAmountRaw) * rate).toString();
    }
    // Замыкающий шаг
    const last = path[path.length - 1];
    const first = path[0];
    const closingRate = await this.getRateAndUpdate(last, first, currentAmountRaw);
    if (closingRate === null) return null;
    stepRates.push(closingRate);

    let totalRate = 1;
    for (const r of stepRates) totalRate *= r;
    const profitPercent = (totalRate - 1) * 100;

    if (profitPercent >= config.scan.minProfitPercent && profitPercent < 50) {
      const fullPath = [...path, first];
      const scannedRoute: ScannedRoute = {
        id: fullPath.map(t => t.symbol).join('→'),
        pathStr: fullPath.map(t => `${t.symbol}(${t.blockchain})`).join(' → '),
        profitPercent,
        testAmountUSD,
        tokensInfo: fullPath.map(t => ({
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