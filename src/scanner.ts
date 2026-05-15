import { tokenManager } from './services/tokenManager';
import { RateCache } from './services/rateCache';
import { FastScanner } from './services/fastScanner';
import { config } from './config';

async function main() {
  console.log('🚀 Адаптивный сканер циклов (со стейблами и без)');

  // 1. Получаем стейблы и рабочие токены (без фильтрации ликвидности)
  const stables = await tokenManager.getStableToken();       // массив
  const workingTokens = await tokenManager.getAllWorkingTokens(); // массив

  console.log(`💰 Стейблкоинов: ${stables}`);
  console.log(`🔹 Рабочих токенов (без фильтрации ликвидности): ${workingTokens.length}`);

  if (workingTokens.length === 0) {
    console.log('❌ Нет токенов для построения графа');
    return;
  }

  // 2. Формируем единый массив для кэша (стейблы + рабочие)
  const allTokensForCache = [stables, ...workingTokens];

  // 3. Загружаем кэш котировок (или создаём, если нет / устарел)
  const rateCache = new RateCache();
  // Для отладки: если файл storage/rate_cache.json уже существует, можно временно закомментировать следующую строку
  // и просто загрузить кэш без обновления:
  await rateCache.rateCacheLoad(); // нужно добавить такой метод в RateCache (см. ниже)
  // await rateCache.ensureFresh(allTokensForCache, config.trading.testAmountUSD);

  // 4. Сканируем циклы
  const scanner = new FastScanner(rateCache, config.trading.testAmountUSD);
  const cycles = await scanner.findProfitableCycles(
    allTokensForCache,
    config.scan.minProfitPercent,
    config.scan.maxCycleLength,
    config.scan.enableStableCycles,
    config.scan.enableAltcoinCycles
  );

  console.log(`\n🏆 Найдено прибыльных циклов: ${cycles.length}`);
  if (cycles.length) {
    cycles.sort((a, b) => b.profitPercent - a.profitPercent);
    console.log('Топ-5:');
    cycles.slice(0, 5).forEach(c => {
      console.log(`   ${c.path.join(' → ')} → +${c.profitPercent.toFixed(4)}%`);
    });
  }
}

main().catch(console.error);