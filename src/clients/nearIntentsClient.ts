import axios, { AxiosInstance } from 'axios';
import {
  OneClickService,
  QuoteRequest,
  QuoteResponse,
  OpenAPI
} from '@defuse-protocol/one-click-sdk-typescript';
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

// export interface QuoteResponse {
//   quote?: {
//     amountIn: string;
//     amountInFormatted: string;
//     amountInUsd: string;
//     amountOut: string;
//     amountOutFormatted: string;
//     amountOutUsd: string;
//     minAmountOut: string;
//     timeEstimate: number;
//     depositAddress?: string;
//     transactionId?: string;
//   };
//   error?: string;
// }

export class NearIntentsClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: config.api.timeout,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'Authorization': `Bearer ${config.api.jwtToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getTokens(): Promise<Token[]> {
    const response = await this.client.get<Token[]>('/v0/tokens');
    return response.data;
  }

  async getQuote(params: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    dry: boolean;
    deadline?: string;
    quoteWaitingTimeMs?: number;
  }): Promise<QuoteResponse> {
    OpenAPI.BASE = 'https://1click.chaindefuser.com';
    OpenAPI.TOKEN = process.env.JWT_TOKEN;
    const defaultDeadline = new Date(Date.now() + 60 * 1000).toISOString();
    
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
      deadline: defaultDeadline,
      quoteWaitingTimeMs: params.quoteWaitingTimeMs || 5000,
    };
    const response = await this.client.post('/v0/quote', request);
    return response.data;
  }

  async getStatus(transactionId: string): Promise<{ status: string }> {
    const response = await this.client.get(`/v0/status/${transactionId}`);
    return response.data;
  }
}

export const nearIntentsClient = new NearIntentsClient();