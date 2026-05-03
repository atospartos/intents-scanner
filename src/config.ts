// src/config.ts
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // 1Click API (для сканирования)
  api: {
    baseUrl: 'https://1click.chaindefuser.com',
    jwtToken: process.env.JWT_TOKEN || '',
    timeout: parseInt(process.env.API_TIMEOUT_MS || '10000'),
  },

  // NEAR RPC (для атомарного исполнения)
  near: {
    networkId: process.env.NEAR_NETWORK_ID || 'mainnet',
    nodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.mainnet.near.org',
    accountId: process.env.NEAR_ACCOUNT_ID || '',
    privateKey: process.env.NEAR_PRIVATE_KEY || '',
  },

  // Адреса (для сканера)
  addresses: {
    near: process.env.RECIPIENT_ADDRESS || '',
  },

  // Настройки сканирования
  scan: {
    intervalSec: parseInt(process.env.SCAN_INTERVAL_SEC || '30'),
    minProfitPercent: parseFloat(process.env.MIN_PROFIT_PERCENT || '0.5'),
    maxTokens: parseInt(process.env.MAX_TOKENS || '10'),
    maxPathLength: parseInt(process.env.MAX_PATH_LENGTH || '3'),
    maxWorkingTokens: parseInt(process.env.MAX_WORKING_TOKENS || '20'),
  },

  // Режимы
  dryRunOnly: process.env.DRY_RUN_ONLY === 'true',

  // Торговые настройки
  trading: {
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '100'),
    testAmountUSD: parseFloat(process.env.TEST_AMOUNT_USD || '100'),
  },

  // Executor настройки
  executor: {
    minProfitPercent: parseFloat(process.env.EXECUTOR_MIN_PROFIT_PERCENT || '0.5'),
    executionDelayMs: parseInt(process.env.EXECUTOR_DELAY_MS || '2000'),
    baseAmount: parseFloat(process.env.EXECUTOR_BASE_AMOUNT || '100'),
  },

  // Фильтрация токенов
  filters: {
    excludeSymbols: ['USDC', 'USDT', 'DAI', 'USDC.e', 'USDt', 'FRAX'],
    minPrice: 0.10,
    maxPrice: 5000,
  },

  // Токены
  tokens: {
    stablecoinSymbols: ['USDC', 'USDT', 'DAI'],
    allowedBlockchains: ['near', 'eth', 'sol', 'base', 'arb'],
  },
};

// Проверки
if (!config.api.jwtToken) {
  console.error('❌ Ошибка: JWT_TOKEN не указан в .env');
  process.exit(1);
}

if (!config.dryRunOnly) {
  if (!config.near.accountId || !config.near.privateKey) {
    console.error('❌ Ошибка: NEAR_ACCOUNT_ID и NEAR_PRIVATE_KEY обязательны');
    process.exit(1);
  }
}

console.log('✅ Конфигурация загружена');
console.log(`   Режим: ${config.dryRunOnly ? 'DRY-RUN (только сканирование)' : 'РЕАЛЬНЫЙ'}`);