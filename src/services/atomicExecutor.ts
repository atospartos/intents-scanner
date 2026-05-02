import { nearIntentsClient, Token } from '../clients/nearIntentsClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { fileStorage, ProfitableRoute } from './fileStorage';
import fs from 'fs';
import path from 'path';

export interface TradeResult {
  routeId: string;
  path: string[];
  amountUSD: number;
  profitPercent: number;
  profitAmount: number;
  status: 'success' | 'failed' | 'partial';
  error?: string;
  timestamp: number;
  stepsCompleted: number;
  totalSteps: number;
  txHash?: string;
}

export interface RouteStats {
  routeId: string;
  path: string[];
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  avgProfitPercent: number;
  totalProfitUSD: number;
  lastExecuted: number;
  lastSuccess: number;
  lastError?: string;
  bestProfit: number;
  worstProfit: number;
}

export class AtomicExecutor {
  private baseAmountUSD: number = 100;
  private statsFile: string = path.join(process.cwd(), 'storage', 'trade-stats.json');
  private routeStats: Map<string, RouteStats> = new Map();
  private maxRetries: number = 3;
  private retryDelay: number = 5000;

  constructor() {
    this.loadStats();
  }

  // Загрузка статистики
  private loadStats(): void {
    try {
      if (fs.existsSync(this.statsFile)) {
        const data = JSON.parse(fs.readFileSync(this.statsFile, 'utf-8'));
        for (const stat of data) {
          this.routeStats.set(stat.routeId, stat);
        }
        console.log(`📊 Загружена статистика по ${this.routeStats.size} маршрутам`);
      }
    } catch (error: any) {
      console.log(`   Нет сохранённой статистики`);
    }
  }

  // Сохранение статистики
  private saveStats(): void {
    try {
      const stats = Array.from(this.routeStats.values());
      fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
    } catch (error: any) {
      console.error(`❌ Ошибка сохранения статистики: ${error.message}`);
    }
  }

  // Обновление статистики маршрута
  private updateRouteStats(result: TradeResult): void {
    const existing = this.routeStats.get(result.routeId);
    
    if (existing) {
      existing.totalAttempts++;
      if (result.status === 'success') {
        existing.successfulAttempts++;
        existing.totalProfitUSD += result.profitAmount;
        existing.avgProfitPercent = existing.totalProfitUSD / existing.successfulAttempts;
        existing.lastSuccess = result.timestamp;
        existing.bestProfit = Math.max(existing.bestProfit, result.profitPercent);
        existing.worstProfit = Math.min(existing.worstProfit, result.profitPercent);
      } else {
        existing.failedAttempts++;
        existing.lastError = result.error;
      }
      existing.lastExecuted = result.timestamp;
      
      this.routeStats.set(result.routeId, existing);
    } else {
      this.routeStats.set(result.routeId, {
        routeId: result.routeId,
        path: result.path,
        totalAttempts: 1,
        successfulAttempts: result.status === 'success' ? 1 : 0,
        failedAttempts: result.status === 'success' ? 0 : 1,
        avgProfitPercent: result.status === 'success' ? result.profitPercent : 0,
        totalProfitUSD: result.status === 'success' ? result.profitAmount : 0,
        lastExecuted: result.timestamp,
        lastSuccess: result.status === 'success' ? result.timestamp : 0,
        lastError: result.status === 'success' ? undefined : result.error,
        bestProfit: result.status === 'success' ? result.profitPercent : 0,
        worstProfit: result.status === 'success' ? result.profitPercent : 0,
      });
    }
    
    this.saveStats();
  }

  // Фильтрация маршрутов для исполнения
  private filterRoutes(routes: ProfitableRoute[]): ProfitableRoute[] {
    const filtered: ProfitableRoute[] = [];
    
    for (const route of routes) {
      // 1. Проверка минимальной прибыли
      if (route.avgProfit < config.scan.minProfitPercent) {
        logger.debug(`❌ Исключён ${route.path.join(' → ')}: прибыль ${route.avgProfit.toFixed(4)}% ниже порога`);
        continue;
      }
      
      // 2. Проверка наличия информации о токенах
      if (!route.tokensInfo || route.tokensInfo.length === 0) {
        logger.debug(`❌ Исключён ${route.path.join(' → ')}: нет информации о токенах`);
        continue;
      }
      
      // 3. Проверка истории успешности
      const stats = this.routeStats.get(route.id);
      if (stats) {
        // Если больше 3 неудач подряд — временно исключаем
        if (stats.failedAttempts >= 3 && stats.successfulAttempts === 0) {
          logger.debug(`❌ Исключён ${route.path.join(' → ')}: ${stats.failedAttempts} неудач подряд`);
          continue;
        }
        
        // Если успешность меньше 30% — исключаем
        const successRate = stats.successfulAttempts / stats.totalAttempts;
        if (stats.totalAttempts >= 5 && successRate < 0.3) {
          logger.debug(`❌ Исключён ${route.path.join(' → ')}: успешность ${(successRate * 100).toFixed(1)}%`);
          continue;
        }
      }
      
      filtered.push(route);
    }
    
    console.log(`   ✅ Отфильтровано: ${filtered.length} из ${routes.length} маршрутов`);
    return filtered;
  }

  // Проверка актуальной прибыли перед исполнением
  private async checkCurrentProfit(
    route: ProfitableRoute,
    tokens: Token[],
    amountUSD: number
  ): Promise<{
    viable: boolean;
    currentProfitPercent: number;
    currentProfitAmount: number;
    stepsDetails: any[];
  }> {
    console.log(`\n🔍 ПРОВЕРКА АКТУАЛЬНОЙ ПРИБЫЛИ...`);
    
    let currentAmount = this.usdToTokenAmount(
      amountUSD,
      parseFloat(tokens[0].price),
      tokens[0].decimals
    );
    
    const stepsDetails = [];
    let allStepsValid = true;
    
    for (let i = 0; i < tokens.length - 1; i++) {
      const fromToken = tokens[i];
      const toToken = tokens[i + 1];
      
      try {
        const quote = await nearIntentsClient.getQuote(
          fromToken.assetId,
          toToken.assetId,
          currentAmount,
          config.addresses.near,
          config.addresses.near,
          true  // dry-run
        );
        
        if (!quote.quote?.amountOut) {
          console.log(`   ❌ Шаг ${i + 1}: ${fromToken.symbol} → ${toToken.symbol} - НЕТ ЛИКВИДНОСТИ`);
          allStepsValid = false;
          break;
        }
        
        stepsDetails.push({
          step: i + 1,
          from: fromToken.symbol,
          to: toToken.symbol,
          amountIn: currentAmount,
          amountOut: quote.quote.amountOut,
          amountOutFormatted: quote.quote.amountOutFormatted,
          amountOutUsd: quote.quote.amountOutUsd,
        });
        
        console.log(`   ✅ Шаг ${i + 1}: ${fromToken.symbol} → ${toToken.symbol} → $${quote.quote.amountOutUsd}`);
        currentAmount = quote.quote.amountOut;
        
      } catch (error: any) {
        console.log(`   ❌ Шаг ${i + 1}: ${fromToken.symbol} → ${toToken.symbol} - ОШИБКА: ${error.message}`);
        allStepsValid = false;
        break;
      }
    }
    
    if (!allStepsValid || stepsDetails.length === 0) {
      return {
        viable: false,
        currentProfitPercent: 0,
        currentProfitAmount: 0,
        stepsDetails: [],
      };
    }
    
    const lastStep = stepsDetails[stepsDetails.length - 1];
    const finalAmountUSD = parseFloat(lastStep.amountOutUsd);
    const profitAmount = finalAmountUSD - amountUSD;
    const profitPercent = (profitAmount / amountUSD) * 100;
    
    console.log(`\n   📊 ИСТОРИЧЕСКАЯ ПРИБЫЛЬ: ${route.avgProfit.toFixed(4)}%`);
    console.log(`   📊 АКТУАЛЬНАЯ ПРИБЫЛЬ: ${profitPercent.toFixed(4)}% ($${profitAmount.toFixed(4)})`);
    
    const minProfitThreshold = config.scan.minProfitPercent;
    const isViable = profitPercent >= minProfitThreshold;
    
    if (!isViable) {
      console.log(`\n   ⚠️ ПРИБЫЛЬ УМЕНЬШИЛАСЬ! Пропускаем сделку.`);
      console.log(`      Требуется: ≥${minProfitThreshold}%, Сейчас: ${profitPercent.toFixed(4)}%`);
    } else if (profitPercent < route.avgProfit * 0.7) {
      console.log(`\n   ⚠️ ПРИБЫЛЬ СНИЗИЛАСЬ НА ${((route.avgProfit - profitPercent) / route.avgProfit * 100).toFixed(1)}%`);
      console.log(`      Рекомендуется пропустить сделку или уменьшить сумму.`);
    } else {
      console.log(`\n   ✅ ПРИБЫЛЬ СОХРАНЕНА! Исполняем сделку.`);
    }
    
    return {
      viable: isViable,
      currentProfitPercent: profitPercent,
      currentProfitAmount: profitAmount,
      stepsDetails,
    };
  }

  // Исполнение с проверкой текущей прибыли и повторными попытками
  private async executeWithRetryAndCheck(
    route: ProfitableRoute,
    tokens: Token[],
    amountUSD: number
  ): Promise<TradeResult> {
    let lastError: string = '';
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      console.log(`\n🔄 ПОПЫТКА ${attempt}/${this.maxRetries}`);
      console.log('='.repeat(50));
      
      // 1. СНАЧАЛА ПРОВЕРЯЕМ АКТУАЛЬНУЮ ПРИБЫЛЬ
      const currentCheck = await this.checkCurrentProfit(route, tokens, amountUSD);
      
      if (!currentCheck.viable) {
        lastError = `Прибыль снизилась: ${currentCheck.currentProfitPercent.toFixed(4)}% (требуется ≥${config.scan.minProfitPercent}%)`;
        console.log(`\n   ❌ ${lastError}`);
        
        if (attempt < this.maxRetries) {
          console.log(`   ⏳ Повторная проверка через ${this.retryDelay / 1000} сек...`);
          await this.delay(this.retryDelay);
          continue;
        }
        break;
      }
      
      // 2. ЕСЛИ ПРИБЫЛЬ СОХРАНИЛАСЬ — ИСПОЛНЯЕМ
      console.log(`\n✅ ПРИБЫЛЬ ПОДТВЕРЖДЕНА: ${currentCheck.currentProfitPercent.toFixed(4)}%`);
      console.log(`🚀 НАЧАЛО ИСПОЛНЕНИЯ...\n`);
      
      if (config.dryRunOnly) {
        return {
          routeId: route.id,
          path: route.path,
          amountUSD,
          profitPercent: currentCheck.currentProfitPercent,
          profitAmount: currentCheck.currentProfitAmount,
          status: 'success',
          timestamp: Date.now(),
          stepsCompleted: tokens.length - 1,
          totalSteps: tokens.length - 1,
        };
      }
      
      // РЕАЛЬНОЕ ИСПОЛНЕНИЕ
      try {
        let currentAmount = this.usdToTokenAmount(
          amountUSD,
          parseFloat(tokens[0].price),
          tokens[0].decimals
        );
        
        const executedSteps = [];
        
        for (let i = 0; i < tokens.length - 1; i++) {
          const fromToken = tokens[i];
          const toToken = tokens[i + 1];
          
          console.log(`   📍 ШАГ ${i + 1}: ${fromToken.symbol} → ${toToken.symbol}`);
          console.log(`      Отправляем: ${currentAmount} ${fromToken.symbol}`);
          
          const quote = await nearIntentsClient.getQuote(
            fromToken.assetId,
            toToken.assetId,
            currentAmount,
            config.addresses.near,
            config.addresses.near,
            false  // real execution
          );
          
          if (!quote.quote?.amountOut) {
            throw new Error(`Нет выхода на шаге ${i + 1}`);
          }
          
          console.log(`      ✅ Получаем: ${quote.quote.amountOutFormatted} ${toToken.symbol}`);
          if (quote.quote.depositAddress) {
            console.log(`      🏦 Депозитный адрес: ${quote.quote.depositAddress}`);
          }
          
          executedSteps.push(quote);
          currentAmount = quote.quote.amountOut;
        }
        
        const finalAmountUSD = parseFloat(currentCheck.stepsDetails[currentCheck.stepsDetails.length - 1].amountOutUsd);
        const profitAmount = finalAmountUSD - amountUSD;
        
        console.log(`\n   ✅ СДЕЛКА УСПЕШНО ИСПОЛНЕНА!`);
        
        return {
          routeId: route.id,
          path: route.path,
          amountUSD,
          profitPercent: (profitAmount / amountUSD) * 100,
          profitAmount,
          status: 'success',
          timestamp: Date.now(),
          stepsCompleted: tokens.length - 1,
          totalSteps: tokens.length - 1,
        };
        
      } catch (error: any) {
        lastError = error.message;
        console.log(`   ❌ Ошибка исполнения: ${lastError}`);
        
        if (attempt < this.maxRetries) {
          console.log(`   ⏳ Повторная попытка через ${this.retryDelay / 1000} сек...`);
          await this.delay(this.retryDelay);
        }
      }
    }
    
    return {
      routeId: route.id,
      path: route.path,
      amountUSD,
      profitPercent: 0,
      profitAmount: 0,
      status: 'failed',
      error: lastError,
      timestamp: Date.now(),
      stepsCompleted: 0,
      totalSteps: tokens.length - 1,
    };
  }

  // Основной метод исполнения
  async executeBestRoute(amountUSD: number = this.baseAmountUSD): Promise<TradeResult | null> {
    console.log('\n' + '='.repeat(70));
    console.log('🤖 АРБИТРАЖНЫЙ БОТ — АВТОМАТИЧЕСКОЕ ИСПОЛНЕНИЕ');
    console.log('='.repeat(70));
    console.log(`💰 Капитал: $${amountUSD}`);
    console.log(`🎯 Мин. прибыль: ${config.scan.minProfitPercent}%`);
    console.log(`🔄 Макс. попыток: ${this.maxRetries}`);
    console.log(`🔍 Проверка актуальной прибыли: ДА\n`);
    
    const allRoutes = fileStorage.loadProfitableRoutes();
    
    if (allRoutes.length === 0) {
      console.log('❌ Нет прибыльных маршрутов');
      console.log('   Запустите сканирование: npm run dev\n');
      return null;
    }
    
    const filteredRoutes = this.filterRoutes(allRoutes);
    
    if (filteredRoutes.length === 0) {
      console.log('❌ Нет маршрутов, прошедших фильтрацию');
      this.showStats();
      return null;
    }
    
    // Сортируем по успешности и прибыли
    filteredRoutes.sort((a, b) => {
      const statsA = this.routeStats.get(a.id);
      const statsB = this.routeStats.get(b.id);
      const successRateA = statsA ? statsA.successfulAttempts / statsA.totalAttempts : 1;
      const successRateB = statsB ? statsB.successfulAttempts / statsB.totalAttempts : 1;
      if (successRateA !== successRateB) return successRateB - successRateA;
      return b.avgProfit - a.avgProfit;
    });
    
    const bestRoute = filteredRoutes[0];
    
    console.log(`🏆 ВЫБРАН МАРШРУТ: ${bestRoute.path.join(' → ')}`);
    console.log(`   Историческая прибыль: ${bestRoute.avgProfit.toFixed(4)}%`);
    console.log(`   Найден: ${bestRoute.timesSeen} раз(а)`);
    console.log(`   Успешных исполнений: ${this.routeStats.get(bestRoute.id)?.successfulAttempts || 0}`);
    console.log(`   Неудачных: ${this.routeStats.get(bestRoute.id)?.failedAttempts || 0}\n`);
    
    // Получаем токены
    const allTokens = await nearIntentsClient.getTokens();
    const tokens: Token[] = [];
    
    for (const sym of bestRoute.path) {
      const info = bestRoute.tokensInfo!.find(t => t.symbol === sym);
      if (info) {
        const token = allTokens.find(t => t.assetId === info.assetId);
        if (token) tokens.push(token);
      } else {
        console.log(`❌ Нет информации о токене ${sym}`);
        return null;
      }
    }
    
    if (tokens.length !== bestRoute.path.length) {
      console.log('❌ Не удалось получить все токены');
      return null;
    }
    
    // Исполняем с проверкой текущей прибыли
    const result = await this.executeWithRetryAndCheck(bestRoute, tokens, amountUSD);
    
    // Обновляем статистику
    this.updateRouteStats(result);
    
    // Показываем результат
    console.log('\n' + '='.repeat(70));
    if (result.status === 'success') {
      console.log('✅ СДЕЛКА УСПЕШНО ВЫПОЛНЕНА!');
      console.log(`   Прибыль: $${result.profitAmount.toFixed(4)} (${result.profitPercent.toFixed(4)}%)`);
      if (!config.dryRunOnly) {
        console.log(`   Проверьте баланс через 1-2 минуты`);
      }
    } else {
      console.log('❌ СДЕЛКА НЕ УДАЛАСЬ');
      console.log(`   Ошибка: ${result.error}`);
      console.log(`   Совет: Попробуйте другой маршрут или подождите`);
    }
    console.log('='.repeat(70) + '\n');
    
    this.showStats();
    
    return result;
  }
  
  // Показ статистики
  showStats(): void {
    const stats = Array.from(this.routeStats.values());
    if (stats.length === 0) return;
    
    const totalTrades = stats.reduce((s, r) => s + r.totalAttempts, 0);
    const successfulTrades = stats.reduce((s, r) => s + r.successfulAttempts, 0);
    const totalProfit = stats.reduce((s, r) => s + r.totalProfitUSD, 0);
    const successRate = totalTrades > 0 ? (successfulTrades / totalTrades * 100) : 0;
    
    console.log('\n📊 СТАТИСТИКА ТОРГОВЛИ:');
    console.log('='.repeat(70));
    console.log(`   Всего сделок: ${totalTrades}`);
    console.log(`   Успешных: ${successfulTrades}`);
    console.log(`   Неудачных: ${totalTrades - successfulTrades}`);
    console.log(`   Успешность: ${successRate.toFixed(1)}%`);
    console.log(`   Общая прибыль: $${totalProfit.toFixed(4)}`);
    
    // Лучший маршрут
    if (successfulTrades > 0) {
      const best = stats.reduce((a, b) => a.bestProfit > b.bestProfit ? a : b);
      console.log(`\n   🏆 Лучший маршрут: ${best.path.join(' → ')}`);
      console.log(`      Макс. прибыль: ${best.bestProfit.toFixed(4)}%`);
      console.log(`      Успешность: ${(best.successfulAttempts / best.totalAttempts * 100).toFixed(1)}%`);
    }
    
    console.log('='.repeat(70) + '\n');
  }
  
  private usdToTokenAmount(usdAmount: number, tokenPrice: number, decimals: number): string {
    const tokenAmount = usdAmount / tokenPrice;
    const amountWithDecimals = tokenAmount * Math.pow(10, decimals);
    return Math.floor(amountWithDecimals).toString();
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const atomicExecutor = new AtomicExecutor();