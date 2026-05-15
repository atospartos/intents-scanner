// src/intents/swap-tokens-near.ts

import {
  authIdentity,
  AuthMethod,
  messageFactory,
  solverRelay,
} from '@defuse-protocol/internal-utils';
import {
  OneClickService,
  QuoteRequest,
  QuoteResponse,
  OpenAPI
} from '@defuse-protocol/one-click-sdk-typescript';
import { base64 } from '@scure/base';
import { Account } from 'near-api-js';
import { fileURLToPath } from 'url';
import { parseUnits } from 'viem';
// import { getTokenById, Token } from './get-tokens-list';
import { intentsSdk } from './utils/config';
import { getNearIntentsSigner } from './utils/near-config';
import { Token, nearIntentsClient } from '../clients/nearIntentsClient';

OpenAPI.BASE = 'https://1click.chaindefuser.com';
OpenAPI.TOKEN = process.env.JWT_TOKEN;
/**
 * Request a swap quote from the 1-Click API.
 * All addresses are set to INTENTS — tokens move within the intents ledger, not on external chains.
 */
export const getSwapQuote = async ({
  originAsset,
  destinationAsset,
  amountIn,
}: {
  originAsset: Token;
  destinationAsset: Token;
  amountIn: string;
}): Promise<QuoteResponse> => {


  const { authIdentifier } = await getNearIntentsSigner();

  // Set a generous deadline for the quote (20 minutes)
  const deadline = new Date();
  deadline.setSeconds(deadline.getSeconds() + 60 * 20);

  const quoteResponse = await OneClickService.getQuote({
    deadline: deadline.toISOString(), // Quote expires after this time
    recipient: authIdentifier, // Swapped tokens go back to your intents account
    recipientType: QuoteRequest.recipientType.INTENTS, // Recipient is inside intents (not external chain)
    refundTo: authIdentifier, // If swap fails, refund to your intents account
    refundType: QuoteRequest.refundType.INTENTS, // Refund stays inside intents
    depositType: QuoteRequest.depositType.INTENTS, // Source tokens are already inside intents
    dry: false, // Live quote (not a dry run)
    slippageTolerance: 100, // Max slippage: 100 basis points = 1.00%
    swapType: QuoteRequest.swapType.EXACT_INPUT, // Fixed input amount, output varies
    originAsset: originAsset.assetId, // Source token asset ID
    destinationAsset: destinationAsset.assetId, // Destination token asset ID
    amount: amountIn, // Amount in smallest unit of the source token
  });
  return quoteResponse;
};



export const submitSwap = async ({
  quote,
  account,
  authIdentifier,
  authMethod,
}: {
  quote: QuoteResponse;
  account: Account;
  authIdentifier: string;
  authMethod: AuthMethod;
}) => {
  try {
    // Get a unique nonce and deadline from the intent builder
    // The nonce prevents replay attacks; the deadline ensures the intent expires
    const { nonce, deadline } = await intentsSdk
      .intentBuilder()
      .setDeadline(new Date(quote.quote.deadline ?? ''))
      .build();

    const tokenInAssetId = quote.quoteRequest.originAsset;

    // Derive the intents-internal signer ID from the NEAR account
    const signerId = authIdentity.authHandleToIntentsUserId(
      authIdentifier,
      authMethod,
    );

    // Build the inner-transfer message — this authorizes the intents contract
    // to move your tokens from your account to the solver's deposit address
    const innerMessage = messageFactory.makeInnerTransferMessage({
      tokenDeltas: [[tokenInAssetId, BigInt(quote.quoteRequest.amount)]], // [token, amount] pairs to transfer
      signerId, // Your intents-internal account ID
      deadlineTimestamp: Date.parse(deadline), // Intent expiration (milliseconds)
      receiverId: quote.quote.depositAddress as string, // Solver's deposit address (from quote)
      memo: undefined, // Optional memo
    });

    // Wrap the inner message into the NEP-413 format that NEAR wallets can sign
    const walletMessage = messageFactory.makeSwapMessage({
      innerMessage,
      nonce: base64.decode(nonce), // Unique nonce as raw bytes
    });

    // Sign with the NEAR wallet using NEP-413 (off-chain message signing standard)
    // NEP-413 includes: message, nonce, recipient — all verified by the intents contract
    const signatureIntent = await account.signNep413Message({
      message: walletMessage.NEP413.message, // The human-readable message to sign
      nonce: walletMessage.NEP413.nonce, // Unique nonce (prevents replay)
      recipient: walletMessage.NEP413.recipient, // Intended recipient contract (intents.near)
    });

    // Publish the signed intent to the solver relay network
    // Solvers see your order and compete to fill it at the best price
    const publishResult = await solverRelay.publishIntent(
      {
        type: 'NEP413', // Signature type — tells the verifier to use NEP-413 validation
        signatureData: {
          accountId: signatureIntent.accountId, // Your NEAR account ID
          publicKey: signatureIntent.publicKey.toString(), // Public key that signed (ed25519:...)
          signature: base64.encode(signatureIntent.signature), // Base64-encoded ed25519 signature
        },
        signedData: walletMessage.NEP413, // The NEP-413 payload that was signed
      },
      { userAddress: authIdentifier, userChainType: authMethod }, // Your identity for the solver
      [], // Additional solver hints (empty = use defaults)
    );
    if (publishResult.isErr()) {
      throw new Error(publishResult.unwrapErr().message);
    }

    // Wait for a solver to fill the order and the intent to settle on-chain
    const { hash } = await intentsSdk.waitForIntentSettlement({
      intentHash: publishResult.unwrap(),
    });

    // Notify the 1-Click API about the settlement (for tracking/analytics)
    const depositResponse = await OneClickService.submitDepositTx({
      txHash: hash,
      depositAddress: quote.quote.depositAddress as string,
    });
    return {
      depositResponse,
      txHash: hash,
    };
  } catch (error) {
    console.error('Error submitting one click quote:', error);
    throw error;
  }
};