import { Token } from '../clients/nearIntentsClient';
import { logger } from '../utils/logger';

export interface ArbitragePath {
  id: string;
  tokens: Token[];       // [startStable, working1, working2, endStable]
  startStable: Token;
  endStable: Token;
  workingTokens: Token[];
  steps: string[];       // символы
}

export class PathGenerator {
  generatePaths(stablecoins: Token[], workingTokens: Token[]): ArbitragePath[] {
    const paths: ArbitragePath[] = [];
    for (const startStable of stablecoins) {
      for (const endStable of stablecoins) {
        if (startStable.assetId !== endStable.assetId) continue; // один и тот же USDC

        for (let i = 0; i < workingTokens.length; i++) {
          for (let j = 0; j < workingTokens.length; j++) {
            if (i === j) continue;
            const tokenA = workingTokens[i];
            const tokenB = workingTokens[j];
            // Необязательное условие: блокчейны разные для A и B
            if (tokenA.blockchain === tokenB.blockchain) continue;

            const tokens = [startStable, tokenA, tokenB, endStable];
            const steps = tokens.map(t => t.symbol);
            const id = `${startStable.symbol}→${tokenA.symbol}→${tokenB.symbol}→${endStable.symbol}`;
            paths.push({
              id,
              tokens,
              startStable,
              endStable,
              workingTokens: [tokenA, tokenB],
              steps,
            });
            if (paths.length >= 1000) break;
          }
          if (paths.length >= 1000) break;
        }
        if (paths.length >= 1000) break;
      }
      if (paths.length >= 1000) break;
    }
    logger.info(`🌀 Сгенерировано ${paths.length} путей (3 шага)`);
    return paths;
  }
}