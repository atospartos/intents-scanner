import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: string;
  priceUpdatedAt: string;
  contractAddress: string;
}

export interface QuoteResponse {
  quote?: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number;
    depositAddress?: string;
  };
}

export class NearIntentsClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: 30000, // Увеличиваем до 30 секунд
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

  async getQuote(
    fromAsset: string,
    toAsset: string,
    amountIn: string,
    recipient: string,
    refundTo: string,
    dry: boolean = true
  ): Promise<QuoteResponse> {
    const deadline = new Date(Date.now() + 60 * 1000).toISOString();
    
    const request = {
      dry: dry,
      swapType: 'EXACT_INPUT',
      slippageTolerance: config.trading.slippageToleranceBps,
      originAsset: fromAsset,
      depositType: 'INTENTS',
      destinationAsset: toAsset,
      amount: amountIn,
      refundTo: refundTo,
      refundType: 'INTENTS',
      recipient: recipient,
      recipientType: 'INTENTS',
      deadline: deadline,
      quoteWaitingTimeMs: 5000,
    };
    
    const response = await this.client.post('/v0/quote', request);
    return response.data;
  }
}

export const nearIntentsClient = new NearIntentsClient();