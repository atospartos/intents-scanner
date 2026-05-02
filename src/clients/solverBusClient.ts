import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { 
  QuoteRequest, 
  QuoteResponse, 
  SignedIntent, 
  PublishIntentRequest,
  JsonRpcRequest,
  JsonRpcResponse,
  DefuseAssetId 
} from '../types/solverBus.types';

export class SolverBusClient {
  private rpcUrl: string;
  private requestId = 0;

  constructor() {
    this.rpcUrl = process.env.SOLVER_BUS_RPC_URL || 'https://solver-relay.chaindefuser.com/rpc';
  }

  private async rpcCall<T>(method: string, params: any[]): Promise<T> {
    const requestId = ++this.requestId;
    const request: JsonRpcRequest<any[]> = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    try {
      const response = await axios.post<JsonRpcResponse<T>>(this.rpcUrl, request, {
        timeout: config.api.timeout,
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result as T;
    } catch (error: any) {
      logger.error(`RPC call ${method} failed: ${error.message}`);
      throw error;
    }
  }

  async getQuote(fromAsset: DefuseAssetId, toAsset: DefuseAssetId, amountIn: string): Promise<QuoteResponse[]> {
    logger.debug(`📊 Запрос квоты: ${fromAsset} → ${toAsset}`);
    
    const request: QuoteRequest = {
      defuse_asset_identifier_in: fromAsset,
      defuse_asset_identifier_out: toAsset,
      exact_amount_in: amountIn,
    };

    const quotes = await this.rpcCall<QuoteResponse[]>('quote', [request]);
    
    return quotes;
  }

  async getBestQuote(fromAsset: DefuseAssetId, toAsset: DefuseAssetId, amountIn: string): Promise<QuoteResponse | null> {
    const quotes = await this.getQuote(fromAsset, toAsset, amountIn);
    
    if (quotes.length === 0) return null;
    
    quotes.sort((a, b) => parseFloat(b.amount_out) - parseFloat(a.amount_out));
    
    return quotes[0];
  }

  async publishIntent(intent: SignedIntent, quoteHashes: string[]): Promise<string> {
    logger.info(`📤 Публикация интента от ${intent.signer_id}`);
    
    const request: PublishIntentRequest = {
      quote_hashes: quoteHashes,
      signed_data: intent,
    };

    const result = await this.rpcCall<{ transaction_hash: string }>('publish_intent', [request]);
    
    return result.transaction_hash;
  }
}

export const solverBusClient = new SolverBusClient();