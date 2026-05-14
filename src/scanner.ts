import { tokenManager } from './services/tokenManager';
import { RateCache } from './services/rateCache';
import { FastScanner } from './services/fastScanner';
import { config } from './config';

async function main() {
  console.log('🚀 Адаптивный сканер циклов (со стейблами и без)');

  const stables = await tokenManager.getAllStablecoins();
  const rawWorking = await tokenManager.getWorkingTokens();

  // Получаем токены с хотя бы одной связью со стейблом
  const liquidTokensInfo = await tokenManager.getTokensWithAnyLiquidity(
    rawWorking,
    stables,
    config.trading.testAmountUSD
  );
  const workingTokens = liquidTokensInfo.map(info => info.token);
  console.log(`🔹 Токенов, пригодных для построения графа: ${workingTokens.length}`);

  if (workingTokens.length === 0) {
    console.log('❌ Нет токенов с ликвидностью');
    return;
  }

  // Строим кэш для всех токенов (стейблы + рабочие)
  const allTokensForCache = [...stables, ...workingTokens];
  const rateCache = new RateCache();
  await rateCache.ensureFresh(allTokensForCache, config.trading.testAmountUSD);

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