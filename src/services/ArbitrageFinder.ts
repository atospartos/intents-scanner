import { Token } from '../clients/nearIntentsClient';
import { GraphManager } from './GraphManager';
import { config } from '../config';

export class ArbitrageFinder {
  private tokens: Token[];
  private n: number;
  private tokenIndex: Map<string, number>;

  constructor(private graphManager: GraphManager) {
    this.tokens = graphManager.getTokens();
    this.n = this.tokens.length;
    this.tokenIndex = new Map(this.tokens.map((t, idx) => [t.assetId, idx]));
  }

  /**
   * Находит максимально прибыльный цикл (с возвратом к стартовому токену)
   * с длиной пути (количество обменов) от 2 до maxSwaps.
   * @param maxSwaps максимальное количество обменов в цикле (например, 3 или 4)
   * @returns лучший цикл или null, если не найден
   */

  findBestSimpleCycle(maxSwaps: number): { path: Token[]; profitPercent: number } | null {
    const tokens = this.tokens;
    let bestProfit = -Infinity;
    let bestCycle: Token[] = [];

    // Рекурсивный DFS, строящий простой путь (без повторов, кроме замыкания)
    const dfs = (path: Token[], startToken: Token, depth: number) => {
      const current = path[path.length - 1];
      // Если вернулись к старту и путь содержит не менее 2 шагов (2 обмена)
      if (path.length >= 2 && current.assetId === startToken.assetId) {
        // Вычисляем итоговую прибыль
        let totalRate = 1;
        for (let i = 0; i < path.length - 1; i++) {
          const from = path[i];
          const to = path[i + 1];
          const rate = this.graphManager.getRate(from.assetId, to.assetId);
          if (!rate) return;
          totalRate *= rate;
        }
        const profitPercent = (totalRate - 1) * 100;
        if (profitPercent > bestProfit) {
          bestProfit = profitPercent;
          bestCycle = [...path]; // сохраняем копию
        }
        return;
      }
      if (depth >= maxSwaps) return; // не превышаем лимит обменов

      const neighbors = this.graphManager.getNeighbors(current.assetId);
      for (const next of neighbors) {
        // Не допускаем повторения токенов (кроме стартового, но стартовый только в конце)
        if (next.assetId === startToken.assetId) {
          // Разрешаем замкнуть цикл только если путь уже содержит минимум 2 токена
          if (path.length >= 3) {
            dfs([...path, next], startToken, depth + 1);
          }
        } else if (!path.includes(next)) {
          dfs([...path, next], startToken, depth + 1);
        }
      }
    };

    // Запускаем от всех токенов или только от стабильных
    const startTokens = tokens.filter(t => config.stableSymbols.includes(t.symbol));
    for (const start of startTokens) {
      dfs([start], start, 0);
    }

    if (bestCycle.length === 0) return null;
    // Убираем последний повторяющийся стартовый токен для вывода
    const cyclePath = bestCycle.slice(0, -1);
    return { path: cyclePath, profitPercent: bestProfit };
  }

  findBestArbitrage(maxSwaps: number): { path: Token[]; profitPercent: number } | null {
    const maxSteps = maxSwaps + 1; // количество вершин в замкнутом пути (включая повтор старта)
    // Инициализация матрицы логарифмов курсов
    const logRate = Array(this.n)
      .fill(null)
      .map(() => Array(this.n).fill(-Infinity));

    for (let i = 0; i < this.n; i++) {
      const fromId = this.tokens[i].assetId;
      for (let j = 0; j < this.n; j++) {
        if (i === j) continue;
        const rate = this.graphManager.getRate(fromId, this.tokens[j].assetId);
        if (rate && rate > 0) {
          logRate[i][j] = Math.log(rate);
        }
      }
    }
    // dp для длины 1 шаг
    let prev = logRate.map(row => [...row]);
    // Храним предков для восстановления: pred[steps][i][j] = последняя промежуточная вершина перед j
    const pred: number[][][] = Array(maxSteps + 1)
      .fill(null)
      .map(() => Array(this.n).fill(null).map(() => Array(this.n).fill(-1)));

    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        if (logRate[i][j] > -Infinity) pred[1][i][j] = i;
      }
    }

    let bestProfit = -Infinity;
    let bestCyclePath: Token[] | null = null;
    let bestCycleSteps = 0;

    // Итерации для длин от 2 до maxSteps
    for (let steps = 2; steps <= maxSteps; steps++) {
      const cur = Array(this.n)
        .fill(null)
        .map(() => Array(this.n).fill(-Infinity));

      // Оптимизированный тройной цикл
      for (let i = 0; i < this.n; i++) {
        const prevRow = prev[i];
        for (let k = 0; k < this.n; k++) {
          const pk = prevRow[k];
          if (pk === -Infinity) continue;
          const logRowK = logRate[k];
          for (let j = 0; j < this.n; j++) {
            const cand = pk + logRowK[j];
            if (cand > cur[i][j]) {
              cur[i][j] = cand;
              pred[steps][i][j] = k;
            }
          }
        }
      }

      // Проверяем циклы (i -> ... -> i) за steps шагов
      for (let i = 0; i < this.n; i++) {
        const cycleLog = cur[i][i];
        if (cycleLog > -Infinity) {
          const profit = Math.exp(cycleLog) - 1;
          if (profit > bestProfit) {
            bestProfit = profit;
            bestCycleSteps = steps;
            // Восстанавливаем путь
            const pathIndices = this.reconstructCycle(pred, steps, i);
            if (pathIndices && pathIndices.length === steps + 1) {
              // pathIndices[0] = i, pathIndices[steps] = i
              const cycleTokens = pathIndices.map(idx => this.tokens[idx]);
              bestCyclePath = cycleTokens.slice(0, -1); // убираем дублирующий старт в конце
            } else {
              bestCyclePath = null;
            }
          }
        }
      }

      prev = cur;
    }

    if (bestCyclePath && bestProfit > 0) {
      const profitPercent = bestProfit * 100;
      return { path: bestCyclePath, profitPercent };
    }
    return null;
  }

  private reconstructCycle(
    pred: number[][][],
    steps: number,
    startIdx: number
  ): number[] | null {
    const path = [startIdx];
    let current = startIdx;
    // Идём назад: pred[steps][startIdx][current] даёт предыдущую вершину
    for (let s = steps; s >= 1; s--) {
      const prevNode = pred[s][startIdx][current];
      if (prevNode === -1) return null;
      path.unshift(prevNode);
      current = prevNode;
    }
    // Сейчас path[0] = startIdx, path[steps] = последняя вершина перед замыканием
    if (path.length !== steps + 1) return null;
    // Проверяем, что последняя вершина пути ведёт обратно к startIdx (замыкание уже учтено)
    return path;
  }
}