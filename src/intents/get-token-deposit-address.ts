import {
  authIdentity,
  type AuthMethod,
  poaBridge,
} from '@defuse-protocol/internal-utils';
import { fileURLToPath } from 'node:url';
import { getTokenById, Token } from './get-tokens-list';
import { assetNetworkAdapter } from './utils/chains';
import { getSigner } from './utils/signer';

/**
 * Determine the deposit mode for a given blockchain.
 * Most chains use SIMPLE (just an address), but Stellar requires MEMO
 * (a shared address + unique memo to identify the depositor).
 */
const getDepositMode = (blockchain: string) => {
  switch (blockchain) {
    case 'stellar':
      return 'MEMO';
    default:
      return 'SIMPLE';
  }
};

export async function getDepositAddress({
  authIdentifier,
  authMethod,
  token,
}: {
  authIdentifier: string;
  authMethod: AuthMethod;
  token: Token;
}) {
  let depositAddress: string;
  let memo: string | null;
  try {
    // Convert wallet address → intents-internal account ID
    const account_id = authIdentity.authHandleToIntentsUserId(
      authIdentifier,
      authMethod,
    );

    // Request a deposit address from the POA (Proof of Authority) bridge
    // The bridge maps your intents account to a unique address on the source chain
    const quoteResponse = await poaBridge.httpClient.getDepositAddress({
      account_id, // Your intents-internal account ID (tokens will be credited here)
      chain: assetNetworkAdapter[token.blockchain], // Target chain enum (e.g. BlockchainEnum.NEAR)
      deposit_mode: getDepositMode(token.blockchain), // SIMPLE for most chains, MEMO for Stellar
    });

    if (!quoteResponse.address) {
      throw new Error('Deposit address not found');
    }
    memo = quoteResponse.memo ?? null; // Memo is only present for MEMO-mode chains (e.g. Stellar)
    depositAddress = quoteResponse.address;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to get deposit address');
  }

  return {
    address: depositAddress,
    memo,
  };
}