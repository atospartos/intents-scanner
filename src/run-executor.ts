// src/run-executor.ts
import { executor } from './executor/executor';
import { nearRpcClient } from './clients/nearRpcClient';
import { config } from './config';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('\n🚀 ЗАПУСК EXECUTOR (атомарные INTENTS свопы)\n');
  console.log('=' .repeat(60));
  console.log(`   RPC: ${config.near.nodeUrl}`);
  console.log(`   Аккаунт: ${config.near.accountId || 'не указан'}`);
  console.log(`   Контракт: intents.near`);
  console.log(`   Мин. прибыль: ${config.executor.minProfitPercent}%`);
  console.log(`   Базовая сумма: ${config.executor.baseAmount} USDC`);
  console.log(`   Режим: ${config.dryRunOnly ? 'DRY-RUN (симуляция)' : 'РЕАЛЬНЫЙ'}`);
  console.log('=' .repeat(60));
  
  // Проверяем наличие файла в storage папке
  const storageDir = path.join(process.cwd(), 'storage');
  const profitableFile = path.join(storageDir, 'profitable.json');
  
  if (!fs.existsSync(profitableFile)) {
    console.error(`\n❌ Ошибка: Файл ${profitableFile} не найден!`);
    console.error('   Сначала запустите сканер: npm run scan');
    process.exit(1);
  }
  
  const stats = fs.statSync(profitableFile);
  if (stats.size === 0) {
    console.error('\n❌ Ошибка: Файл profitable.json пуст!');
    console.error('   Нет арбитражных возможностей для исполнения');
    process.exit(1);
  }
  
  console.log(`   ✅ Найден файл: ${profitableFile}\n`);
  
  try {
    // В DRY режиме не инициализируем RPC и не проверяем баланс
    if (!config.dryRunOnly) {
      // Проверяем наличие приватного ключа
      if (!config.near.privateKey || config.near.privateKey === '') {
        console.error('\n❌ Ошибка: NEAR_PRIVATE_KEY не указан в .env');
        console.error('   Для реального исполнения добавьте приватный ключ');
        process.exit(1);
      }
      
      await nearRpcClient.init();
      const balance = await nearRpcClient.getBalance();
      console.log(`   💰 Баланс: ${balance} NEAR\n`);
    } else {
      console.log(`   💡 DRY-RUN режим: транзакции не будут отправлены\n`);
    }
    
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
    }
    
  } catch (error: any) {
    console.error('\n❌ Критическая ошибка:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();