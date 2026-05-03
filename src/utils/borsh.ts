// src/utils/borsh.ts
// Borsh сериализация для NEAR транзакций согласно документации

import { serialize } from 'borsh';

// Экспортируем enum для использования в других файлах
export enum ActionType {
  CreateAccount = 0,
  DeployContract = 1,
  FunctionCall = 2,
  Transfer = 3,
  Stake = 4,
  AddKey = 5,
  DeleteKey = 6,
  DeleteAccount = 7,
  Delegate = 8,
}

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
  type: ActionType;
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
export class BorshPublicKey {
  keyType: number = 0;
  data: Uint8Array = new Uint8Array(32);
}

export class BorshSignature {
  keyType: number = 0;
  data: Uint8Array = new Uint8Array(64);
}

export class BorshFunctionCallAction {
  methodName: string = '';
  args: Uint8Array = new Uint8Array(0);
  gas: bigint = 0n;
  deposit: bigint = 0n;
}

export class BorshAction {
  enum: string = '';
  functionCall?: BorshFunctionCallAction;
}

export class BorshTransaction {
  signerId: string = '';
  publicKey: BorshPublicKey = new BorshPublicKey();
  nonce: bigint = 0n;
  receiverId: string = '';
  blockHash: Uint8Array = new Uint8Array(32);
  actions: BorshAction[] = [];
}

export class BorshSignedTransaction {
  transaction: BorshTransaction = new BorshTransaction();
  signature: BorshSignature = new BorshSignature();
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

export function serializeTransaction(transaction: Transaction): Buffer {
  const borshTx = new BorshTransaction();
  borshTx.signerId = transaction.signerId;
  
  const pubKey = new BorshPublicKey();
  pubKey.keyType = transaction.publicKey.keyType;
  pubKey.data = transaction.publicKey.data;
  borshTx.publicKey = pubKey;
  
  borshTx.nonce = transaction.nonce;
  borshTx.receiverId = transaction.receiverId;
  borshTx.blockHash = transaction.blockHash;
  
  borshTx.actions = transaction.actions.map(action => {
    const borshAction = new BorshAction();
    borshAction.enum = ActionType[action.type].toLowerCase();
    
    if (action.functionCall) {
      const fc = new BorshFunctionCallAction();
      fc.methodName = action.functionCall.methodName;
      fc.args = action.functionCall.args;
      fc.gas = action.functionCall.gas;
      fc.deposit = action.functionCall.deposit;
      borshAction.functionCall = fc;
    }
    
    return borshAction;
  });
  
  return Buffer.from(serialize(schema, borshTx));
}

export function serializeSignedTransaction(signedTx: SignedTransaction): Buffer {
  const borshSigned = new BorshSignedTransaction();
  
  const borshTx = new BorshTransaction();
  borshTx.signerId = signedTx.transaction.signerId;
  
  const pubKey = new BorshPublicKey();
  pubKey.keyType = signedTx.transaction.publicKey.keyType;
  pubKey.data = signedTx.transaction.publicKey.data;
  borshTx.publicKey = pubKey;
  
  borshTx.nonce = signedTx.transaction.nonce;
  borshTx.receiverId = signedTx.transaction.receiverId;
  borshTx.blockHash = signedTx.transaction.blockHash;
  
  borshTx.actions = signedTx.transaction.actions.map(action => {
    const borshAction = new BorshAction();
    borshAction.enum = ActionType[action.type].toLowerCase();
    
    if (action.functionCall) {
      const fc = new BorshFunctionCallAction();
      fc.methodName = action.functionCall.methodName;
      fc.args = action.functionCall.args;
      fc.gas = action.functionCall.gas;
      fc.deposit = action.functionCall.deposit;
      borshAction.functionCall = fc;
    }
    
    return borshAction;
  });
  
  borshSigned.transaction = borshTx;
  
  const sig = new BorshSignature();
  sig.keyType = signedTx.signature.keyType;
  sig.data = signedTx.signature.data;
  borshSigned.signature = sig;
  
  return Buffer.from(serialize(schema, borshSigned));
}

// Хелперы
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

export function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString('base64');
}

export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}