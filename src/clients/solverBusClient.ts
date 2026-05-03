// src/clients/solverBusClient.ts
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

// ============ ТИПЫ В СООТВЕТСТВИИ С ДОКУМЕНТАЦИЕЙ ============

export type DefuseAssetId = string; // формат: "nep141:token.near"

export interface QuoteRequest {
  defuse_asset_identifier_in: DefuseAssetId;
  defuse_asset_identifier_out: DefuseAssetId;
  exact_amount_in?: string;      // ИЛИ exact_amount_out
  exact_amount_out?: string;
  min_deadline_ms?: number;      // Минимальное время жизни квоты
}

export interface QuoteResponse {
  quote_hash: string;             // КЛЮЧЕВОЙ: хэш для publish_intent
  defuse_asset_identifier_in: string;
  defuse_asset_identifier_out: string;
  amount_in: string;
  amount_out: string;
  expiration_time: string;        // ISO timestamp
  solver_id: string;
  solver_signature?: string;
}

export interface Intent {
  intent: 'swap' | 'swap_multi';
  amount: string;
  asset_in: string;
  asset_out: string;
  path?: string[];               // Для multi-swap
}

export interface SignedIntent {
  signer_id: string;
  nonce: number;
  intent: Intent;
  signature: string;
}

export interface PublishIntentRequest {
  quote_hashes: string[];        // Массив хэшей от getQuote
  signed_data: SignedIntent;
}

// ============ JSON-RPC ТИПЫ ============

export interface JsonRpcRequest<T> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: T;
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// ============ КЛИЕНТ ============

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
        throw new Error(`RPC Error ${response.data.error.code}: ${response.data.error.message}`);
      }

      return response.data.result as T;
    } catch (error: any) {
      logger.error(`RPC call ${method} failed: ${error.message}`);
      throw error;
    }
  }

  // Исправленный getQuote с полной поддержкой документации
  async getQuote(
    fromAsset: DefuseAssetId,
    toAsset: DefuseAssetId,
    options: {
      exact_amount_in?: string;
      exact_amount_out?: string;
      min_deadline_ms?: number;
    }
  ): Promise<QuoteResponse[]> {
    if (!options.exact_amount_in && !options.exact_amount_out) {
      throw new Error('Необходимо указать exact_amount_in или exact_amount_out');
    }
    
    logger.debug(`📊 Запрос квоты: ${fromAsset} → ${toAsset}`);
    
    const request: QuoteRequest = {
      defuse_asset_identifier_in: fromAsset,
      defuse_asset_identifier_out: toAsset,
      ...(options.exact_amount_in && { exact_amount_in: options.exact_amount_in }),
      ...(options.exact_amount_out && { exact_amount_out: options.exact_amount_out }),
      min_deadline_ms: options.min_deadline_ms || 60000,
    };

    const quotes = await this.rpcCall<QuoteResponse[]>('quote', [request]);
    
    logger.debug(`   Получено ${quotes.length} квот`);
    return quotes;
  }

  // Получить лучшую квоту (максимальный выход)
  async getBestQuote(
    fromAsset: DefuseAssetId,
    toAsset: DefuseAssetId,
    amountIn: string
  ): Promise<QuoteResponse | null> {
    const quotes = await this.getQuote(fromAsset, toAsset, { exact_amount_in: amountIn });
    
    if (quotes.length === 0) return null;
    
    // Сортируем по amount_out (чем больше, тем лучше)
    quotes.sort((a, b) => parseFloat(b.amount_out) - parseFloat(a.amount_out));
    
    return quotes[0];
  }

  // Исправленный publishIntent
  async publishIntent(
    quoteHashes: string[],
    signedIntent: SignedIntent
  ): Promise<string> {
    logger.info(`📤 Публикация интента от ${signedIntent.signer_id}`);
    logger.debug(`   Intent: ${signedIntent.intent.intent}`);
    logger.debug(`   Quote hashes: ${quoteHashes.join(', ')}`);
    
    const request: PublishIntentRequest = {
      quote_hashes: quoteHashes,
      signed_data: signedIntent,
    };

    const result = await this.rpcCall<{ transaction_hash: string }>('publish_intent', [request]);
    
    logger.info(`✅ Интент опубликован! TX: ${result.transaction_hash}`);
    return result.transaction_hash;
  }

  // Вспомогательный метод для создания multi-swap интента
  createMultiSwapIntent(
    signerId: string,
    nonce: number,
    amountIn: string,
    assetIn: string,
    assetOut: string,
    path: string[],
    privateKey: any  // near-api-js KeyPair
  ): SignedIntent {
    const intent: Intent = {
      intent: 'swap_multi',
      amount: amountIn,
      asset_in: assetIn,
      asset_out: assetOut,
      path,
    };
    
    // Формируем сообщение для подписи
    const message = JSON.stringify({
      signer_id: signerId,
      nonce,
      intent,
    });
    
    // Подписываем (детали зависят от near-api-js)
    const signature = privateKey.sign(Buffer.from(message)).toString();
    
    return {
      signer_id: signerId,
      nonce,
      intent,
      signature,
    };
  }
}

export const solverBusClient = new SolverBusClient();