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

  private getRefundAddress(blockchain: string): string {
    switch (blockchain) {
      case 'near': return config.addresses.near;
      case 'eth': case 'arb': case 'base': case 'bsc': case 'avax': case 'pol': case 'op':
        return config.addresses.evm;
      case 'sol': return config.addresses.sol;
      default:
        console.warn(`⚠️ Неизвестный блокчейн ${blockchain}, используем NEAR адрес`);
        return config.addresses.near;
    }
  }

  private usdToAmount(usd: number, price: number, decimals: number): string {
    const amount = (usd / price) * Math.pow(10, decimals);
    return Math.floor(amount).toString();
  }

  async getWorkingTokens(): Promise<Token[]> {
    const allTokens = await this.getAllTokens();
    const stable = await this.getStableToken();

    const candidates = allTokens.filter(t =>
      !config.filters.excludeSymbols.includes(t.symbol) &&
      config.allowedBlockchains.includes(t.blockchain) &&
      parseFloat(t.price) > config.filters.minPrice &&
      parseFloat(t.price) < config.filters.maxPrice &&
      t.assetId !== stable.assetId
    );

    console.log(`🔍 Кандидатов для проверки ликвидности: ${candidates.length}`);
    if (candidates.length === 0) return [];

    const toCheck = candidates.slice(0, config.scan.maxWorkingTokens);
    const liquid: Token[] = [];

    for (const token of toCheck) {
      const testAmount = this.usdToAmount(
        config.trading.testAmountUSD,
        parseFloat(token.price),
        token.decimals
      );

      let depositType: 'INTENTS' | 'ORIGIN_CHAIN';
      let recipientType: 'INTENTS' | 'DESTINATION_CHAIN';
      let refundTo: string;
      let recipient: string;

      if (token.blockchain === 'near') {
        // Токен уже на NEAR — оба конца в системе Intents
        depositType = 'INTENTS';
        recipientType = 'INTENTS';
        refundTo = config.addresses.near;
        recipient = config.addresses.near;
      } else {
        // Кросс-чейн токен: отдаём из родной сети, получаем в Intents на NEAR
        depositType = 'ORIGIN_CHAIN';
        recipientType = 'INTENTS';
        refundTo = this.getRefundAddress(token.blockchain);
        recipient = config.addresses.near;
      }

      try {
        const quote = await nearIntentsClient.getQuote({
          originAsset: token.assetId,
          destinationAsset: stable.assetId,
          amount: testAmount,
          depositType,
          recipientType,
          recipient,
          refundTo,
          dry: true,
        });

        if (quote.quote?.amountOutUsd) {
          const outUsd = parseFloat(quote.quote.amountOutUsd);
          if (outUsd >= config.trading.testAmountUSD * 0.9) {
            liquid.push(token);
            console.log(`✅ ${token.symbol} (${token.blockchain}) — ликвиден, выход ~$${outUsd.toFixed(2)}`);
          } else {
            console.log(`❌ ${token.symbol} (${token.blockchain}) — низкий выход $${outUsd.toFixed(2)}`);
          }
        } else {
          console.log(`❌ ${token.symbol} (${token.blockchain}) — нет amountOutUsd`);
        }
      } catch (err: any) {
        const body = err.response?.data;
        console.log(`❌ ${token.symbol} (${token.blockchain}) — ошибка: ${body?.message || err.message}`);
      }
    }

    console.log(`✅ Отобрано ${liquid.length} ликвидных рабочих токенов`);
    return liquid;
  }
}

export const tokenManager = new TokenManager();