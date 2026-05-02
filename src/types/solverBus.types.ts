// Формат assetId в Solver Bus (отличается от 1Click API!)
export type DefuseAssetId = 
  | `nep141:${string}`      // NEAR NEP-141 токены
  | `eth:${string}`          // Ethereum (нативный)
  | `sol:${string}`          // Solana
  | `sui:${string}`          // Sui
  | `btc:${string}`;         // Bitcoin

export interface QuoteRequest {
  defuse_asset_identifier_in: DefuseAssetId;
  defuse_asset_identifier_out: DefuseAssetId;
  exact_amount_in: string;   // В наименьшей единице (wei/satoshi)
}

export interface QuoteResponse {
  defuse_asset_identifier_in: DefuseAssetId;
  defuse_asset_identifier_out: DefuseAssetId;
  amount_in: string;
  amount_out: string;
  solver_id: string;
  quote_hash: string;
  signature: string;
  expiry: number;            // UNIX timestamp
}

export interface Intent {
  intent: 'token_diff';
  diff: Record<DefuseAssetId, string>;  // Положительные и отрицательные изменения
}

export interface SignedIntent {
  signer_id: string;          // NEAR аккаунт или Solver ID
  deadline: string;           // ISO 8601
  intents: Intent[];
  signature?: string;
}

export interface PublishIntentRequest {
  quote_hashes: string[];
  signed_data: SignedIntent;
}

// JSON-RPC обёртки
export interface JsonRpcRequest<T> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: T;
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}