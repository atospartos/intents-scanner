import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export interface Token {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: string;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export interface QuoteResponse {
  quote?: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut?: string;
    depositAddress?: string;
    timeEstimate?: number;
  };
}

export class NearIntentsClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: config.api.timeout,
      headers: {
        Authorization: `Bearer ${config.api.jwtToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getTokens(): Promise<Token[]> {
    const response = await this.client.get<Token[]>('/v0/tokens');
    return response.data;
  }

  /**
   * Получение котировки
   * @param dry true – симуляция, false – реальное создание intent
   */
  async getQuote(
    fromAsset: string,
    toAsset: string,
    amountIn: string,
    dry: boolean = true,
    minAmountOut?: string,
    recipient?: string,
    refundTo?: string
  ): Promise<QuoteResponse> {
    const deadline = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const requestBody: any = {
      dry,
      swapType: 'EXACT_INPUT',
      slippageTolerance: config.executor.slippageToleranceBps,
      originAsset: fromAsset,
      depositType: 'INTENTS',
      destinationAsset: toAsset,
      amount: amountIn,
      deadline,
    };

    if (!dry) {
      // для реального запроса обязательны recipient, refundTo и minAmountOut
      requestBody.recipient = recipient || config.addresses.near;
      requestBody.recipientType = 'INTENTS';
      requestBody.refundTo = refundTo || config.addresses.near;
      requestBody.refundType = 'INTENTS';
      if (minAmountOut) requestBody.minAmountOut = minAmountOut;
    }

    const response = await this.client.post('/v0/quote', requestBody);
    return response.data;
  }
}

export const nearIntentsClient = new NearIntentsClient();