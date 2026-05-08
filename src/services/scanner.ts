import { Token } from '../clients/nearIntentsClient';
import { nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';

export interface Opportunity {
  id: string;
  path: ArbitragePath;
  grossSpreadPercent: number;
  netSpreadPercent: number;   // 60% от gross
  netSpreadUSD: number;
  amountUSD: number;
  minAmountOut: string;
  timestamp: number;
}

// мы передадим PathGenerator и TokenManager
export class Scanner {
  private opportunitiesFile = path.join(process.cwd(), 'storage', 'opportunities.json');
  private lastScanTimestamp = 0;

  async scanAndSave() {
    try {
      // 1. Get tokens
      const { stablecoins, workingTokens } = await tokenManager.getAllTradingTokens();
      if (stablecoins.length === 0 || workingTokens.length === 0) {
        logger.warn('Нет токенов для сканирования');
        return;
      }

      // 2. Generate paths (length 4)
      const pathGen = new PathGenerator();
      const paths = pathGen.generatePaths(stablecoins, workingTokens);
      if (paths.length === 0) return;

      logger.info(`🔎 Сканируем ${paths.length} путей (тестовая сумма $${config.scan.testAmountUSD})`);

      const opportunities: Opportunity[] = [];
      for (const p of paths) {
        const startAsset = p.startStable.assetId;
        const endAsset = p.endStable.assetId;
        const amountIn = (config.scan.testAmountUSD * 10 ** p.startStable.decimals).toString();

        try {
          const quote = await nearIntentsClient.getQuote(startAsset, endAsset, amountIn, true);
          if (!quote.quote?.amountOutUsd) continue;

          const amountOutUsd = parseFloat(quote.quote.amountOutUsd);
          const grossSpreadUSD = amountOutUsd - config.scan.testAmountUSD;
          const grossSpreadPercent = (grossSpreadUSD / config.scan.testAmountUSD) * 100;

          if (grossSpreadPercent >= config.scan.minProfitPercent) {
            const takePercent = 0.6; // 60%
            const netSpreadPercent = grossSpreadPercent * takePercent;
            const netSpreadUSD = grossSpreadUSD * takePercent;
            const targetUsd = config.scan.testAmountUSD + netSpreadUSD;
            const minAmountOut = (targetUsd / parseFloat(p.endStable.price)) * (10 ** p.endStable.decimals);

            opportunities.push({
              id: p.id,
              path: p,
              grossSpreadPercent,
              netSpreadPercent,
              netSpreadUSD,
              amountUSD: config.scan.testAmountUSD,
              minAmountOut: Math.floor(minAmountOut).toString(),
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          // просто лог
        }
      }

      // Сортируем по netSpreadPercent
      opportunities.sort((a,b) => b.netSpreadPercent - a.netSpreadPercent);
      await this.saveOpportunities(opportunities);
      logger.info(`💾 Сохранено ${opportunities.length} возможностей в opportunities.json`);
    } catch (err) {
      logger.error(`Ошибка сканирования: ${err.message}`);
    }
  }

  private async saveOpportunities(opps: Opportunity[]) {
    await fs.mkdir(path.dirname(this.opportunitiesFile), { recursive: true });
    await fs.writeFile(this.opportunitiesFile, JSON.stringify(opps, null, 2));
  }

  async startLoop() {
    while (true) {
      await this.scanAndSave();
      await new Promise(r => setTimeout(r, config.scan.intervalSec * 1000));
    }
  }
}