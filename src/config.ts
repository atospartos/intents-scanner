import dotenv from 'dotenv';

dotenv.config();

export const config = {
  api: {
    baseUrl: 'https://1click.chaindefuser.com',
    jwtToken: process.env.JWT_TOKEN || '',
    timeout: 30000,
  },
  near: {
    networkId: process.env.NEAR_NETWORK_ID || 'mainnet',
    nodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.mainnet.near.org',
    accountId: process.env.NEAR_ACCOUNT_ID || '',
    privateKey: process.env.NEAR_PRIVATE_KEY || '',
  },
  addresses: {
    near: process.env.RECIPIENT_ADDRESS || '', // ваш NEAR аккаунт
  },
  scan: {
    intervalSec: parseInt(process.env.SCAN_INTERVAL_SEC || '60'), // реже, чтобы не спамить
    minProfitPercent: parseFloat(process.env.MIN_PROFIT_PERCENT || '0.2'), // 0.2% gross
    maxPathsPerScan: parseInt(process.env.MAX_PATHS_PER_SCAN || '1000'),
    testAmountUSD: parseFloat(process.env.TEST_AMOUNT_USD || '10'), // 10$ для проверки
  },
  executor: {
    enabled: false, // пока выключен
    minProfitPercent: parseFloat(process.env.EXECUTOR_MIN_PROFIT_PERCENT || '0.2'),
    baseAmountUSD: parseFloat(process.env.EXECUTOR_BASE_AMOUNT || '100'), // 100 USDC
    slippageToleranceBps: parseInt(process.env.SLIPPAGE_TOLERANCE_BPS || '30'),
    statusPollIntervalSec: 5,
    statusTimeoutSec: 120,
  },
  tokens: {
    stablecoinSymbols: ['USDC'],
    allowedBlockchains: ['eth', 'bsc', 'arb', 'base', 'avax', 'pol', 'op', 'ton', 'near', 'sol', 'sui',  'tron', 'zec', 'aptos', 'cardano', 'ltc', 'bch', 'dash'], // все поддерживаемые
    // bridged-токены определяем по .omft.near
  },
};

if (!config.api.jwtToken) {
  console.error('❌ JWT_TOKEN отсутствует');
  process.exit(1);
}