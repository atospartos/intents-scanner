// src/check-status.ts
import { nearRpcClient } from './clients/nearRpcClient';
import fs from 'fs';
import path from 'path';

async function checkStatus() {
  console.log('\n🔍 ПРОВЕРКА СТАТУСА ТРАНЗАКЦИЙ\n');
  console.log('=' .repeat(60));
  
  const successfulTxFile = path.resolve('./successful_txs.json');
  if (!fs.existsSync(successfulTxFile)) {
    console.log('❌ Нет сохранённых транзакций');
    return;
  }
  
  const txs = JSON.parse(fs.readFileSync(successfulTxFile, 'utf-8'));
  
  for (const tx of txs) {
    console.log(`\n📋 Транзакция: ${tx.txHash}`);
    console.log(`   Маршрут: ${tx.routeId}`);
    console.log(`   Прибыль: ${tx.profitPercent}%`);
    
    try {
      const status = await nearRpcClient.getTransactionStatus(tx.txHash);
      console.log(`   Статус: ${status.final_execution_status}`);
      
      if (status.status && status.status.SuccessValue) {
        const result = Buffer.from(status.status.SuccessValue, 'base64').toString();
        console.log(`   Результат: ${result}`);
      }
    } catch (error: any) {
      console.log(`   Ошибка: ${error.message}`);
    }
  }
}

checkStatus();