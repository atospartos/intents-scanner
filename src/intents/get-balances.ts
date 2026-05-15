import { authIdentity, AuthMethod } from '@defuse-protocol/internal-utils';
import { formatUnits } from 'viem';
import { getTokens } from './get-tokens-list';
import { nearJsonRpcProvider } from './utils/config';
import { getSigner } from './utils/signer';

export const getTokenBalances = async ({
  authIdentifier,
  authMethod,
}: {
  authIdentifier: string;
  authMethod: AuthMethod;
}) => {
  try {
    // Convert wallet address → intents-internal account ID
    // NEAR addresses map to themselves; EVM addresses are hashed into a deterministic NEAR-style ID
    const accountId = authIdentity.authHandleToIntentsUserId(
      authIdentifier,
      authMethod,
    );

    // Fetch the full token registry so we can query balances for every known token
    const supportedTokens = await getTokens();
    const tokenIds = supportedTokens.map((token) => token.assetId);

    // Query the intents.near contract using the NEP-245 multi-token standard
    // `mt_batch_balance_of` returns an array of string balances in the same order as `token_ids`
    const balancesResult = await nearJsonRpcProvider.callFunction<string[]>({
      contractId: 'intents.near', // The core intents smart contract on NEAR mainnet
      method: 'mt_batch_balance_of', // NEP-245 batch balance query
      args: {
        account_id: accountId, // Your intents-internal account ID
        token_ids: tokenIds, // All supported token asset IDs
      },
    });

    // Convert string balances to BigInt and map them by token ID
    const amounts = (balancesResult ?? []).map(BigInt).reduce(
      (acc, amount, index) => {
        acc[tokenIds[index]] = amount;
        return acc;
      },
      {} as Record<string, bigint>,
    );

    // Merge token metadata with balances and format for display
    const result = supportedTokens.map((token) => ({
      ...token,
      balance: String(amounts[token.assetId]), // Raw balance in smallest unit
      balanceFormatted: formatUnits(amounts[token.assetId], token.decimals), // Human-readable (e.g. "1.5" NEAR)
    }));

    // Only return tokens with non-zero balances
    return result.filter((token) => token.balance !== '0');
  } catch (error) {
    console.error(error);
    return [];
  }
};

const main = async () => {
  // Auto-detect signer type (NEAR or EVM) based on which .env key is set
  const { authIdentifier, authMethod } = await getSigner();
  console.log('Fetching balances for intents user...');
  console.log(`Auth identifier: ${authIdentifier}`);
  console.log(`Auth method: ${authMethod}`);

  const balances = await getTokenBalances({
    authIdentifier,
    authMethod,
  });

  console.log(`Found ${balances.length} token balances:\n`);
  console.table(
    balances.map((token) => ({
      assetName: token.symbol, // Token ticker (e.g. "NEAR", "USDC")
      intentsTokenId: token.assetId, // Full intents asset ID
      balance: token.balance, // Raw balance in smallest unit
      balanceFormatted: token.balanceFormatted, // Human-readable balance
    })),
  );
};

// if (require.main === module) {
//   main().catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });
// }