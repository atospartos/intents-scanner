import { tokenManager } from './services/tokenManager';
import { pathGenerator } from './services/pathGenerator';
import { parallelScanner } from './services/parallelScanner';
import { config } from './config';

async function main() {
  console.log('🔍 Арбитражный сканер: Stable(NEAR) → TokenA(СетьX) → TokenB(СетьY) → Stable(NEAR)');
  const stable = await tokenManager.getStableToken();
  const working = await tokenManager.getWorkingTokens();
  console.log(`🔹 Стартовый стейбл: ${stable.symbol} (${stable.blockchain})`);
  console.log(`🔹 Рабочих токенов: ${working.length}`);

  const paths = pathGenerator.generatePaths(stable, working);
  console.log(`📊 Всего маршрутов: ${paths.length}`);

  const results = await parallelScanner.scanPaths(paths, config.trading.testAmountUSD);
  const profitable = results.filter(r => r.profitPercent >= config.scan.minProfitPercent);
  console.log(`\n🏆 Прибыльных маршрутов: ${profitable.length}`);
  if (profitable.length) {
    profitable.sort((a,b) => b.profitPercent - a.profitPercent);
    console.log('Топ-5:');
    profitable.slice(0,5).forEach(p => {
      console.log(`   ${p.pathStr} → +${p.profitPercent.toFixed(4)}%`);
    });
  }
}

main().catch(console.error);