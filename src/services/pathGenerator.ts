import { Token } from '../clients/nearIntentsClient';

export interface ArbitragePath {
  id: string;
  tokens: Token[];          // [stable, tokenA, tokenB, stable]
  steps: Array<{
    from: Token;
    to: Token;
    depositType: 'INTENTS' | 'ORIGIN_CHAIN' | 'DESTINATION_CHAIN';
    recipientType: 'INTENTS' | 'ORIGIN_CHAIN' | 'DESTINATION_CHAIN';
  }>;
}

export class PathGenerator {
  generatePaths(stable: Token, workingTokens: Token[]): ArbitragePath[] {
    const paths: ArbitragePath[] = [];
    for (const tokenA of workingTokens) {
      for (const tokenB of workingTokens) {
        if (tokenA.assetId === tokenB.assetId) continue;
        const tokens = [stable, tokenA, tokenB, stable];
        const steps = [
          {
            from: stable, to: tokenA,
            depositType: 'INTENTS' as const,
            recipientType: 'DESTINATION_CHAIN' as const,
          },
          {
            from: tokenA, to: tokenB,
            depositType: 'ORIGIN_CHAIN' as const,
            recipientType: 'DESTINATION_CHAIN' as const,
          },
          {
            from: tokenB, to: stable,
            depositType: 'ORIGIN_CHAIN' as const,
            recipientType: 'INTENTS' as const,
          },
        ];
        const id = `${stable.symbol}(${stable.blockchain})→${tokenA.symbol}(${tokenA.blockchain})→${tokenB.symbol}(${tokenB.blockchain})→${stable.symbol}(${stable.blockchain})`;
        paths.push({ id, tokens, steps });
      }
    }
    console.log(`📈 Сгенерировано ${paths.length} маршрутов`);
    return paths;
  }
}

export const pathGenerator = new PathGenerator();