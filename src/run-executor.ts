// src/run-executor.ts
import { executor } from './executor/executor';
import { config } from './config';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('\n🚀 ЗАПУСК EXECUTOR (атомарные INTENTS свопы)\n');
  console.log('=' .repeat(60));
  console.log(`   RPC: ${config.near.nodeUrl}`);
  console.log(`   Аккаунт: ${config.near.accountId}`);
  console.log(`   Контракт: intents.near`);
  console.log(`   Мин. прибыль: ${config.executor.minProfitPercent}%`);
  console.log(`   Базовая сумма: ${config.executor.baseAmount} USDC`);
  console.log(`   Режим: ${config.dryRunOnly ? 'DRY-RUN (симуляция)' : 'РЕАЛЬНЫЙ'}`);
  console.log('=' .repeat(60));
  
  // Проверяем наличие файла с маршрутами
  const profitableFile = path.resolve('./profitable.json');
  if (!fs.existsSync(profitableFile)) {
    console.error('\n❌ Ошибка: Файл profitable.json не найден!');
    console.error('   Сначала запустите сканер: npm run scan');
    process.exit(1);
  }
  
  // Проверяем, что файл не пустой
  const stats = fs.statSync(profitableFile);
  if (stats.size === 0) {
    console.error('\n❌ Ошибка: Файл profitable.json пуст!');
    console.error('   Запустите сканер для поиска арбитражных возможностей');
    process.exit(1);
  }
  
  try {
    const results = await executor.executeProfitableRoutes();
    
    console.log('\n' + '=' .repeat(60));
    console.log('📊 ФИНАЛЬНЫЕ РЕЗУЛЬТАТЫ:');
    console.log(`   ✅ Успешно: ${results.filter(r => r.success).length}`);
    console.log(`   ❌ Ошибок: ${results.filter(r => !r.success).length}`);
    
    const successResults = results.filter(r => r.success);
    if (successResults.length > 0) {
      console.log(`\n   Успешные транзакции:`);
      successResults.forEach(r => {
        console.log(`     - ${r.routeId}: ${r.txHash}`);
      });
      
      // Сохраняем успешные транзакции в отдельный файл
      const successfulTxFile = path.resolve('./successful_txs.json');
      const successfulTxs = successResults.map(r => ({
        routeId: r.routeId,
        txHash: r.txHash,
        profitPercent: r.profitPercent,
        timestamp: new Date().toISOString()
      }));
      fs.writeFileSync(successfulTxFile, JSON.stringify(successfulTxs, null, 2));
      console.log(`\n   💾 Успешные транзакции сохранены в ${successfulTxFile}`);
    }
    
    const failedResults = results.filter(r => !r.success);
    if (failedResults.length > 0) {
      console.log(`\n   Ошибки:`);
      failedResults.forEach(r => {
        console.log(`     - ${r.routeId}: ${r.error}`);
      });
    }
    
  } catch (error: any) {
    console.error('\n❌ Критическая ошибка:', error.message);
    if (error.stack) {
      console.error('\n📚 Стек ошибки:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();