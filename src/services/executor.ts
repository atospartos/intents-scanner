import { nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { PathResult } from './parallelScanner';

export class TradeExecutor {
  
  async executeTrade(result: PathResult, amountUSD: number = 10): Promise<{
    success: boolean;
    txId?: string;
    depositAddress?: string;
    error?: string;
  }> {
    if (config.dryRunOnly) {
      logger.info(`[DRY-RUN] Исполнение: ${result.path.join(' → ')}`);
      return { success: true };
    }
    
    try {
      const firstStep = result.stepsData[0];
      const fromSymbol = firstStep.from;
      const toSymbol = firstStep.to;
      
      // Находим токены
      const tokens = await nearIntentsClient.getTokens();
      const fromToken = tokens.find(t => t.symbol === fromSymbol);
      const toToken = tokens.find(t => t.symbol === toSymbol);
      
      if (!fromToken || !toToken) {
        throw new Error('Токен не найден');
      }
      
      const amountIn = this.usdToTokenAmount(amountUSD, parseFloat(fromToken.price), fromToken.decimals);
      
      // Реальный запрос (dry: false)
      const quote = await nearIntentsClient.getQuote(
        fromToken.assetId,
        toToken.assetId,
        amountIn,
        config.addresses.near,
        config.addresses.near,
        false  // dry: false - реальная сделка!
      );
      
      if (quote.quote?.depositAddress) {
        logger.trade(`💸 РЕАЛЬНАЯ СДЕЛКА: ${result.path.join(' → ')}`);
        logger.info(`   Депозитный адрес: ${quote.quote.depositAddress}`);
        logger.info(`   Отправьте ${amountUSD} ${fromSymbol} на этот адрес`);
        logger.info(`   Ожидаемый выход: ~${result.profitPercent.toFixed(2)}% прибыли`);
        
        return {
          success: true,
          depositAddress: quote.quote.depositAddress,
        };
      }
      
      return { success: false, error: 'Нет адреса депозита' };
      
    } catch (error: any) {
      logger.error(`Ошибка исполнения: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private usdToTokenAmount(usdAmount: number, tokenPrice: number, decimals: number): string {
    const tokenAmount = usdAmount / tokenPrice;
    const amountWithDecimals = tokenAmount * Math.pow(10, decimals);
    return Math.floor(amountWithDecimals).toLocaleString('fullwide', { useGrouping: false });
  }
}

export const tradeExecutor = new TradeExecutor();