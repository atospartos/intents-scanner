// src/clients/nearRpcClient.ts
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { 
  Ed25519Key, 
  hash256, 
  uint8ArrayToBase64, 
  stringToUint8Array,
  uint8ArrayToHex  // ← ДОБАВЛЯЕМ ЭТОТ ИМПОРТ
} from '../utils/crypto';
import { 
  serializeTransaction, 
  serializeSignedTransaction, 
  hexToUint8Array,
  Transaction,
  SignedTransaction,
  Action
} from '../utils/borsh';
import crypto from 'crypto';

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
  private key: Ed25519Key | null = null;
  private initialized: boolean = false;

  constructor() {
    this.rpcUrl = config.near.nodeUrl;
    this.accountId = config.near.accountId;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    
    if (!config.near.privateKey || config.near.privateKey === '') {
      throw new Error('NEAR_PRIVATE_KEY не указан');
    }
    
    this.key = new Ed25519Key(config.near.privateKey);
    this.initialized = true;
    logger.info(`🔐 Криптография инициализирована`);
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  public async rpcCall<T = any>(method: string, params: any): Promise<T> {
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

  // Добавляем метод для создания подписанного интента по NEP-413
async createSignedIntent(
  intent: any,
  nonce: string,
  deadline: string,
  recipientId: string = 'intents.near'
): Promise<any> {
  await this.ensureInit();
  
  if (!this.key) {
    throw new Error('Ключ не инициализирован');
  }
  
  // Формируем сообщение по спецификации NEP-413
  const message = {
    signer_id: this.accountId,
    deadline: deadline,
    intents: [intent],
    recipient_id: recipientId,
    nonce: nonce
  };
  
  const messageJson = JSON.stringify(message);
  const messageHash = hash256(stringToUint8Array(messageJson));
  
  // Подписываем хеш сообщения
  const signature = await this.key.sign(messageHash);
  
  // Формируем подписанный интент
  return {
    standard: "nep413",
    payload: {
      signer_id: this.accountId,
      deadline: deadline,
      intents: [intent],
      recipient_id: recipientId,
      nonce: nonce
    },
    public_key: this.key.getPublicKeyString(),
    signature: `ed25519:${uint8ArrayToHex(signature)}`
  };
}

// Получение случайного nonce
getRandomNonce(): string {
  const randomBytes = crypto.randomBytes(32);
  return uint8ArrayToBase64(randomBytes);
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

  // ===== ПОЛУЧЕНИЕ ТЕКУЩЕЙ СОЛИ =====
async getCurrentSalt(): Promise<string> {
  const argsBase64 = "e30="; // пустые аргументы в base64
  const result = await this.rpcCall<any>('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: 'intents.near',
    method_name: 'current_salt',
    args_base64: argsBase64
  });
  
  if (result.result && result.result.length > 0) {
    return Buffer.from(result.result).toString();
  }
  return "";
}

  // ===== СИМУЛЯЦИЯ ИНТЕНТА =====
  async simulateIntent(signedIntents: any[]): Promise<any> {
    const argsBase64 = Buffer.from(JSON.stringify({ signed: signedIntents })).toString('base64');
    
    const result = await this.rpcCall<any>('query', {
      request_type: 'call_function',
      finality: 'final',
      account_id: 'intents.near',
      method_name: 'simulate_intents',
      args_base64: argsBase64
    });
    
    if (result.result && result.result.length > 0) {
      const responseText = Buffer.from(result.result).toString();
      try {
        return JSON.parse(responseText);
      } catch {
        return { raw: responseText, logs: result.logs || [] };
      }
    }
    
    return { logs: result.logs || [] };
  }

  async createAndSignTransaction(
    receiverId: string,
    actions: Action[],
    nonce: number,
    blockHash: string
  ): Promise<string> {
    await this.ensureInit();
    
    if (!this.key) {
      throw new Error('Ключ не инициализирован');
    }
    
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

    const serializedTx = serializeTransaction(transaction);
    const hash = hash256(serializedTx);
    const signature = await this.key.sign(hash);
    
    const signedTransaction: SignedTransaction = {
      transaction: transaction,
      signature: {
        keyType: 0,
        data: signature
      }
    };
    
    const serializedSignedTx = serializeSignedTransaction(signedTransaction);
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