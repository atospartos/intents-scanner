import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

interface LiquidTokenCache {
  timestamp: number;
  tokens: Token[];
}

export class TokenManager {
  private cache: LiquidTokenCache | null = null;
  private cacheTTL = 5 * 60 * 1000; // 5 минут

  async getStablecoins(): Promise<Token[]> {
    const allTokens = await this.getTokens();
    const stablecoins = allTokens.filter(t =>
      config.tokens.stablecoinSymbols.includes(t.symbol) &&
      t.blockchain === 'near' &&
      parseFloat(t.price) > 0 &&
      !t.assetId.includes('.omft.near')
    );
    if (stablecoins.length === 0) throw new Error('Нет стейблкоина на NEAR');
    const usdc = stablecoins.find(s => s.symbol === 'USDC');
    return usdc ? [usdc] : [stablecoins[0]];
  }

  async getTokens(): Promise<Token[]> {
    return await nearIntentsClient.getTokens();
  }

  async getLiquidTokens(forceRefresh = false): Promise<Token[]> {
    if (!forceRefresh && this.cache && (Date.now() - this.cache.timestamp) < this.cacheTTL) {
      logger.info(`📦 Использую кэш токенов (${this.cache.tokens.length})`);
      return this.cache.tokens;
    }

    const allTokens = await this.getTokens();
    const stablecoins = await this.getStablecoins();
    const usdc = stablecoins[0];

    // Кандидаты: bridged-токены не-стейблы с разрешёнными блокчейнами
    const candidates = allTokens.filter(t =>
      t.assetId.includes('.omft.near') &&
      !config.tokens.stablecoinSymbols.includes(t.symbol) &&
      config.tokens.allowedBlockchains.includes(t.blockchain) &&
      parseFloat(t.price) > 0.01
    );

    logger.info(`🔍 Параллельная проверка ликвидности ${candidates.length} токенов (dry:true, $${config.scan.testAmountUSD})`);

    // Параллельная проверка с ограничением 10 одновременных запросов
    const liquidTokens = await this.checkLiquidityParallel(candidates, usdc);
    this.cache = { timestamp: Date.now(), tokens: liquidTokens };

    // Сохраняем в файл для возможности перезагрузки после рестарта
    await this.saveTokensToFile(stablecoins, liquidTokens);

    logger.info(`✅ Найдено ликвидных токенов: ${liquidTokens.length}`);
    return liquidTokens;
  }

  /**
   * Параллельная проверка с ограничением concurrency = 10
   */
  private async checkLiquidityParallel(candidates: Token[], usdc: Token): Promise<Token[]> {
    const results: Token[] = [];
    const concurrency = 10;
    let index = 0;

    async function worker(pool: Promise<void>[]): Promise<void> {
      while (index < candidates.length) {
        const idx = index++;
        const token = candidates[idx];
        const isLiquid = await this.checkTokenLiquidity(token, usdc);
        if (isLiquid) results.push(token);
        // Логируем прогресс каждые 10%
        if ((idx + 1) % Math.ceil(candidates.length / 10) === 0) {
          logger.info(`   Прогресс: ${idx + 1}/${candidates.length}`);
        }
      }
      // Сигнал, что воркер закончил
      pool.forEach((p, i) => { if (p === Promise.resolve()) pool.splice(i, 1); });
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker.call(this, workers));
    }
    await Promise.all(workers);
    return results;
  }

  private async checkTokenLiquidity(token: Token, usdc: Token): Promise<boolean> {
    // Проверяем своп USDC -> токен на небольшую сумму (1 USDC)
    const amountIn = (1 * 10 ** usdc.decimals).toString();
    try {
      const quote = await nearIntentsClient.getQuote(
        usdc.assetId,
        token.assetId,
        amountIn,
        true // dry
      );
      if (quote.quote?.amountOutUsd) {
        const outUsd = parseFloat(quote.quote.amountOutUsd);
        // Если хотя бы 0.9 USD получили – ликвидно
        return outUsd > 0.9;
      }
      return false;
    } catch (err) {
      logger.debug(`Токен ${token.symbol} (${token.blockchain}) неликвид: ${err.message}`);
      return false;
    }
  }

  private async saveTokensToFile(stablecoins: Token[], liquidTokens: Token[]) {
    const filePath = path.join(process.cwd(), 'storage', 'tokens_cache.json');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      timestamp: Date.now(),
      stablecoins,
      liquidTokens
    }, null, 2));
  }

  async getAllTradingTokens(): Promise<{ stablecoins: Token[]; workingTokens: Token[] }> {
    const [stablecoins, workingTokens] = await Promise.all([
      this.getStablecoins(),
      this.getLiquidTokens()
    ]);
    // Можно ограничить количество рабочих токенов, чтобы пути не взрывались
    const limited = workingTokens.slice(0, config.scan.maxPathsPerScan ? 300 : 300);
    return { stablecoins, workingTokens: limited };
  }
}

export const tokenManager = new TokenManager();