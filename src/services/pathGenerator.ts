import fs from 'fs';
import path from 'path';
import { Token } from '../clients/nearIntentsClient';

export interface ArbitragePath {
  id: string;
  tokens: Token[];
  steps: Array<{
    from: Token;
    to: Token;
    depositType: 'INTENTS';
    recipientType: 'INTENTS';
  }>;
}

export class PathGenerator {
  generateAllPaths(stable: Token, workingTokens: Token[]): ArbitragePath[] {
    const paths: ArbitragePath[] = [];
    for (const dest of workingTokens) {
      for (const orig of workingTokens) {
        if (dest.assetId === orig.assetId) continue;
        const tokens = [stable, dest, orig, stable];
        const steps = [
          {
            from: stable, to: dest,
            depositType: 'INTENTS' as const,
            recipientType: 'INTENTS' as const,
          },
        ];
        const id = `${stable.symbol}→${dest.symbol}(${dest.blockchain})→${orig.symbol}(${orig.blockchain})→${stable.symbol}`;
        paths.push({ id, tokens, steps });
      }
    }
    console.log(`📈 Сгенерировано маршрутов: ${paths.length}`);
    return paths;
  }

  // Сохранить маршруты в файл (для отладки и возобновления)
  savePathsToFile(paths: ArbitragePath[], filename: string = 'generated_routes.json'): void {
    const dir = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    const serialized = paths.map(p => ({
      id: p.id,
      tokens: p.tokens.map(t => ({ symbol: t.symbol, assetId: t.assetId, blockchain: t.blockchain, decimals: t.decimals })),
      steps: p.steps.map(s => ({
        fromSymbol: s.from.symbol,
        fromId:s.from.assetId,
        toSymbol: s.to.symbol,
        toId:s.to.assetId,
        depositType: s.depositType,
        recipientType: s.recipientType,
      })),
    }));
    fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2));
    console.log(`💾 Маршруты сохранены в ${filePath}`);
  }
}

export const pathGenerator = new PathGenerator;