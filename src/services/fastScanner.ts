import { Token } from '../clients/nearIntentsClient';
import { RateCache } from './rateCache';
import { config } from '../config';
import { fileStorage, CycleResult, ScannedRoute } from './fileStorage';

export class FastScanner {
  constructor(private rateCache: RateCache, private testAmountUSD: number) { }

  async findProfitableCycles(
    allTokens: Token[],          // все токены (и стейблы, и рабочие)
    minProfitPercent: number,
    maxSteps: number,
    includeStableCycles: boolean,
    includeAltcoinCycles: boolean
  ): Promise<CycleResult[]> {
    const cycles: CycleResult[] = [];
    const visitedTokens = new Set<string>();

    const dfs = (path: Token[], currentProfit: number, startTokenId: string) => {
      const last = path[path.length - 1];
      // Замкнули цикл? (вернулись к стартовому токену и длина >= 2)
      if (path.length > 2 && last.assetId === startTokenId) {
        const profitPercent = (currentProfit - 1) * 100;
        if (profitPercent >= minProfitPercent && path.length <= maxSteps + 1) {
          const testAmountUSD = this.testAmountUSD;
          const usdOut = testAmountUSD * currentProfit;
          const route: ScannedRoute = {
            id: path.map(t => t.symbol).join('→'),
            pathStr: path.map(t => `${t.symbol}(${t.blockchain})`).join(' → '),
            profitPercent,
            testAmountUSD,
            tokensInfo: path.map(token => ({
              symbol: token.symbol,
              assetId: token.assetId,
              blockchain: token.blockchain,
              decimals: token.decimals,
            })),
          };
          // Сохраняем в profitable_cycles.json
          fileStorage.saveProfitableCycle(route);
        }
        return;
      }
      if (path.length > maxSteps + 1) return;

      for (const next of allTokens) {
        if (next.assetId === last.assetId) continue;
        // Правила включения:
        // - Если включены только стейбловые циклы, то разрешаем только если хотя бы один узел – стейбл
        // - Если включены только альткоиновые, то запрещаем стейблы
        const isStable = config.stableSymbols.includes(next.symbol);
        if (!includeStableCycles && isStable && path.length > 1) continue;
        if (!includeAltcoinCycles && !isStable) continue;

        const rate = this.rateCache.getRate(last.assetId, next.assetId);
        if (!rate) continue;
        const newProfit = currentProfit * rate;
        if (newProfit < 0.99 && path.length > 1) continue; // обрезка заведомо убыточных
        dfs([...path, next], newProfit, startTokenId);
      }
    };

    console.log(`🔍 Поиск замкнутых циклов (макс. шагов: ${maxSteps}, порог прибыли: ${minProfitPercent}%)...`);
    const startTime = Date.now();
    for (const start of allTokens) {
      if (visitedTokens.has(start.assetId)) continue;
      visitedTokens.add(start.assetId);
      dfs([start], 1, start.assetId);
    }
    console.log(`🔍 Быстрый поиск: найдено ${cycles.length} уникальных циклов за ${Date.now() - startTime} мс`);
    return cycles;
  }
}