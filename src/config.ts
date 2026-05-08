import dotenv from 'dotenv';
dotenv.config();

export const config = {
  api: {
    baseUrl: 'https://1click.chaindefuser.com',
    jwtToken: process.env.JWT_TOKEN || '',
    timeout: parseInt(process.env.API_TIMEOUT_MS || '15000'),
  },

  // Стейблкоин, на котором начинаем и заканчиваем (должен быть на NEAR)
  stableToken: {
    assetId: process.env.STABLE_ASSET_ID || 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', // USDC на NEAR
    symbol: 'USDC',
    blockchain: 'near',
    decimals: 6,
  },

  addresses: {
    near: process.env.NEAR_RECIPIENT_ADDRESS || 'partos.near',      // для INTENTS
    evm: process.env.EVM_RECIPIENT_ADDRESS || '0xCE65672051c80e100FbF1571dC7FF8353F0CF633',        // 0x... для EVM-сетей (Ethereum, Arbitrum, Base и т.д.)
    sol: process.env.SOL_RECIPIENT_ADDRESS || '',        // опционально
  },

  scan: {
    intervalSec: parseInt(process.env.SCAN_INTERVAL_SEC || '5'),
    minProfitPercent: parseFloat(process.env.MIN_PROFIT_PERCENT || '0.01'),   // 0.1%
    maxWorkingTokens: parseInt(process.env.MAX_WORKING_TOKENS || '100'),
  },

  dryRunOnly: process.env.DRY_RUN_ONLY === 'true',  // для сканера всегда true

  trading: {
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '100'),
    testAmountUSD: parseFloat(process.env.TEST_AMOUNT_USD || '100'),
  },

  filters: {
    excludeSymbols: ['USDC'],
    minPrice: 0.001,
    maxPrice: 100000,
  },

  allowedBlockchains: ['near', 'eth', 'arb', 'base', 'bsc', 'avax', 'pol', 'op'],
};

if (!config.api.jwtToken) throw new Error('❌ JWT_TOKEN не задан');
if (!config.dryRunOnly && !config.addresses.near) throw new Error('❌ Для реального исполнения нужен NEAR_RECIPIENT_ADDRESS');

console.log(`✅ Конфигурация загружена. Режим: ${config.dryRunOnly ? 'DRY-RUN' : 'РЕАЛЬНЫЙ'}`);