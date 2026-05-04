// src/debug-contract.ts
import { nearRpcClient } from './clients/nearRpcClient';
import { config } from './config';

async function debugContract() {
  console.log('\n🔍 ПРОВЕРКА МЕТОДОВ С АРГУМЕНТАМИ\n');
  console.log('=' .repeat(60));
  
  // Тестовые аргументы для get_swap_preview
  const testArgs = {
    path: ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"],
    amount_in: "1000000",
    recipient: "test.near"
  };
  
  const methodsToTest = [
    { name: 'get_swap_preview', args: testArgs },
    { name: 'swap_preview', args: testArgs },
    { name: 'preview_swap', args: testArgs },
    { name: 'quote', args: testArgs },
    { name: 'get_quote', args: { from: "test", to: "test", amount: "100" } },
    { name: 'simulate', args: { intents: [] } },
  ];
  
  for (const method of methodsToTest) {
    try {
      const argsBase64 = Buffer.from(JSON.stringify(method.args)).toString('base64');
      const result = await nearRpcClient.rpcCall('query', {
        request_type: 'call_function',
        finality: 'final',
        account_id: 'intents.near',
        method_name: method.name,
        args_base64: argsBase64
      });
      console.log(`✅ ${method.name}: УСПЕШНО`);
      if (result.result && result.result.length > 0) {
        const output = Buffer.from(result.result).toString();
        console.log(`   Ответ: ${output.substring(0, 200)}`);
      }
    } catch (e: any) {
      if (e.message.includes('MethodNotFound')) {
        console.log(`❌ ${method.name}: MethodNotFound`);
      } else {
        console.log(`⚠️ ${method.name}: ${e.message.substring(0, 100)}`);
      }
    }
  }
  
  // Проверяем все методы из ABI
  console.log('\n🔍 ПРОВЕРКА ВСЕХ МЕТОДОВ (без аргументов)\n');
  const allMethods = [
    'get_version', 'version', 'get_quote', 'quote', 'simulate_intents',
    'simulate', 'execute_intent', 'execute', 'swap', 'get_swap_preview',
    'preview_swap', 'current_salt', 'get_salt', 'ft_transfer_call', 'token_diff'
  ];
  
  for (const method of allMethods) {
    try {
      const argsBase64 = Buffer.from(JSON.stringify({})).toString('base64');
      const result = await nearRpcClient.rpcCall('query', {
        request_type: 'call_function',
        finality: 'final',
        account_id: 'intents.near',
        method_name: method,
        args_base64: argsBase64
      });
      console.log(`✅ ${method}: найден (требует аргументы)`);
    } catch (e: any) {
      if (e.message.includes('MethodNotFound')) {
        console.log(`❌ ${method}: не найден`);
      } else {
        console.log(`✅ ${method}: найден (требует аргументы) - ${e.message.substring(0, 50)}`);
      }
    }
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('✅ Проверка завершена\n');
}

debugContract().catch(console.error);