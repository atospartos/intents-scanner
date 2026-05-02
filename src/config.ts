import dotenv from 'dotenv';

dotenv.config();

export const config = {
  api: {
    baseUrl: 'https://1click.chaindefuser.com',
    jwtToken: process.env.JWT_TOKEN || '',
    timeout: parseInt(process.env.API_TIMEOUT_MS || '10000'),
  },
  
  addresses: {
    near: process.env.NEAR_ADDRESS || '',
  },
  
 scan: {
    intervalSec: parseInt(process.env.SCAN_INTERVAL_SEC || '30'),
    minProfitPercent: parseFloat(process.env.MIN_PROFIT_PERCENT || '0.03'),  // 🔥 0.03% 
    maxWorkingTokens: parseInt(process.env.MAX_TOKENS || '1500'),
    pathLengths: [4],  // 🔥 ТОЛЬКО ДЛИНА 4!
  },
  
  tokens: {
    stablecoinSymbols: ['USDC'],
    allowedBlockchains: ['near', 'sol', 'sui', 'eth', 'bsc', 'arb', 'base', 'avax', 'pol', 'op', 'ton', 'tron', 'zec', 'aptos', 'cardano', 'ltc', 'bch', 'dash'],
  },
  
  dryRunOnly: process.env.DRY_RUN_ONLY !== 'false',
  
  trading: {
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '100'),
    testAmountUSD: 100,
  },
};

if (!config.api.jwtToken) {
  console.error('❌ JWT_TOKEN не указан в .env файле');
  process.exit(1);
}

console.log('✅ Конфигурация загружена');
console.log(`   Режим: ${config.dryRunOnly ? 'DRY-RUN' : 'РЕАЛЬНЫЙ'}`);
console.log(`   NEAR аккаунт: ${config.addresses.near}`);
console.log(`   Мин. прибыль: ${config.scan.minProfitPercent}%`);