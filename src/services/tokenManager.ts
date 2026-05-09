import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';

export interface TokenDirectionalLiquidity {
  token: Token;
  // Направление стейбл → токен (покупка)
  canBuy: boolean;
  buyFromStable?: {
    stable: Token;
    amountOutUsd: number;   // сколько USD получаем токенов
    rate: number;           // amountOutUsd / testAmountUSD
  };
  // Направление токен → стейбл (продажа)
  canSell: boolean;
  sellToStable?: {
    stable: Token;
    amountOutUsd: number;   // сколько USD получаем обратно
    rate: number;
  };
}

export class TokenManager {
  private allTokensCache: Token[] | null = null;
  private cacheTime = 0;
  private ttl = 3600000;

  async getAllTokens(): Promise<Token[]> {
    if (this.allTokensCache && Date.now() - this.cacheTime < this.ttl) {
      return this.allTokensCache;
    }
    const tokens = await nearIntentsClient.getTokens();
    this.allTokensCache = tokens;
    this.cacheTime = Date.now();
    return tokens;
  }

  async getAllStablecoins(): Promise<Token[]> {
    const all = await this.getAllTokens();
    const symbols = config.stableSymbols || ['USDC', 'USDT', 'DAI', 'USDC.e', 'USDt'];
    const stables = all.filter(t =>
      symbols.includes(t.symbol) &&
      config.allowedBlockchains.includes(t.blockchain) &&
      parseFloat(t.price) > 0.5 && parseFloat(t.price) < 2
    );
    console.log(`💰 Найдено стейблкоинов: ${stables.length}`);
    return stables;
  }

  async getWorkingTokens(): Promise<Token[]> {
    const all = await this.getAllTokens();
    const stables = await this.getAllStablecoins();
    const stableIds = new Set(stables.map(s => s.assetId));
    const working = all.filter(t =>
      !stableIds.has(t.assetId) &&
      config.allowedBlockchains.includes(t.blockchain) &&
      parseFloat(t.price) > config.filters.minPrice &&
      parseFloat(t.price) < config.filters.maxPrice
    );
    const limited = working.slice(0, config.scan.maxWorkingTokens);
    console.log(`📋 Рабочих токенов (до фильтрации по ликвидности): ${limited.length}`);
    return limited;
  }

  private usdToAmount(usd: number, price: number, decimals: number): string {
    return Math.floor((usd / price) * 10 ** decimals).toString();
  }

  private getAddress(blockchain: string): string {
    if (blockchain === 'near') return config.addresses.near;
    if (['eth', 'arb', 'base', 'bsc', 'avax', 'pol', 'op'].includes(blockchain)) return config.addresses.evm;
    if (blockchain === 'sol') return config.addresses.sol;
    return config.addresses.near;
  }

  // Параллельная проверка ВСЕХ комбинаций (токен, стейбл) для обоих направлений
  async getTokensWithAnyLiquidity(
    workingTokens: Token[],
    stables: Token[],
    testAmountUSD: number
  ): Promise<TokenDirectionalLiquidity[]> {
    if (workingTokens.length === 0 || stables.length === 0) return [];

    console.log(`🚀 Параллельная проверка ${workingTokens.length} токенов с ${stables.length} стейблами (всего комбинаций: ${workingTokens.length * stables.length * 2})...`);

    // Генерируем задания для каждого направления отдельно
    interface Job {
      token: Token;
      stable: Token;
      direction: 'buy' | 'sell'; // buy: stable→token, sell: token→stable
    }
    const jobs: Job[] = [];
    for (const token of workingTokens) {
      for (const stable of stables) {
        jobs.push({ token, stable, direction: 'buy' });
        jobs.push({ token, stable, direction: 'sell' });
      }
    }

    const concurrency = 10;
    const results: { tokenAssetId: string; stableAssetId: string; direction: 'buy' | 'sell'; amountOutUsd: number; rate: number }[] = [];
    const queue = [...jobs];
    let completed = 0;

    const worker = async () => {
      while (queue.length) {
        const job = queue.shift()!;
        try {
          if (job.direction === 'buy') {
            // stable → token
            const amountIn = this.usdToAmount(testAmountUSD, parseFloat(job.stable.price), job.stable.decimals);
            const quote = await nearIntentsClient.getQuote({
              originAsset: job.stable.assetId,
              destinationAsset: job.token.assetId,
              amount: amountIn,
              depositType: job.stable.blockchain === 'near' ? 'INTENTS' : 'ORIGIN_CHAIN',
              recipientType: 'DESTINATION_CHAIN',
              recipient: this.getAddress(job.token.blockchain),
              refundTo: this.getAddress(job.stable.blockchain),
              dry: true,
            });
            if (quote.quote?.amountOutUsd) {
              const outUsd = parseFloat(quote.quote.amountOutUsd);
              if (outUsd >= testAmountUSD * config.scan.minLiquidityRatio) {
                results.push({
                  tokenAssetId: job.token.assetId,
                  stableAssetId: job.stable.assetId,
                  direction: 'buy',
                  amountOutUsd: outUsd,
                  rate: outUsd / testAmountUSD,
                });
              }
            }
          } else {
            // token → stable
            const amountIn = this.usdToAmount(testAmountUSD, parseFloat(job.token.price), job.token.decimals);
            const quote = await nearIntentsClient.getQuote({
              originAsset: job.token.assetId,
              destinationAsset: job.stable.assetId,
              amount: amountIn,
              depositType: job.token.blockchain === 'near' ? 'INTENTS' : 'ORIGIN_CHAIN',
              recipientType: 'INTENTS',
              recipient: config.addresses.near,
              refundTo: this.getAddress(job.token.blockchain),
              dry: true,
            });
            if (quote.quote?.amountOutUsd) {
              const outUsd = parseFloat(quote.quote.amountOutUsd);
              if (outUsd >= testAmountUSD * config.scan.minLiquidityRatio) {
                results.push({
                  tokenAssetId: job.token.assetId,
                  stableAssetId: job.stable.assetId,
                  direction: 'sell',
                  amountOutUsd: outUsd,
                  rate: outUsd / testAmountUSD,
                });
              }
            }
          }
        } catch (err) {
          // нет ликвидности — пропускаем
        }
        completed++;
        if (completed % 100 === 0) console.log(`   Прогресс: ${completed}/${jobs.length}`);
      }
    };

    const workers = Array(concurrency).fill(null).map(() => worker());
    await Promise.all(workers);

    // Группируем по токену, собираем лучшие направления (максимальный rate для каждого направления)
    const tokenMap = new Map<string, TokenDirectionalLiquidity>();
    for (const token of workingTokens) {
      tokenMap.set(token.assetId, {
        token,
        canBuy: false,
        canSell: false,
      });
    }

    for (const res of results) {
      const entry = tokenMap.get(res.tokenAssetId);
      if (!entry) continue;
      const stable = stables.find(s => s.assetId === res.stableAssetId)!;
      if (res.direction === 'buy') {
        if (!entry.canBuy || res.rate > (entry.buyFromStable?.rate || 0)) {
          entry.canBuy = true;
          entry.buyFromStable = { stable, amountOutUsd: res.amountOutUsd, rate: res.rate };
        }
      } else {
        if (!entry.canSell || res.rate > (entry.sellToStable?.rate || 0)) {
          entry.canSell = true;
          entry.sellToStable = { stable, amountOutUsd: res.amountOutUsd, rate: res.rate };
        }
      }
    }

    const output = Array.from(tokenMap.values());
    const withAny = output.filter(t => t.canBuy || t.canSell);
    console.log(`💾 Токенов с хотя бы одним направлением ликвидности: ${withAny.length} из ${output.length}`);
    for (const t of withAny) {
      const buyInfo = t.canBuy ? `купить за ${t.buyFromStable!.stable.symbol} (${(t.buyFromStable!.rate * 100).toFixed(2)}%)` : '';
      const sellInfo = t.canSell ? `продать за ${t.sellToStable!.stable.symbol} (${(t.sellToStable!.rate * 100).toFixed(2)}%)` : '';
      console.log(`   ✅ ${t.token.symbol} (${t.token.blockchain}): ${buyInfo} ${sellInfo}`.trim());
    }
    return withAny;
  }
}

export const tokenManager = new TokenManager();