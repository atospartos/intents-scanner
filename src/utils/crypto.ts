// src/utils/crypto.ts
import { sha256 } from '@noble/hashes/sha2';
import * as ed from '@noble/ed25519';

export class Ed25519Key {
  private privateKey: Uint8Array;
  public publicKey: Uint8Array;

  constructor(privateKeyHex: string) {
    const hex = privateKeyHex.replace('ed25519:', '');
    this.privateKey = hexToUint8Array(hex);
    this.publicKey = ed.getPublicKey(this.privateKey);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return await ed.sign(message, this.privateKey);
  }

  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return await ed.verify(signature, message, this.publicKey);
  }

  getPublicKeyString(): string {
    return `ed25519:${uint8ArrayToHex(this.publicKey)}`;
  }
}

export function hash256(data: Uint8Array): Uint8Array {
  return sha256(data);
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

export function uint8ArrayToBase64(arr: Uint8Array): string {
  return Buffer.from(arr).toString('base64');
}

export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function uint8ArrayToString(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

// Опционально: убрать require, если хотите использовать import
// Но для bs58 это нормально, так как у него нет default экспорта
import bs58 from 'bs58';
export function base58ToUint8Array(base58: string): Uint8Array {
  return bs58.decode(base58);
}

export function uint8ArrayToBase58(arr: Uint8Array): string {
  return bs58.encode(arr);
}