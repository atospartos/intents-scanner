import dotenv from 'dotenv';
dotenv.config();

export const config = {
  api: {
    baseUrl: 'https://1click.chaindefuser.com',
    jwtToken: process.env.JWT_TOKEN || '',
    timeout: 3000,
    rateLimitPerSecond: 10,
  },

  // Стейблкоин, на котором начинаем и заканчиваем (должен быть на NEAR)
  stableToken: {
    assetId: process.env.STABLE_ASSET_ID || 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', // USDC на NEAR
    symbol: 'USDC',
    blockchain: 'near',
    decimals: 6,
  },

  addresses: {
    near: process.env.NEAR_ACCOUNT_ID || 'b817fd571bfb3272bafc2961f92c947d7ed63a4f23758ee23d00d60190440b4b',      // для INTENTS
  },

  scan: {
    minLiquidityRatio: 0.95,          // выход должен быть ≥99% от входа
    minProfitPercent: 0.1,           // минимальная прибыль 0.01%
    maxWorkingTokens: 100,
    maxCycleLength: 4,                // макс. шагов в цикле (3,4,5)
    enableStableCycles: true,         // искать циклы со стейблами
    enableAltcoinCycles: true,        // искать циклы только между альткоинами
    rateCacheTTL: 60000,              // 60 секунд
    intervalSec: parseInt(process.env.SCAN_INTERVAL_SEC || '5'),
  },

  dryRunOnly: process.env.DRY_RUN_ONLY === 'true',  // для сканера всегда true

  trading: {
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '30'),
    testAmountUSD: 100,
  },

  filters: {
    excludeSymbols: [],
    minPrice: 0.000000000000001,
    maxPrice: 1000000000000000,
  },
  whitelistAssets: ['ETH', 'WETH', 'USD1', 'USDT', 'USDT0', 'DASH', 'DAI', 'xDAI', 'SOL', 'cbBTC', 'xBTC', 'BTC', 'ZEC', 'wBTC', 'WBTC', 'wNEAR', 'SUI', 'BNB', 'ASTER', 'POL', 'TRX', 'TON', 'OP', 'LTC', 'AVAX', 'XAUT', 'AAVE', 'XRP'],
  stableSymbols: ['USDC'],
  allowedBlockchains: ['near', 'eth', 'arb', 'base', 'bsc', 'avax', 'pol', 'op', 'sol', 'zec', 'dash', 'ton', 'gnosis', 'sui', 'ltc', 'aptos', 'cardano', 'stellar', 'xrp', 'btc'],
};

if (!config.api.jwtToken) throw new Error('❌ JWT_TOKEN не задан');
if (!config.dryRunOnly && !config.addresses.near) throw new Error('❌ Для реального исполнения нужен NEAR_RECIPIENT_ADDRESS');