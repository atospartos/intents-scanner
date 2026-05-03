// src/services/parallelScanner.ts
import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { fileStorage, ProfitableRoute } from './fileStorage';

interface StepResult {
  pathId: string;
  stepIndex: number;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  success: boolean;
  error?: string;
}

interface PathState {
  pathId: string;
  pathStr: string[];
  steps: Array<{ from: Token; to: Token }>;
  startStable: Token;
  testAmountUSD: number;
  results: Map<number, StepResult>;
  stepCount: number;
  startTime: number;
  completed: boolean;
}

export interface PathResult {
  requestId: string;
  path: string[];
  profitPercent: number;
  profitAmount: number;
  endAmount: number;
  success: boolean;
  error?: string;
}

export class ParallelScanner {
  private pathStates: Map<string, PathState> = new Map();
  private results: PathResult[] = [];
  private profitableFound: ProfitableRoute[] = [];
  private requestDelay = 200;
  private totalPaths = 0;
  private completedPaths = 0;
  private activeTimeouts: Set<NodeJS.Timeout> = new Set();
  private silentMode = false;
  private totalPathsFixed = 0;

  async scanPaths(
    paths: Array<{
      tokens: Token[];
      startStable: Token;
      endStable: Token;
      workingTokens: Token[];
    }>,
    testAmountUSD: number = 100
  ): Promise<PathResult[]> {
    this.results = [];
    this.profitableFound = [];
    this.pathStates.clear();
    this.completedPaths = 0;
    this.activeTimeouts.clear();
    this.totalPaths = paths.length;
    this.totalPathsFixed = paths.length;
    
    if (!this.silentMode) {
      console.log(`\n🚀 ЗАПУСК АСИНХРОННОГО СКАНИРОВАНИЯ`);
      console.log(`   Всего путей: ${this.totalPaths}`);
      console.log(`   Интервал между отправками: ${this.requestDelay}мс\n`);
    }
    
    const allStartTime = Date.now();
    
    // Отправляем первые запросы для всех путей
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const pathId = this.generatePathId(path);
      const steps = this.buildSteps(path.tokens);
      
      const startAmount = this.usdToTokenAmount(
        testAmountUSD,
        parseFloat(path.startStable.price),
        path.startStable.decimals
      );
      
      const pathState: PathState = {
        pathId,
        pathStr: path.tokens.map(t => t.symbol),
        steps,
        startStable: path.startStable,
        testAmountUSD,
        results: new Map(),
        stepCount: steps.length,
        startTime: Date.now(),
        completed: false,
      };
      this.pathStates.set(pathId, pathState);
      
      const firstStep = steps[0];
      this.sendRequest(pathId, 0, firstStep, startAmount);
      
      if (i < paths.length - 1) {
        await this.delay(this.requestDelay);
      }
    }
    
    // Добавляем таймер для проверки зависших путей (каждые 10 секунд)
    const checkInterval = setInterval(() => {
      const now = Date.now();
      for (const [pathId, state] of this.pathStates) {
        if (!state.completed && (now - state.startTime) > 120000) { // 2 минуты таймаут
          console.log(`   ⚠️ Таймаут пути: ${state.pathStr.join(' → ')}`);
          // Заполняем недостающие шаги ошибкой
          for (let i = 0; i < state.stepCount; i++) {
            if (!state.results.has(i)) {
              state.results.set(i, {
                pathId,
                stepIndex: i,
                amountOut: '',
                amountOutFormatted: '',
                amountOutUsd: '',
                success: false,
                error: 'timeout',
              });
            }
          }
          this.completePath(state);
          this.completedPaths++;
        }
      }
    }, 10000);
    
    // Ждём завершения всех путей (без вывода прогресса)
    let lastPrinted = 0;
    while (this.completedPaths < this.totalPaths) {
      await this.delay(1000);
      
      // Выводим прогресс только раз в 10 секунд и только если есть изменения
      if (!this.silentMode && this.completedPaths !== lastPrinted) {
        lastPrinted = this.completedPaths;
        // Не выводим прогресс в консоль, просто обновляем переменную
      }
    }
    
    clearInterval(checkInterval);
    
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();
    
    const elapsed = (Date.now() - allStartTime) / 1000;
    
    // Выводим только итоговую статистику
    if (!this.silentMode) {
      console.log(`\n✅ Сканирование завершено за ${elapsed.toFixed(1)} секунд`);
      console.log(`   Обработано путей: ${this.completedPaths}/${this.totalPaths}`);
      console.log(`   Найдено прибыльных путей: ${this.profitableFound.length}`);
    }
    
    return this.results;
  }

  private async sendRequest(
    pathId: string, 
    stepIndex: number, 
    step: { from: Token; to: Token }, 
    amountIn: string
  ): Promise<void> {
    const timeoutId = setTimeout(() => {
      const result: StepResult = {
        pathId,
        stepIndex,
        amountOut: '',
        amountOutFormatted: '',
        amountOutUsd: '',
        success: false,
        error: 'timeout',
      };
      this.handleStepResult(result);
    }, 30000);
    this.activeTimeouts.add(timeoutId);
    
    try {
      const quote = await nearIntentsClient.getQuote(
        step.from.assetId,
        step.to.assetId,
        amountIn,
        config.addresses.near,
        config.addresses.near,
        true
      );
      
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);
      
      if (!quote.quote?.amountOut) {
        throw new Error(`Нет ликвидности: ${step.from.symbol} → ${step.to.symbol}`);
      }
      
      const result: StepResult = {
        pathId,
        stepIndex,
        amountOut: quote.quote.amountOut,
        amountOutFormatted: quote.quote.amountOutFormatted,
        amountOutUsd: quote.quote.amountOutUsd,
        success: true,
      };
      this.handleStepResult(result);
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);
      
      const result: StepResult = {
        pathId,
        stepIndex,
        amountOut: '',
        amountOutFormatted: '',
        amountOutUsd: '',
        success: false,
        error: error.message,
      };
      this.handleStepResult(result);
    }
  }

private handleStepResult(result: StepResult): void {
  const pathState = this.pathStates.get(result.pathId);
  if (!pathState || pathState.completed) return;
  
  if (pathState.results.has(result.stepIndex)) return;
  
  pathState.results.set(result.stepIndex, result);
  
  // Отправляем следующий шаг только если текущий успешен
  if (result.success && result.stepIndex + 1 < pathState.stepCount) {
    const nextStep = pathState.steps[result.stepIndex + 1];
    this.sendRequest(result.pathId, result.stepIndex + 1, nextStep, result.amountOut);
  }
  
  // Проверяем, нужно ли завершить путь
  const isLastStep = result.stepIndex === pathState.stepCount - 1;
  const hasError = !result.success;
  
  if (isLastStep || hasError) {
    // Заполняем все недостающие шаги ошибкой
    for (let i = 0; i < pathState.stepCount; i++) {
      if (!pathState.results.has(i)) {
        pathState.results.set(i, {
          pathId: result.pathId,
          stepIndex: i,
          amountOut: '',
          amountOutFormatted: '',
          amountOutUsd: '',
          success: false,
          error: 'path terminated',
        });
      }
    }
    this.completePath(pathState);
    this.completedPaths++;
  }
}

  private generatePathId(path: { tokens: Token[] }): string {
    return path.tokens.map(t => t.symbol).join('_');
  }

  private buildSteps(tokens: Token[]): Array<{ from: Token; to: Token }> {
    const steps = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      steps.push({ from: tokens[i], to: tokens[i + 1] });
    }
    return steps;
  }

  setSilentMode(silent: boolean): void {
    this.silentMode = silent;
  }

  private completePath(pathState: PathState): void {
    if (pathState.completed) return;
    pathState.completed = true;
    
    // Проверяем, все ли шаги успешны
    let allSuccess = true;
    for (let i = 0; i < pathState.stepCount; i++) {
      const result = pathState.results.get(i);
      if (!result || !result.success) {
        allSuccess = false;
        break;
      }
    }
    
    // Если не все шаги успешны - просто выходим
    if (!allSuccess) return;
    
    // Вычисляем прибыль только если все шаги успешны
    const lastStepResult = pathState.results.get(pathState.stepCount - 1)!;
    const finalAmountUSD = parseFloat(lastStepResult.amountOutUsd);
    const profitAmount = finalAmountUSD - pathState.testAmountUSD;
    const profitPercent = (profitAmount / pathState.testAmountUSD) * 100;
    
    const pathResult: PathResult = {
      requestId: pathState.pathId,
      path: pathState.pathStr,
      profitPercent,
      profitAmount,
      endAmount: finalAmountUSD,
      success: true,
    };
    
    this.results.push(pathResult);
    
    // Выводим пути
    if (!this.silentMode) {
      const profitEmoji = profitPercent >= config.scan.minProfitPercent ? '💰' : (profitPercent > 0 ? '✅' : '📉');
      const elapsed = Date.now() - pathState.startTime;
      console.log(`${profitEmoji} ${pathState.pathStr.join(' → ')}: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(4)}% (${elapsed}ms)`);
    }
    
    // Сохраняем прибыльные пути
    if (profitPercent >= config.scan.minProfitPercent && profitPercent < 50) {
      const tokensInfo = [];
      const addedTokens = new Set<string>();
      
      for (const step of pathState.steps) {
        if (!addedTokens.has(step.from.assetId)) {
          tokensInfo.push({
            symbol: step.from.symbol,
            assetId: step.from.assetId,
            blockchain: step.from.blockchain,
            decimals: step.from.decimals,
            price: step.from.price,
          });
          addedTokens.add(step.from.assetId);
        }
        if (!addedTokens.has(step.to.assetId)) {
          tokensInfo.push({
            symbol: step.to.symbol,
            assetId: step.to.assetId,
            blockchain: step.to.blockchain,
            decimals: step.to.decimals,
            price: step.to.price,
          });
          addedTokens.add(step.to.assetId);
        }
      }
      
      const profitableRoute: ProfitableRoute = {
        id: pathState.pathId,
        path: pathState.pathStr,
        steps: pathState.pathStr,
        startStable: pathState.startStable.symbol,
        endStable: pathState.startStable.symbol,
        workingTokens: pathState.pathStr.slice(1, -1),
        profitPercent,
        profitAmount,
        detectedAt: Date.now(),
        lastSeen: Date.now(),
        timesSeen: 1,
        avgProfit: profitPercent,
        minProfit: profitPercent,
        maxProfit: profitPercent,
        tokensInfo,
      };
      
      fileStorage.saveProfitableRoutes([profitableRoute]);
      this.profitableFound.push(profitableRoute);
      
      if (!this.silentMode) {
        console.log(`🔥💰 ПРИБЫЛЬНЫЙ МАРШРУТ: ${pathState.pathStr.join(' → ')} → +${profitPercent.toFixed(4)}% ($${profitAmount.toFixed(4)})`);
      }
    }
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

export const parallelScanner = new ParallelScanner();