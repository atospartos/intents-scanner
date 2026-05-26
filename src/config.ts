import dotenv from 'dotenv';
dotenv.config();

export const config = {
  api: {
    baseUrl: 'https://1click.chaindefuser.com',
    jwtToken: process.env.JWT_TOKEN || '',
    timeout: 3000,
    rateLimitPerSecond: 5,
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
    maxCycleLength: 4,                // макс. шагов в цикле (2,3,4,5)
    enableStableCycles: true,         // искать циклы со стейблами
    enableAltcoinCycles: true,        // искать циклы только между альткоинами
    rateCacheTTL: 60000,              // 60 секунд
    intervalSec: 5,
  },

  dryRunOnly: process.env.DRY_RUN_ONLY === 'true',  // для сканера всегда true

  trading: {
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '10'),
    testAmountUSD: 100,
  },

  filters: {
    excludeSymbols: [],
    minPrice: 0.000000000000001,
    maxPrice: 1000000000000000,
  },
  whitelistAssets: ['wNEAR', 'ASTER', 'AAVE', 'POL', 'OP', 'LTC', 'AVAX', 'TRX',, 'SUI', 'BNB',  'XAUT', 'XRP', 'DAI', 'xDAI', 'USDT0', 'USD1', 'USDC', 'USDT', 'ETH', 'WETH', 'BTC', 'WBTC', 'cbBTC', 'xBTC', 'wBTC', 'SOL', 'ZEC', 'DASH', 'TON'], // 
  stableSymbols: ['USDC', 'USDT'], // 'DAI', 'USDT0', 'USD1', 'xDAI', 'DAI'
  allowedBlockchains: ['near', 'eth', 'arb', 'base', 'bsc', 'avax', 'pol', 'op', 'sol', 'zec', 'dash', 'ton', 'sui', 'xrp', 'btc'], // 'ltc', 'gnosis', 'aptos', 'cardano', 'stellar',
};

if (!config.api.jwtToken) throw new Error('❌ JWT_TOKEN не задан');
if (!config.dryRunOnly && !config.addresses.near) throw new Error('❌ Для реального исполнения нужен NEAR_RECIPIENT_ADDRESS');