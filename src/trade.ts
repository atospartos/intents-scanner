import { atomicExecutor } from './services/atomicExecutor';
import { config } from './config';

async function main() {
  console.log('\n🤖 NEAR ARBITRAGE BOT — АВТОМАТИЧЕСКАЯ ТОРГОВЛЯ\n');
  console.log(`💰 Капитал: $100`);
  console.log(`🎯 Мин. прибыль: 0.03%`);
  console.log(`🔄 Макс. попыток: 3`);
  console.log(`🔍 Проверка прибыли перед исполнением: ДА`);
  console.log(`📁 Режим: ${config.dryRunOnly ? 'ТЕСТ (dry-run)' : 'РЕАЛЬНЫЙ'}\n`);
  
  const result = await atomicExecutor.executeBestRoute(100);
  
  if (result && result.status === 'success') {
    if (config.dryRunOnly) {
      console.log('💡 Для реальной торговли:');
      console.log('   1. Установите DRY_RUN_ONLY=false в .env');
      console.log('   2. Убедитесь, что на кошельке есть $100 USDC');
      console.log('   3. Запустите: npm run trade\n');
    } else {
      console.log('✅ Реальная сделка выполнена!');
      console.log('   Для автоматического повтора запустите цикл:');
      console.log('   npm run trade:loop\n');
    }
  }
}

main().catch(console.error);