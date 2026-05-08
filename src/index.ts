import { tokenManager } from './services/tokenManager';
import { pathGenerator } from './services/pathGenerator';
import { parallelScanner } from './services/parallelScanner';
import { config } from './config';

async function main() {
  console.log('🔍 Арбитражный сканер (все пары, проверка ликвидности на лету)');
  const stable = await tokenManager.getStableToken();
  const workingTokens = await tokenManager.getAllWorkingTokens();
  console.log(`🔹 Стартовый стейбл: ${stable.symbol} (${stable.blockchain})`);
  console.log(`🔹 Рабочих токенов: ${workingTokens.length}`);

  const paths = pathGenerator.generateAllPaths(stable, workingTokens);
  // Сохраняем сгенерированные маршруты в файл перед сканированием
  pathGenerator.savePathsToFile(paths, `routes_${Date.now()}.json`);
  console.log(`📊 Всего маршрутов для проверки: ${paths.length}`);

  const results = await parallelScanner.scanPaths(paths, config.trading.testAmountUSD);
  const profitable = results.filter(r => r.profitPercent >= config.scan.minProfitPercent);
  console.log(`\n🏆 Прибыльных маршрутов: ${profitable.length}`);
  if (profitable.length) {
    profitable.sort((a, b) => b.profitPercent - a.profitPercent);
    console.log('Топ-5:');
    profitable.slice(0, 5).forEach(p => {
      console.log(`   ${p.pathStr} → +${p.profitPercent.toFixed(4)}%`);
    });
  }
}

main().catch(console.error);