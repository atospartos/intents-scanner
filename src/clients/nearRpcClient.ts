// src/clients/nearRpcClient.ts
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Ed25519Key, hash256, uint8ArrayToBase64, stringToUint8Array } from '../utils/crypto';
import { 
  serializeTransaction, 
  serializeSignedTransaction, 
  hexToUint8Array,
  uint8ArrayToHex,
  Transaction,
  SignedTransaction,
  Action
} from '../utils/borsh';

// Типы ответов RPC
export interface RpcResponse<T = any> {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface AccountInfo {
  amount: string;
  locked: string;
  codeHash: string;
  storageUsage: number;
  nonce: number;
}

export interface BlockHeader {
  hash: string;
  height: number;
  timestamp: number;
}

export interface BlockResult {
  header: {
    hash: string;
    height: number;
    timestamp: number;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface TransactionResult {
  transaction_hash: string;
  status: string;
}

export interface SendTxResult {
  transaction: {
    hash: string;
    [key: string]: any;
  };
  final_execution_status: string;
  [key: string]: any;
}

export class NearRpcClient {
  private rpcUrl: string;
  private accountId: string;
  private key: Ed25519Key;

  constructor() {
    this.rpcUrl = config.near.nodeUrl;
    this.accountId = config.near.accountId;
    this.key = new Ed25519Key(config.near.privateKey);
  }

  private async rpcCall<T = any>(method: string, params: any): Promise<T> {
    const response = await axios.post<RpcResponse<T>>(this.rpcUrl, {
      jsonrpc: '2.0',
      id: 'dontcare',
      method,
      params
    }, {
      timeout: config.api.timeout,
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data.error) {
      throw new Error(`RPC Error (${response.data.error.code}): ${response.data.error.message}`);
    }

    if (response.data.result === undefined) {
      throw new Error(`RPC Error: No result in response for method ${method}`);
    }

    return response.data.result;
  }

  async getAccount(): Promise<AccountInfo> {
    const result = await this.rpcCall<{
      amount: string;
      locked: string;
      code_hash: string;
      storage_usage: number;
      nonce: number;
    }>('query', {
      request_type: 'view_account',
      finality: 'final',
      account_id: this.accountId
    });
    
    return {
      amount: result.amount,
      locked: result.locked,
      codeHash: result.code_hash,
      storageUsage: result.storage_usage,
      nonce: result.nonce
    };
  }

  async getLatestBlock(): Promise<BlockHeader> {
    const result = await this.rpcCall<BlockResult>('block', { finality: 'final' });
    
    return {
      hash: result.header.hash,
      height: result.header.height,
      timestamp: result.header.timestamp
    };
  }

  async createAndSignTransaction(
    receiverId: string,
    actions: Action[],
    nonce: number,
    blockHash: string
  ): Promise<string> {
    // Формируем транзакцию
    const transaction: Transaction = {
      signerId: this.accountId,
      publicKey: {
        keyType: 0,
        data: this.key.publicKey
      },
      nonce: BigInt(nonce + 1),
      receiverId: receiverId,
      blockHash: hexToUint8Array(blockHash),
      actions: actions
    };

    // Сериализуем транзакцию
    const serializedTx = serializeTransaction(transaction);
    
    // Хешируем для подписи
    const hash = hash256(serializedTx);
    
    // Подписываем
    const signature = await this.key.sign(hash);
    
    // Формируем подписанную транзакцию
    const signedTransaction: SignedTransaction = {
      transaction: transaction,
      signature: {
        keyType: 0,
        data: signature
      }
    };
    
    // Сериализуем подписанную транзакцию
    const serializedSignedTx = serializeSignedTransaction(signedTransaction);
    
    // Конвертируем в base64 для отправки
    return uint8ArrayToBase64(serializedSignedTx);
  }

  async sendTransaction(signedTxBase64: string, waitUntil: string = 'EXECUTED_OPTIMISTIC'): Promise<TransactionResult> {
    const result = await this.rpcCall<SendTxResult>('send_tx', {
      signed_tx_base64: signedTxBase64,
      wait_until: waitUntil
    });
    
    return {
      transaction_hash: result.transaction.hash,
      status: result.final_execution_status
    };
  }

  async getTransactionStatus(txHash: string): Promise<any> {
    const result = await this.rpcCall('tx', {
      tx_hash: txHash,
      sender_account_id: this.accountId,
      wait_until: 'EXECUTED'
    });
    
    return result;
  }

  async getBalance(): Promise<string> {
    const account = await this.getAccount();
    const balanceInYocto = BigInt(account.amount);
    const balanceInNear = Number(balanceInYocto) / 1e24;
    return balanceInNear.toFixed(4);
  }
}

export const nearRpcClient = new NearRpcClient();