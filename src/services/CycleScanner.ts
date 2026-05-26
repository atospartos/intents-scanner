import { GraphManager } from './GraphManager';
import { Token } from '../clients/nearIntentsClient';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

export class CycleScanner {
  private graphManager: GraphManager;
  private minProfitPercent: number;
  private maxCycleLength: number;
  private visitedCycles = new Set<string>();
  private profitableCyclesPath: string;

  constructor(graphManager: GraphManager) {
    this.graphManager = graphManager;
    this.minProfitPercent = config.scan.minProfitPercent;
    this.maxCycleLength = config.scan.maxCycleLength;
    this.profitableCyclesPath = path.join(process.cwd(), 'storage', 'theoretical_cycles.json');
    // Очищаем прошлые результаты
    if (fs.existsSync(this.profitableCyclesPath)) {
      fs.unlinkSync(this.profitableCyclesPath);
    }
  }

  async scanAllCycles() {
    const tokens = this.graphManager.getTokens();
    // Для старта используем все токены (или только стабильные – на ваш выбор)
    const startTokens = tokens.filter(t => config.stableSymbols.includes(t.symbol));
    console.log(`🔍 Поиск циклов от ${startTokens.length} стабильных токенов...`);
    let totalCycles = 0;
    let profitable = 0;

    for (const start of startTokens) {
      await this.dfs([start], start.assetId, start, 1);
    }

    console.log(`\n📊 Итого найдено циклов: ${totalCycles}, прибыльных: ${profitable}`);
  }

  private async dfs(path: Token[], startId: string, originalStart: Token, depth: number) {
    const last = path[path.length - 1];
    const currentDepth = path.length;

    // Если вернулись к стартовому токену и длина пути >= 2
    if (currentDepth >= 2 && last.assetId === startId) {
      const cycleKey = path.map(t => t.assetId).join('|');
      if (!this.visitedCycles.has(cycleKey)) {
        this.visitedCycles.add(cycleKey);
        const profit = this.calculateProfit(path);
        if (profit >= this.minProfitPercent) {
          this.saveCycle(path, profit);
        }
      }
      return;
    }

    if (currentDepth > this.maxCycleLength + 1) return;

    const neighbors = this.graphManager.getNeighbors(last.assetId);
    for (const next of neighbors) {
      // Разрешаем возврат к старту только если длина >=2
      if (next.assetId === startId && currentDepth >= 2) {
        await this.dfs([...path, next], startId, originalStart, depth + 1);
      } 
      // Иначе не идём в уже посещённые (кроме старта)
      else if (!path.includes(next)) {
        await this.dfs([...path, next], startId, originalStart, depth + 1);
      }
    }
  }

  private calculateProfit(path: Token[]): number {
    // path уже включает завершающий стартовый токен (например, [A, B, C, A])
    let totalRate = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const rate = this.graphManager.getRate(from.assetId, to.assetId);
      if (!rate || rate <= 0) return -Infinity;
      totalRate *= rate;
    }
    const profitPercent = (totalRate - 1) * 100;
    return profitPercent;
  }

  private saveCycle(path: Token[], profitPercent: number) {
    const cycleStr = path.map(t => `${t.symbol}(${t.blockchain})`).join(' → ');
    const cycleData = {
      id: path.map(t => t.symbol).join('-'),
      path: cycleStr,
      profitPercent: parseFloat(profitPercent.toFixed(6)),
      length: path.length - 1,
      timestamp: new Date().toISOString(),
      tokensInfo: path.map(t => ({
        symbol: t.symbol,
        assetId: t.assetId,
        blockchain: t.blockchain,
        decimals: t.decimals,
      })),
    };

    // Явно указываем тип массива
    let cycles: any[] = [];
    if (fs.existsSync(this.profitableCyclesPath)) {
      try {
        const content = fs.readFileSync(this.profitableCyclesPath, 'utf-8');
        cycles = JSON.parse(content);
        if (!Array.isArray(cycles)) cycles = [];
      } catch(e) {
        cycles = [];
      }
    }
    cycles.push(cycleData);
    fs.writeFileSync(this.profitableCyclesPath, JSON.stringify(cycles, null, 2));
    console.log(`💰 Найден цикл: ${cycleStr} — прибыль: ${profitPercent.toFixed(4)}%`);
}
}