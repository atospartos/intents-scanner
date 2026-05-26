import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GraphManager } from './services/GraphManager';
import { ArbitrageFinder } from './services/ArbitrageFinder';
import { RateLimitedQueue } from './services/RateLimitedQueue';
import { nearIntentsClient } from './clients/nearIntentsClient';
import { config } from './config';
import { Token } from './clients/nearIntentsClient';

// Расширяем ArbitrageFinder методом findAllSimpleCycles
declare module './services/ArbitrageFinder' {
  interface ArbitrageFinder {
    findAllSimpleCycles(maxSwaps: number, minProfitPercent: number): { path: Token[]; profitPercent: number }[];
  }
}

// Реализуем метод прямо здесь (прототип)
ArbitrageFinder.prototype.findAllSimpleCycles = function(
  maxSwaps: number,
  minProfitPercent: number
): { path: Token[]; profitPercent: number }[] {
  const graphManager = (this as any).graphManager as GraphManager;
  const tokens = graphManager.getTokens();
  const startTokens = tokens.filter(t => config.stableSymbols.includes(t.symbol));
  const results: { path: Token[]; profitPercent: number }[] = [];
  const visitedCycles = new Set<string>();

  const dfs = (path: Token[], startToken: Token, depth: number) => {
    const current = path[path.length - 1];
    // Замыкание: вернулись к старту и путь состоит минимум из двух обменов (A→B→A)
    if (path.length >= 3 && current.assetId === startToken.assetId) {
      let totalRate = 1;
      for (let i = 0; i < path.length - 1; i++) {
        const rate = graphManager.getRate(path[i].assetId, path[i + 1].assetId);
        if (!rate || rate <= 0) return;
        totalRate *= rate;
      }
      const profitPercent = (totalRate - 1) * 100;
      if (profitPercent >= minProfitPercent) {
        const cycleKey = path.map(t => t.assetId).join('|');
        if (!visitedCycles.has(cycleKey)) {
          visitedCycles.add(cycleKey);
          results.push({ path: path.slice(0, -1), profitPercent });
        }
      }
      return;
    }
    if (depth >= maxSwaps) return;

    const neighbors = graphManager.getNeighbors(current.assetId);
    for (const next of neighbors) {
      // Замыкание на старт
      if (next.assetId === startToken.assetId && path.length >= 2) {
        dfs([...path, next], startToken, depth + 1);
      } else if (!path.includes(next)) {
        dfs([...path, next], startToken, depth + 1);
      }
    }
  };

  for (const start of startTokens) {
    dfs([start], start, 0);
  }
  // Сортируем по убыванию прибыли
  results.sort((a, b) => b.profitPercent - a.profitPercent);
  return results;
};

// Функция реальной верификации цикла (имитация исполнения)
async function verifyCycleReal(
  path: Token[],
  testAmountUSD: number,
  queue: RateLimitedQueue
): Promise<{ profitPercent: number; amountOutUsd: number } | null> {
  const fullPath = [...path, path[0]];
  let currentAmountRaw: string | null = null;
  let totalUsdOut = 0;

  for (let i = 0; i < fullPath.length - 1; i++) {
    const from = fullPath[i];
    const to = fullPath[i + 1];
    // Для первого шага вычисляем amountIn в raw виде
    let amountInRaw: string;
    if (i === 0) {
      const price = parseFloat(from.price);
      if (isNaN(price) || price <= 0) return null;
      amountInRaw = Math.floor((testAmountUSD / price) * Math.pow(10, from.decimals)).toString();
    } else {
      amountInRaw = currentAmountRaw!;
    }

    try {
      const quote = await queue.add({
        originAsset: from.assetId,
        destinationAsset: to.assetId,
        amount: amountInRaw,
        dry: true, // Только проверка, не исполняем
        quoteWaitingTimeMs: 3000,
      });
      if (!quote?.quote?.amountOut || !quote.quote.amountOutUsd) {
        console.warn(`Нет котировки для ${from.symbol}->${to.symbol}`);
        return null;
      }
      currentAmountRaw = quote.quote.amountOut;
      if (i === fullPath.length - 2) {
        totalUsdOut = parseFloat(quote.quote.amountOutUsd);
      }
    } catch (err) {
      console.warn(`Ошибка верификации ${from.symbol}->${to.symbol}:`, err);
      return null;
    }
  }
  const profitPercent = ((totalUsdOut - testAmountUSD) / testAmountUSD) * 100;
  return { profitPercent, amountOutUsd: totalUsdOut };
}

async function main() {
  console.log('🔎 Сканирование и верификация прибыльных циклов...');
  const graphManager = new GraphManager();
  await graphManager.init();
  console.log(`📊 Граф загружен: ${graphManager.getEdgesCount()} рёбер`);

  const finder = new ArbitrageFinder(graphManager);
  const maxSwaps = 4; // ищем циклы из 2,3,4 обменов
  const minTheoreticalProfit = 0.05; // теоретический порог (%)

  console.log(`🔍 Поиск всех простых циклов (обменов <= ${maxSwaps}) с прибылью >= ${minTheoreticalProfit}%...`);
  const allCycles = finder.findAllSimpleCycles(maxSwaps, minTheoreticalProfit);
  console.log(`✅ Найдено теоретических циклов: ${allCycles.length}`);

  if (allCycles.length === 0) {
    console.log('Нет прибыльных циклов для проверки.');
    return;
  }

  // Группируем по длине пути (количество обменов)
  const cyclesByLength = new Map<number, typeof allCycles>();
  for (const cycle of allCycles) {
    const len = cycle.path.length; // длина пути = количество обменов
    if (!cyclesByLength.has(len)) cyclesByLength.set(len, []);
    cyclesByLength.get(len)!.push(cycle);
  }

  const queue = new RateLimitedQueue();
  const verifiedResults: any[] = [];
  const testAmountUSD = config.trading.testAmountUSD;

  // Для каждой длины берем топ-3 по теоретической прибыли и верифицируем
  for (const [length, cycles] of cyclesByLength.entries()) {
    console.log(`\n📏 Циклы длины ${length} (${cycles.length} шт.), проверяем топ-3...`);
    const topCycles = cycles.slice(0, 3);
    for (const cycle of topCycles) {
      const pathStr = cycle.path.map(t => `${t.symbol}(${t.blockchain})`).join(' → ');
      console.log(`  Теоретическая прибыль: ${cycle.profitPercent.toFixed(4)}% для ${pathStr} → ${cycle.path[0].symbol}`);
      const real = await verifyCycleReal(cycle.path, testAmountUSD, queue);
      if (real) {
        console.log(`    ✅ РЕАЛЬНАЯ ПРИБЫЛЬ: ${real.profitPercent.toFixed(4)}% (выход USD: ${real.amountOutUsd.toFixed(2)})`);
        verifiedResults.push({
          length,
          theoreticalProfit: cycle.profitPercent,
          realProfit: real.profitPercent,
          path: cycle.path.map(t => ({ symbol: t.symbol, blockchain: t.blockchain, assetId: t.assetId })),
          timestamp: new Date().toISOString(),
        });
      } else {
        console.log(`    ❌ Нет ликвидности или котировка недоступна`);
      }
      // Пауза между циклами, чтобы не превысить 5 RPS (queue уже ограничивает, но добавим 200 мс)
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Сохраняем подтверждённые результаты
  const outputPath = path.join(process.cwd(), 'storage', 'verified_cycles.json');
  fs.writeFileSync(outputPath, JSON.stringify(verifiedResults, null, 2));
  console.log(`\n💾 Сохранено ${verifiedResults.length} подтверждённых маршрутов в ${outputPath}`);

  // Выводим лучший по реальной прибыли
  if (verifiedResults.length > 0) {
    const best = verifiedResults.reduce((a, b) => (a.realProfit > b.realProfit ? a : b));
    const bestPathStr = best.path.map((t: any) => `${t.symbol}(${t.blockchain})`).join(' → ');
    console.log(`\n🏆 ЛУЧШИЙ ПОДТВЕРЖДЁННЫЙ МАРШРУТ: ${bestPathStr} → ${best.path[0].symbol}`);
    console.log(`   Реальная прибыль: ${best.realProfit.toFixed(4)}%`);
  }
}

main().catch(console.error);