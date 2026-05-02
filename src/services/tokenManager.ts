import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { fileStorage, StoredLiquidToken } from './fileStorage';

interface LiquidToken {
  token: Token;
  bestPair: string;
  bestPairValue: number;
}

export class TokenManager {
  private liquidTokensCache: LiquidToken[] | null = null;
  private liquidTokensLastUpdate: number = 0;
  private liquidTokensTTL: number = 3600000; // 1 час
  private processedCount = 0;
  private totalTokens = 0;

  async getStablecoins(): Promise<Token[]> {
    const allTokens = await this.getTokens();
    const stablecoins = allTokens.filter(t => 
      config.tokens.stablecoinSymbols.includes(t.symbol) && 
      t.blockchain === 'near' &&
      parseFloat(t.price) > 0
    );
    
    // Берём только USDC как основной стейблкоин
    const usdc = stablecoins.find(s => s.symbol === 'USDC');
    if (usdc) return [usdc];
    
    if (stablecoins.length === 0) {
      throw new Error('Не найден ни один стейблкоин на NEAR!');
    }
    
    return stablecoins.slice(0, 1);
  }

  async getTokens(forceRefresh: boolean = false): Promise<Token[]> {
    const tokens = await nearIntentsClient.getTokens();
    return tokens;
  }

  async getLiquidTokens(forceRescan: boolean = false): Promise<Token[]> {
    // Проверяем файловый кэш
    if (!forceRescan && fileStorage.isTokensValid(1)) {
      const stored = fileStorage.loadTokens();
      if (stored && stored.liquidTokens) {
        this.liquidTokensCache = stored.liquidTokens.map(t => ({
          token: {
            symbol: t.symbol,
            assetId: t.assetId,
            blockchain: t.blockchain,
            decimals: t.decimals,
            price: t.price,
          } as Token,
          bestPair: t.bestPair,
          bestPairValue: t.bestPairValue,
        }));
        console.log(`📦 Используем файловый кэш: ${this.liquidTokensCache.length} токенов`);
        return this.liquidTokensCache.map(l => l.token);
      }
    }
    
    // Проверяем кэш в памяти
    if (!forceRescan && this.liquidTokensCache && (Date.now() - this.liquidTokensLastUpdate) < this.liquidTokensTTL) {
      logger.info(`📦 Используем кэш памяти (${this.liquidTokensCache.length} токенов)`);
      return this.liquidTokensCache.map(l => l.token);
    }
    
    // Параллельное сканирование
    const liquidTokens = await this.scanLiquidTokensParallel();
    return liquidTokens.map(l => l.token);
  }

  // 🔥 ПАРАЛЛЕЛЬНОЕ СКАНИРОВАНИЕ ЛИКВИДНОСТИ 🔥
  private async scanLiquidTokensParallel(): Promise<LiquidToken[]> {
    console.log('\n🔍 ПАРАЛЛЕЛЬНОЕ СКАНИРОВАНИЕ ЛИКВИДНОСТИ...');
    
    const allTokens = await this.getTokens();
    const stablecoins = await this.getStablecoins();
    const usdc = stablecoins[0];
    
    if (!usdc) {
      throw new Error('USDC не найден');
    }
    
    const candidates = allTokens.filter(t => 
      !config.tokens.stablecoinSymbols.includes(t.symbol) &&
      config.tokens.allowedBlockchains.includes(t.blockchain) &&
      parseFloat(t.price) > 0 &&
      parseFloat(t.price) < 1000000
    );
    
    this.totalTokens = candidates.length;
    this.processedCount = 0;
    
    console.log(`📊 Проверяем ${this.totalTokens} токенов (параллельно, 10 запросов одновременно)`);
    console.log(`   Интервал между отправками: 200 мс\n`);
    
    const results: LiquidToken[] = [];
    const requestQueue = [...candidates];
    let activeRequests = 0;
    let sentCount = 0;
    
    return new Promise((resolve) => {
      const sendInterval = setInterval(() => {
        if (requestQueue.length > 0 && activeRequests < 10) {
          const token = requestQueue.shift();
          if (token) {
            sentCount++;
            activeRequests++;
            
            // Запускаем проверку асинхронно
            this.checkTokenLiquidityParallel(token, usdc).then((liquidToken) => {
              if (liquidToken) {
                results.push(liquidToken);
                console.log(`✅ [${sentCount}/${this.totalTokens}] ${token.symbol.padEnd(12)} → ЛИКВИДЕН (${liquidToken.bestPairValue.toFixed(2)}$)`);
              } else {
                console.log(`❌ [${sentCount}/${this.totalTokens}] ${token.symbol.padEnd(12)} → НЕ ЛИКВИДЕН`);
              }
              activeRequests--;
              this.processedCount++;
              
              // Показываем прогресс каждые 10%
              if (this.processedCount % Math.max(1, Math.floor(this.totalTokens / 10)) === 0) {
                const progress = ((this.processedCount / this.totalTokens) * 100).toFixed(1);
                console.log(`   📊 Прогресс: ${this.processedCount}/${this.totalTokens} (${progress}%) | Найдено: ${results.length}`);
              }
              
              // Завершаем, когда все обработаны
              if (this.processedCount === this.totalTokens) {
                clearInterval(sendInterval);
                
                results.sort((a, b) => b.bestPairValue - a.bestPairValue);
                this.liquidTokensCache = results;
                this.liquidTokensLastUpdate = Date.now();
                
                // Сохраняем в файл
                const stablecoinsList = [usdc];
                fileStorage.saveTokens(stablecoinsList, results.map(r => ({
                  symbol: r.token.symbol,
                  assetId: r.token.assetId,
                  blockchain: r.token.blockchain,
                  decimals: r.token.decimals,
                  price: r.token.price,
                  bestPair: r.bestPair,
                  bestPairValue: r.bestPairValue,
                  lastVerified: Date.now(),
                })));
                
                console.log(`\n✅ НАЙДЕНО: ${results.length} ликвидных токенов из ${this.totalTokens}`);
                console.log(`   ${results.map(r => r.token.symbol).slice(0, 20).join(', ')}${results.length > 20 ? '...' : ''}`);
                
                resolve(results);
              }
            }).catch(() => {
              activeRequests--;
              this.processedCount++;
              if (this.processedCount === this.totalTokens) {
                clearInterval(sendInterval);
                resolve(results);
              }
            });
          }
        }
        
        // Завершаем, если очередь пуста и нет активных запросов
        if (requestQueue.length === 0 && activeRequests === 0 && this.processedCount === this.totalTokens) {
          clearInterval(sendInterval);
        }
      }, 200); // 200 мс между отправками
    });
  }

  private async checkTokenLiquidityParallel(token: Token, usdc: Token): Promise<LiquidToken | null> {
    const testAmountUSD = config.trading.testAmountUSD;
    const testAmount = Math.floor((testAmountUSD / parseFloat(token.price)) * Math.pow(10, token.decimals));
    
    try {
      const quote = await nearIntentsClient.getQuote(
        token.assetId,
        usdc.assetId,
        testAmount.toString(),
        config.addresses.near,
        config.addresses.near,
        true
      );
      
      if (quote.quote?.amountOut) {
        const amountOut = parseFloat(quote.quote.amountOut) / Math.pow(10, usdc.decimals);
        const valueUsd = amountOut * parseFloat(usdc.price);
        
        if (valueUsd >= testAmountUSD * 0.9) {
          return { token, bestPair: usdc.symbol, bestPairValue: valueUsd };
        }
      }
    } catch (error) {
      // Пропускаем
    }
    
    return null;
  }

  async getAllTradingTokens(): Promise<{ stablecoins: Token[]; workingTokens: Token[] }> {
    const [stablecoins, workingTokens] = await Promise.all([
      this.getStablecoins(),
      this.getLiquidTokens()
    ]);
    
    const topTokens = workingTokens.slice(0, config.scan.maxWorkingTokens);
    
    console.log(`\n🎯 Для арбитража: ${stablecoins.length} стейбл + ${topTokens.length} рабочих`);
    console.log(`   Рабочие: ${topTokens.map(t => t.symbol).join(', ')}`);
    
    return { stablecoins, workingTokens: topTokens };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const tokenManager = new TokenManager();