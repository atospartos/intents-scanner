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

  near: {
    networkId: process.env.NEAR_NETWORK_ID || 'mainnet',
    nodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.mainnet.near.org',
    accountId: process.env.NEAR_ACCOUNT_ID || '',
    privateKey: process.env.NEAR_PRIVATE_KEY || '',
  },

  trading: {
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '100'), // 1%
    testAmountUSD: parseFloat(process.env.TEST_AMOUNT_USD || '100'),
  },

  executor: {
    minProfitPercent: parseFloat(process.env.EXECUTOR_MIN_PROFIT_PERCENT || '0.5'),
    executionDelayMs: parseInt(process.env.EXECUTOR_DELAY_MS || '2000'),
    maxConcurrent: parseInt(process.env.EXECUTOR_MAX_CONCURRENT || '5'),
    baseAmount: parseFloat(process.env.EXECUTOR_BASE_AMOUNT || '100'), // 100 USDC
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