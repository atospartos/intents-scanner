import { Token } from '../clients/nearIntentsClient';
import { logger } from '../utils/logger';
import { fileStorage, StoredPath } from './fileStorage';

export interface ArbitragePath {
  id: string;
  tokens: Token[];
  startStable: Token;
  endStable: Token;
  workingTokens: Token[];
  length: number;
  steps: string[];
}

export class PathGenerator {
  
  generatePaths(
    stablecoins: Token[],
    workingTokens: Token[],
    pathLength: number
  ): ArbitragePath[] {
    if (pathLength < 3 || pathLength > 5) {
      throw new Error('Длина пути должна быть 3, 4 или 5');
    }
    
    const paths: ArbitragePath[] = [];
    const intermediateCount = pathLength - 2;
    
    for (const startStable of stablecoins) {
      for (const endStable of stablecoins) {
        if (intermediateCount === 1) {
          // Длина 3: Stable → Working → Stable
          for (const working of workingTokens) {
            paths.push(this.createPath(
              [startStable, working, endStable],
              startStable, endStable, [working], pathLength
            ));
          }
        } else if (intermediateCount === 2) {
          // Длина 4: Stable → Working1 → Working2 → Stable
          for (let i = 0; i < workingTokens.length; i++) {
            for (let j = 0; j < workingTokens.length; j++) {
              if (i !== j) {
                paths.push(this.createPath(
                  [startStable, workingTokens[i], workingTokens[j], endStable],
                  startStable, endStable, [workingTokens[i], workingTokens[j]], pathLength
                ));
              }
            }
          }
        } else if (intermediateCount === 3) {
          // Длина 5: Stable → Working1 → Working2 → Working3 → Stable
          for (let i = 0; i < workingTokens.length; i++) {
            for (let j = 0; j < workingTokens.length; j++) {
              if (i === j) continue;
              for (let k = 0; k < workingTokens.length; k++) {
                if (k === i || k === j) continue;
                paths.push(this.createPath(
                  [startStable, workingTokens[i], workingTokens[j], workingTokens[k], endStable],
                  startStable, endStable, [workingTokens[i], workingTokens[j], workingTokens[k]], pathLength
                ));
              }
            }
          }
        }
      }
    }
    
    logger.debug(`Сгенерировано ${paths.length} путей длины ${pathLength}`);
    return paths;
  }

  generateAllPaths(
    stablecoins: Token[],
    workingTokens: Token[],
    pathLengths: number[]
  ): Record<number, ArbitragePath[]> {
    const result: Record<number, ArbitragePath[]> = {};
    
    for (const length of pathLengths) {
      result[length] = this.generatePaths(stablecoins, workingTokens, length);
    }
    
    const total = Object.values(result).reduce((sum, p) => sum + p.length, 0);
    logger.info(`Всего сгенерировано путей: ${total}`);
    
    return result;
  }

  generateAndSavePaths(
    stablecoins: Token[],
    workingTokens: Token[],
    pathLength: number
  ): ArbitragePath[] {
    const paths = this.generatePaths(stablecoins, workingTokens, pathLength);
    
    // Сохраняем пути в файл
    const storedPaths: StoredPath[] = paths.map(p => ({
      id: p.id,
      path: p.steps,
      steps: p.steps,
      startStable: p.startStable.symbol,
      endStable: p.endStable.symbol,
      workingTokens: p.workingTokens.map(t => t.symbol),
      profitHistory: [],
      avgProfit: 0,
      lastChecked: Date.now(),
      successCount: 0,
      failCount: 0,
    }));
    
    fileStorage.savePaths(storedPaths, pathLength);
    logger.info(`✅ Пути длины ${pathLength} сгенерированы и сохранены: ${paths.length} путей`);
    
    return paths;
  }

  loadPathsFromFile(
    stablecoins: Token[],
    workingTokens: Token[],
    pathLength: number
  ): ArbitragePath[] | null {
    const stored = fileStorage.loadPaths(pathLength);
    if (!stored || !stored.paths || stored.paths.length === 0) {
      return null;
    }
    
    const allTokens = [...stablecoins, ...workingTokens];
    const paths: ArbitragePath[] = stored.paths.map(sp => {
      const tokens = sp.steps.map(symbol => 
        allTokens.find(t => t.symbol === symbol)
      ).filter((t): t is Token => t !== undefined);
      
      return {
        id: sp.id,
        tokens,
        steps: sp.steps,
        startStable: allTokens.find(t => t.symbol === sp.startStable)!,
        endStable: allTokens.find(t => t.symbol === sp.endStable)!,
        workingTokens: sp.workingTokens.map(s => allTokens.find(t => t.symbol === s)!).filter(t => t !== undefined),
        length: pathLength,
      };
    });
    
    logger.info(`📂 Загружены пути длины ${pathLength} из файла: ${paths.length} путей`);
    return paths;
  }

  private createPath(
    tokens: Token[],
    startStable: Token,
    endStable: Token,
    workingTokens: Token[],
    length: number
  ): ArbitragePath {
    const steps = tokens.map(t => t.symbol);
    const id = `${startStable.symbol}→${workingTokens.map(w => w.symbol).join('→')}→${endStable.symbol}`;
    
    return { id, tokens, startStable, endStable, workingTokens, length, steps };
  }
}

export const pathGenerator = new PathGenerator();