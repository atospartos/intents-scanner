// services/ArbitrageFinder.ts
import { Token } from '../clients/nearIntentsClient';
import { GraphManager } from './GraphManager';

export type Cycle = {
  path: Token[];
  profitPercent: number;
};

export class ArbitrageFinder {
  private graphManager: GraphManager;
  private tokens: Token[];
  private tokenIndex: Map<string, number>;

  constructor(graphManager: GraphManager) {
    this.graphManager = graphManager;
    this.tokens = graphManager.getTokens();
    this.tokenIndex = new Map(this.tokens.map((t, i) => [t.assetId, i]));
  }

  // Поиск всех циклов с отрицательным весом (прибыльных) ограниченной длины
  findProfitableCycles(maxSteps: number = 4): Cycle[] {
    const n = this.tokens.length;
    const dist: number[] = new Array(n).fill(Infinity);
    const prev: number[] = new Array(n).fill(-1);
    // стандартный Bellman-Ford для поиска отрицательных циклов
    // но нам нужны только циклы ограниченной длины, поэтому используем модификацию с BFS по уровням
    // Упростим: запустим Bellman-Ford из каждой вершины и найдём циклы длиной до maxSteps

    const cycles: Cycle[] = [];
    const visited = new Set<string>();

    for (let startIdx = 0; startIdx < n; startIdx++) {
      // Инициализация
      const distLocal = new Array(n).fill(Infinity);
      distLocal[startIdx] = 0;
      const relaxations = new Array(n).fill(null).map(() => ({} as Record<number, number>));
      // Для ограничения длины используем массив distByStep[step][node]
      const distByStep: number[][] = Array(maxSteps + 1).fill(null).map(() => new Array(n).fill(Infinity));
      distByStep[0][startIdx] = 0;

      for (let step = 1; step <= maxSteps; step++) {
        let updated = false;
        for (let u = 0; u < n; u++) {
          if (distByStep[step - 1][u] === Infinity) continue;
          const fromToken = this.tokens[u];
          for (let v = 0; v < n; v++) {
            if (u === v) continue;
            const rate = this.graphManager.getRate(fromToken.assetId, this.tokens[v].assetId);
            if (rate === undefined) continue;
            const weight = -Math.log(rate); // преобразование для аддитивности
            const newDist = distByStep[step - 1][u] + weight;
            if (newDist < distByStep[step][v]) {
              distByStep[step][v] = newDist;
              relaxations[step][v] = u;
              updated = true;
            }
          }
        }
        if (!updated) break;
      }

      // Проверяем, есть ли улучшение на шаге step (отрицательный цикл)
      for (let step = 1; step <= maxSteps; step++) {
        if (distByStep[step][startIdx] < 0) {
          // Найден цикл от startIdx до startIdx длиной step
          // Восстанавливаем путь
          const pathIndices: number[] = [startIdx];
          let current = startIdx;
          let s = step;
          while (s > 0 && current !== -1) {
            current = relaxations[s][current];
            if (current === undefined) break;
            pathIndices.unshift(current);
            s--;
          }
          // Убираем возможные дубликаты
          const uniquePath: number[] = [];
          for (const idx of pathIndices) {
            if (uniquePath.length && uniquePath[uniquePath.length - 1] === idx) continue;
            uniquePath.push(idx);
          }
          if (uniquePath[0] === uniquePath[uniquePath.length - 1]) uniquePath.pop();
          if (uniquePath.length < 2) continue;

          const pathTokens = uniquePath.map(i => this.tokens[i]);
          const profitPercent = (Math.exp(-distByStep[step][startIdx]) - 1) * 100;
          if (profitPercent > 0 && profitPercent < 100) {
            const cycleKey = pathTokens.map(t => t.assetId).join('|');
            if (!visited.has(cycleKey)) {
              visited.add(cycleKey);
              cycles.push({ path: pathTokens, profitPercent });
            }
          }
        }
      }
    }

    // Фильтруем циклы, где есть самоповторы токенов
    return cycles.filter(c => new Set(c.path.map(t => t.assetId)).size === c.path.length);
  }
}