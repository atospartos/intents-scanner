// src/utils/borsh.ts
// Borsh сериализация для NEAR транзакций

import { serialize, deserialize } from 'borsh';

// Типы для NEAR транзакций
export interface NearPublicKey {
  keyType: number;
  data: Uint8Array;
}

export interface NearSignature {
  keyType: number;
  data: Uint8Array;
}

export interface FunctionCallAction {
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}

export interface Action {
  enum: string;
  functionCall?: FunctionCallAction;
}

export interface Transaction {
  signerId: string;
  publicKey: NearPublicKey;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  actions: Action[];
}

export interface SignedTransaction {
  transaction: Transaction;
  signature: NearSignature;
}

// Классы для Borsh
class BorshPublicKey {
  keyType: number = 0;
  data: Uint8Array = new Uint8Array(32);

  constructor(properties?: { keyType?: number; data?: Uint8Array }) {
    if (properties) {
      this.keyType = properties.keyType ?? 0;
      this.data = properties.data ?? new Uint8Array(32);
    }
  }
}

class BorshSignature {
  keyType: number = 0;
  data: Uint8Array = new Uint8Array(64);

  constructor(properties?: { keyType?: number; data?: Uint8Array }) {
    if (properties) {
      this.keyType = properties.keyType ?? 0;
      this.data = properties.data ?? new Uint8Array(64);
    }
  }
}

class BorshFunctionCallAction {
  methodName: string = '';
  args: Uint8Array = new Uint8Array(0);
  gas: bigint = 0n;
  deposit: bigint = 0n;

  constructor(properties?: { methodName?: string; args?: Uint8Array; gas?: bigint; deposit?: bigint }) {
    if (properties) {
      this.methodName = properties.methodName ?? '';
      this.args = properties.args ?? new Uint8Array(0);
      this.gas = properties.gas ?? 0n;
      this.deposit = properties.deposit ?? 0n;
    }
  }
}

class BorshAction {
  enum: string = '';
  functionCall?: BorshFunctionCallAction;

  constructor(properties?: { enum?: string; functionCall?: BorshFunctionCallAction }) {
    if (properties) {
      this.enum = properties.enum ?? '';
      this.functionCall = properties.functionCall;
    }
  }
}

class BorshTransaction {
  signerId: string = '';
  publicKey: BorshPublicKey = new BorshPublicKey();
  nonce: bigint = 0n;
  receiverId: string = '';
  blockHash: Uint8Array = new Uint8Array(32);
  actions: BorshAction[] = [];

  constructor(properties?: {
    signerId?: string;
    publicKey?: BorshPublicKey;
    nonce?: bigint;
    receiverId?: string;
    blockHash?: Uint8Array;
    actions?: BorshAction[];
  }) {
    if (properties) {
      this.signerId = properties.signerId ?? '';
      this.publicKey = properties.publicKey ?? new BorshPublicKey();
      this.nonce = properties.nonce ?? 0n;
      this.receiverId = properties.receiverId ?? '';
      this.blockHash = properties.blockHash ?? new Uint8Array(32);
      this.actions = properties.actions ?? [];
    }
  }
}

class BorshSignedTransaction {
  transaction: BorshTransaction = new BorshTransaction();
  signature: BorshSignature = new BorshSignature();

  constructor(properties?: {
    transaction?: BorshTransaction;
    signature?: BorshSignature;
  }) {
    if (properties) {
      this.transaction = properties.transaction ?? new BorshTransaction();
      this.signature = properties.signature ?? new BorshSignature();
    }
  }
}

// Схема для Borsh
export const schema = {
  struct: {
    keyType: 'u8',
    data: { array: { type: 'u8', len: 32 } }
  },
  signature: {
    keyType: 'u8',
    data: { array: { type: 'u8', len: 64 } }
  },
  functionCallAction: {
    methodName: 'string',
    args: { array: { type: 'u8' } },
    gas: 'u64',
    deposit: 'u128'
  },
  action: {
    enum: 'string',
    functionCall: { option: 'functionCallAction' }
  },
  transaction: {
    signerId: 'string',
    publicKey: 'struct',
    nonce: 'u64',
    receiverId: 'string',
    blockHash: { array: { type: 'u8', len: 32 } },
    actions: { array: { type: 'action' } }
  },
  signedTransaction: {
    transaction: 'transaction',
    signature: 'signature'
  }
};

// Функции сериализации
export function serializeTransaction(transaction: Transaction): Buffer {
  const borshTx = new BorshTransaction({
    signerId: transaction.signerId,
    publicKey: new BorshPublicKey({
      keyType: transaction.publicKey.keyType,
      data: transaction.publicKey.data
    }),
    nonce: transaction.nonce,
    receiverId: transaction.receiverId,
    blockHash: transaction.blockHash,
    actions: transaction.actions.map(action => new BorshAction({
      enum: action.enum,
      functionCall: action.functionCall ? new BorshFunctionCallAction({
        methodName: action.functionCall.methodName,
        args: action.functionCall.args,
        gas: action.functionCall.gas,
        deposit: action.functionCall.deposit
      }) : undefined
    }))
  });
  
  return Buffer.from(serialize(schema, borshTx));
}

export function serializeSignedTransaction(signedTx: SignedTransaction): Buffer {
  const borshSigned = new BorshSignedTransaction({
    transaction: new BorshTransaction({
      signerId: signedTx.transaction.signerId,
      publicKey: new BorshPublicKey({
        keyType: signedTx.transaction.publicKey.keyType,
        data: signedTx.transaction.publicKey.data
      }),
      nonce: signedTx.transaction.nonce,
      receiverId: signedTx.transaction.receiverId,
      blockHash: signedTx.transaction.blockHash,
      actions: signedTx.transaction.actions.map(action => new BorshAction({
        enum: action.enum,
        functionCall: action.functionCall ? new BorshFunctionCallAction({
          methodName: action.functionCall.methodName,
          args: action.functionCall.args,
          gas: action.functionCall.gas,
          deposit: action.functionCall.deposit
        }) : undefined
      }))
    }),
    signature: new BorshSignature({
      keyType: signedTx.signature.keyType,
      data: signedTx.signature.data
    })
  });
  
  return Buffer.from(serialize(schema, borshSigned));
}

// Хелперы
export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function uint8ArrayToString(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.replace('ed25519:', '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString('base64');
}