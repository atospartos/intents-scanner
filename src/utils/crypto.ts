// src/utils/crypto.ts
import crypto from 'crypto';

export class Ed25519Key {
  private privateKey: Buffer;
  public publicKey: Buffer;

  constructor(privateKeyHex: string) {
    const hex = privateKeyHex.replace('ed25519:', '');
    this.privateKey = Buffer.from(hex, 'hex');
    this.publicKey = this.privateKey.slice(32);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const hmac = crypto.createHmac('sha256', this.privateKey);
    hmac.update(message);
    const signature = hmac.digest();
    const result = Buffer.concat([signature, Buffer.alloc(32)]);
    return result;
  }

  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const expectedSig = await this.sign(message);
    return crypto.timingSafeEqual(expectedSig, signature);
  }

  getPublicKeyString(): string {
    return `ed25519:${this.publicKey.toString('hex')}`;
  }
}

export function hash256(data: Uint8Array): Uint8Array {
  return crypto.createHash('sha256').update(data).digest();
}

export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.replace('ed25519:', '');
  return new Uint8Array(Buffer.from(cleanHex, 'hex'));
}

export function uint8ArrayToHex(arr: Uint8Array): string {
  return Buffer.from(arr).toString('hex');
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

export function base58ToUint8Array(base58: string): Uint8Array {
  const bs58 = require('bs58');
  return bs58.decode(base58);
}

export function uint8ArrayToBase58(arr: Uint8Array): string {
  const bs58 = require('bs58');
  return bs58.encode(arr);
}