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
    console.log(`🔍 Поиск циклов: ${stables.length} стабильных токенов, ${tokens.length} всего токенов`);

    if (stables.length === 0) {
      console.warn('Нет стабильных токенов в графе!');
      return;
    }

    for (const start of stables) {
      console.log(`  Запуск DFS от ${start.symbol}...`);
      const beforeSize = this.visitedCycles.size;
      await this.dfs([start], start.assetId, config.scan.maxCycleLength + 1, callback);
      const afterSize = this.visitedCycles.size;
      console.log(`    Найдено циклов от ${start.symbol}: ${afterSize - beforeSize}`);
    }
  }

  private async dfs(
    path: Token[],
    startId: string,
    maxDepth: number,
    callback: (cycle: { path: Token[] }) => Promise<void>
  ): Promise<void> {
    const last = path[path.length - 1];
    const depth = path.length;

    // Логируем текущую вершину на глубине 1-2
    if (depth <= 2) {
      console.log(`    DFS глубина ${depth}: ${path.map(t => t.symbol).join('→')}`);
    }

    if (depth >= 2 && last.assetId === startId) {
      const cycleKey = path.map(t => t.assetId).join('|');
      if (!this.visitedCycles.has(cycleKey)) {
        this.visitedCycles.add(cycleKey);
        console.log(`✅ НАЙДЕН ЦИКЛ: ${path.map(t => t.symbol).join('→')}`);
        await callback({ path: [...path] });
      }
      return;
    }
    if (depth >= maxDepth) return;

    const neighbors = this.graphManager.getNeighbors(last.assetId);
    if (depth === 1) {
      console.log(`      У ${last.symbol} найдено соседей: ${neighbors.length}`);
    }

    for (const next of neighbors) {
      if (next.assetId === startId && depth >= 2) {
        await this.dfs([...path, next], startId, maxDepth, callback);
      } else if (!path.includes(next)) {
        await this.dfs([...path, next], startId, maxDepth, callback);
      }
    }
  }
}