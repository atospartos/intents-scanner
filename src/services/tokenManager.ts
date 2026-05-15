import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';

export class TokenManager {
  private allTokensCache: Token[] | null = null;
  private cacheTime = 0;
  private ttl = 3600000;

  async getAllTokens(): Promise<Token[]> {
    if (this.allTokensCache && Date.now() - this.cacheTime < this.ttl) {
      return this.allTokensCache;
    }
    const tokens = await nearIntentsClient.getTokens();
    this.allTokensCache = tokens;
    this.cacheTime = Date.now();
    return tokens;
  }

  async getStableToken(): Promise<Token> {
    const tokens = await this.getAllTokens();
    const stable = tokens.find(t => t.assetId === config.stableToken.assetId);
    if (!stable) throw new Error(`Стейблкоин ${config.stableToken.assetId} не найден`);
    return stable;
  }

  async getAllWorkingTokens(): Promise<Token[]> {
    const all = await this.getAllTokens();
    const stable = await this.getStableToken();
    const filtered = all.filter(t =>
      !config.filters.excludeSymbols.includes(t.symbol) &&
      config.allowedBlockchains.includes(t.blockchain) &&
      t.assetId !== stable.assetId
    );
    // Ограничиваем количество токенов для генерации пар
    const limited = filtered.slice(0, config.scan.maxWorkingTokens);
    console.log(`📋 Всего доступно рабочих токенов: ${filtered.length}, для сканирования взято: ${limited.length}`);
    return limited;
  }
}

export const tokenManager = new TokenManager();