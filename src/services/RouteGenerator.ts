// services/RouteGenerator.ts
import { Token } from '../clients/nearIntentsClient';
import { GraphManager } from './GraphManager';
import { config } from '../config';

export class RouteGenerator {
  private graphManager: GraphManager;
  private visitedCycles = new Set<string>();

  constructor(graphManager: GraphManager) {
    this.graphManager = graphManager;
  }

  async findAndEmitCycles(callback: (cycle: { path: Token[] }) => Promise<void>): Promise<void> {
    const tokens = this.graphManager.getTokens();
    const stables = tokens.filter(t => config.stableSymbols.includes(t.symbol));
    console.log(`\n🔄 Searching cycles among ${tokens.length} tokens, stables: ${stables.map(s => `${s.symbol}(${s.blockchain})`).join(', ')}`);
    let totalCycles = 0;
    for (const start of stables) {
      console.log(`  Starting from ${start.symbol} (${start.blockchain})...`);
      await this.dfs([start], start.assetId, config.scan.maxCycleLength + 1, async (cycle) => {
        if (cycle) {
          totalCycles++;
          await callback(cycle);
        }
      });
    }
    console.log(`✅ Cycle search finished. Total unique cycles found: ${totalCycles}`);
  }

  private async dfs(
    path: Token[],
    startId: string,
    maxDepth: number,
    callback: (cycle: { path: Token[] } | null) => Promise<void>
  ): Promise<void> {
    const last = path[path.length - 1];
    // Разрешаем замыкание цикла для длины >= 2 (ранее было >2)
    if (path.length >= 2 && last.assetId === startId) {
      const cycleKey = path.map(t => t.assetId).join('|');
      if (!this.visitedCycles.has(cycleKey)) {
        this.visitedCycles.add(cycleKey);
        await callback({ path: [...path] });
      }
      return;
    }
    if (path.length >= maxDepth) return;

    const neighbors = this.graphManager.getNeighbors(last.assetId);
    for (const next of neighbors) {
      // Разрешаем замыкание на стартовый токен, даже если он уже есть в пути
      if (next.assetId === startId && path.length >= 2) {
        await this.dfs([...path, next], startId, maxDepth, callback);
      } else if (!path.includes(next)) {
        await this.dfs([...path, next], startId, maxDepth, callback);
      }
    }
  }
}