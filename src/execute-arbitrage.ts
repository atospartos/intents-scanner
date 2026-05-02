import { nearIntentsClient, Token } from './clients/nearIntentsClient';
import { config } from './config';
import { fileStorage, ProfitableRoute, StoredTokenInfo } from './services/fileStorage';

class ArbitrageExecutor {
  private baseAmountUSD: number = 500;

  async executeBestRoutes(minProfitPercent: number = 0.03): Promise<void> {
    const profitableRoutes = fileStorage.loadProfitableRoutes();
    
    const validRoutes = profitableRoutes.filter(r => 
      r.profitPercent >= minProfitPercent && 
      r.profitPercent < 50 &&
      r.tokensInfo  // Должны быть метаданные
    );
    
    if (validRoutes.length === 0) {
      console.log('❌ Нет прибыльных маршрутов для исполнения');
      return;
    }
    
    validRoutes.sort((a, b) => b.profitPercent - a.profitPercent);
    const bestRoute = validRoutes[0];
    
    console.log(`\n🏆 ИСПОЛНЯЕМ МАРШРУТ:`);
    console.log(`   ${bestRoute.path.join(' → ')}`);
    console.log(`   Ожидаемая прибыль: ${bestRoute.profitPercent.toFixed(4)}%`);
    
    await this.executeRoute(bestRoute);
  }

  private async executeRoute(route: ProfitableRoute): Promise<void> {
    console.log(`\n🔄 НАЧАЛО ИСПОЛНЕНИЯ МАРШРУТА`);
    console.log(`   Путь: ${route.path.join(' → ')}`);
    console.log(`   Стартовая сумма: $${this.baseAmountUSD}`);
    
    try {
      // 🔥 ИСПОЛЬЗУЕМ СОХРАНЁННЫЕ МЕТАДАННЫЕ 🔥
      const tokenMap = new Map<string, StoredTokenInfo>();
      for (const info of route.tokensInfo!) {
        tokenMap.set(info.symbol, info);
      }
      
      let currentAmount = this.usdToTokenAmount(
        this.baseAmountUSD,
        parseFloat(route.tokensInfo![0].price || '1'),
        route.tokensInfo![0].decimals
      );
      
      console.log(`\n📊 ДЕТАЛИ МАРШРУТА ПО ШАГАМ:`);
      
      // Проходим по пути и исполняем каждый шаг
      for (let i = 0; i < route.path.length - 1; i++) {
        const fromSymbol = route.path[i];
        const toSymbol = route.path[i + 1];
        
        const fromInfo = tokenMap.get(fromSymbol);
        const toInfo = tokenMap.get(toSymbol);
        
        if (!fromInfo || !toInfo) {
          throw new Error(`Нет метаданных для ${fromSymbol} → ${toSymbol}`);
        }
        
        console.log(`\n   ${i + 1}. ${fromSymbol} (${fromInfo.blockchain}) → ${toSymbol} (${toInfo.blockchain})`);
        console.log(`      Отправляем: ${currentAmount} ${fromSymbol}`);
        console.log(`      Сеть отправителя: ${this.getNetworkName(fromInfo.blockchain)}`);
        console.log(`      Сеть получателя: ${this.getNetworkName(toInfo.blockchain)}`);
        
        // 🔥 ОПРЕДЕЛЯЕМ ТИП ДЕПОЗИТА ПО СЕТИ 🔥
        const isIntents = fromInfo.blockchain === 'near';
        
        const quote = await nearIntentsClient.getQuote(
          fromInfo.assetId,
          toInfo.assetId,
          currentAmount,
          config.addresses.near,
          config.addresses.near,
          false  // реальная сделка
        );
        
        if (!quote.quote?.amountOut) {
          throw new Error(`Нет котировки`);
        }
        
        console.log(`      Получаем: ${quote.quote.amountOutFormatted} ${toSymbol}`);
        
        if (quote.quote.depositAddress) {
          console.log(`      🏦 ДЕПОЗИТНЫЙ АДРЕС: ${quote.quote.depositAddress}`);
          console.log(`      📍 Формат адреса: ${this.getAddressFormat(fromInfo.blockchain)}`);
          
          if (!isIntents) {
            console.log(`      ⚠️ Отправьте ${currentAmount} ${fromSymbol} на указанный адрес в сети ${this.getNetworkName(fromInfo.blockchain)}`);
          } else {
            console.log(`      ✅ Своп внутри NEAR Intents, депозит на адрес ${quote.quote.depositAddress}`);
          }
        }
        
        currentAmount = quote.quote.amountOut;
      }
      
      console.log(`\n✅ МАРШРУТ ГОТОВ К ИСПОЛНЕНИЮ`);
      console.log(`   Ожидаемая прибыль: ${route.profitPercent.toFixed(4)}%`);
      
    } catch (error: any) {
      console.error(`❌ Ошибка: ${error.message}`);
    }
  }

  private getNetworkName(blockchain: string): string {
    const names: Record<string, string> = {
      'near': 'NEAR Protocol',
      'sol': 'Solana',
      'sui': 'Sui',
      'eth': 'Ethereum',
      'bsc': 'BNB Chain',
      'arb': 'Arbitrum',
      'base': 'Base',
      'avax': 'Avalanche',
      'pol': 'Polygon',
      'op': 'Optimism',
      'tron': 'TRON',
      'ton': 'TON',
      'btc': 'Bitcoin',
      'doge': 'Dogecoin',
    };
    return names[blockchain] || blockchain;
  }

  private getAddressFormat(blockchain: string): string {
    const formats: Record<string, string> = {
      'near': 'account.near (например: atospartos.near)',
      'sol': 'Base58 (32-44 символов, например: 7Ec2k... )',
      'sui': '0x... (64 символа)',
      'eth': '0x... (42 символа)',
      'bsc': '0x... (42 символа)',
      'arb': '0x... (42 символа)',
      'base': '0x... (42 символа)',
      'avax': '0x... (42 символа)',
      'pol': '0x... (42 символа)',
      'op': '0x... (42 символа)',
    };
    return formats[blockchain] || 'стандартный адрес блокчейна';
  }

  private usdToTokenAmount(usdAmount: number, tokenPrice: number, decimals: number): string {
    const tokenAmount = usdAmount / tokenPrice;
    const amountWithDecimals = tokenAmount * Math.pow(10, decimals);
    return Math.floor(amountWithDecimals).toString();
  }
}