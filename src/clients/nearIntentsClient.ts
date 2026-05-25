// clients/nearIntentsClient.ts
import axios, { AxiosInstance } from 'axios';
import { QuoteRequest, QuoteResponse } from '@defuse-protocol/one-click-sdk-typescript';
import { config } from '../config';

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: string;
  priceUpdatedAt: string;
  contractAddress?: string;
}

export class NearIntentsClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: config.api.timeout,
      headers: { 'Authorization': `Bearer ${config.api.jwtToken}`, 'Content-Type': 'application/json' },
    });
  }

  async getQuote(params: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    dry: boolean;
    quoteWaitingTimeMs?: number;
  }): Promise<QuoteResponse> {
    const request = {
      dry: params.dry,
      swapType: QuoteRequest.swapType.EXACT_INPUT,
      slippageTolerance: config.trading.slippageToleranceBps,
      originAsset: params.originAsset,
      depositType: QuoteRequest.depositType.INTENTS,
      destinationAsset: params.destinationAsset,
      amount: params.amount,
      refundTo: config.addresses.near,
      refundType: QuoteRequest.refundType.INTENTS,
      recipient: config.addresses.near,
      recipientType: QuoteRequest.recipientType.INTENTS,
      deadline: new Date(Date.now() + 60 * 1000).toISOString(),
      quoteWaitingTimeMs: params.quoteWaitingTimeMs || 3000,
    };
    const response = await this.client.post('/v0/quote', request);
    return response.data;
  }

  async getTokens(): Promise<Token[]> {
    const response = await this.client.get<Token[]>('/v0/tokens');
    return response.data;
  }

  async getTokenById(assetId: string): Promise<Token | undefined> {
    const tokens = await this.getTokens();
    return tokens.find(t => t.assetId === assetId);
  }
}

export const nearIntentsClient = new NearIntentsClient