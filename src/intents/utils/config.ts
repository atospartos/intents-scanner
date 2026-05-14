import { IntentsSDK } from '@defuse-protocol/intents-sdk';
import { JsonRpcProvider } from 'near-api-js';

// The Intents SDK instance — used for building intents, signing, and settlement
export const intentsSdk = new IntentsSDK({
  env: 'production', // NEAR mainnet — use 'staging' for testnet
  referral: 'near-intents-examples', // Referral tag for analytics/fee sharing
});

// NEAR RPC provider — used for view calls (balances, key checks) without gas
export const nearJsonRpcProvider = new JsonRpcProvider({
  url: 'https://rpc.mainnet.fastnear.com', // FastNEAR — low-latency NEAR RPC endpoint
});
