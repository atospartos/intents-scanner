// src/run-executor.ts
// Отдельный скрипт для исполнения

import { executor } from './executor/executor';
import { config } from './config';

async function main() {
  console.log('\n🚀 ЗАПУСК EXECUTOR (атомарные INTENTS свопы)\n');
  console.log('=' .repeat(50));
  
  try {
    await executor.init();
    const results = await executor.executeProfitableRoutes();
    
    console.log(`\n✅ Успешно: ${results.filter(r => r.success).length}`);
    console.log(`❌ Ошибок: ${results.filter(r => !r.success).length}`);
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

main();