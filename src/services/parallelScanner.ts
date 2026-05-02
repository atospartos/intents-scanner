import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { fileStorage, ProfitableRoute } from './fileStorage';

const quoteCache = new Map<string, { amountOut: string; timestamp: number }>();
const CACHE_TTL = 60000;

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
  private requestIdCounter = 0;
  private results: PathResult[] = [];
  private profitableFound: ProfitableRoute[] = [];
  private requestDelay = 200;
  private totalRequests = 0;
  private completedRequests = 0;
  private activeTimeouts: Set<NodeJS.Timeout> = new Set();
  private silentMode = false;
  private totalPathsFixed = 0;

  setSilentMode(silent: boolean): void {
    this.silentMode = silent;
  }

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
    this.requestIdCounter = 0;
    this.completedRequests = 0;
    this.totalRequests = 0;
    this.activeTimeouts.clear();
    this.totalPathsFixed = paths.length;
    
    if (!this.silentMode) {
      console.log(`\n🚀 ЗАПУСК АСИНХРОННОГО СКАНИРОВАНИЯ`);
      console.log(`   Всего путей: ${this.totalPathsFixed}`);
      console.log(`   Интервал между отправками: ${this.requestDelay}мс\n`);
    }
    
    const allStartTime = Date.now();
    
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
      this.totalRequests++;
      this.sendRequest(pathId, 0, firstStep, startAmount);
      
      if (i < paths.length - 1) {
        await this.delay(this.requestDelay);
      }
    }
    
    const maxWaitTime = 600000;
    const waitStart = Date.now();
    let lastProgress = 0;
    
    while (this.completedRequests < this.totalRequests && (Date.now() - waitStart) < maxWaitTime) {
      await this.delay(500);
      
      if (!this.silentMode && this.completedRequests !== lastProgress) {
        lastProgress = this.completedRequests;
        const progress = ((this.completedRequests / this.totalRequests) * 100).toFixed(1);
        console.log(`   📊 Прогресс: ${this.completedRequests}/${this.totalRequests} (${progress}%) | Найдено: ${this.profitableFound.length}`);
      }
    }
    
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();
    
    const elapsed = (Date.now() - allStartTime) / 1000;
    if (!this.silentMode) {
      console.log(`\n✅ Сканирование завершено за ${elapsed.toFixed(1)} секунд`);
      console.log(`   Всего запросов: ${this.completedRequests}/${this.totalRequests}`);
      console.log(`   Найдено прибыльных путей: ${this.profitableFound.length}`);
    }
    
    return this.results;
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

  private async sendRequest(pathId: string, stepIndex: number, step: { from: Token; to: Token }, amountIn: string): Promise<void> {
    const cacheKey = `${step.from.assetId}|${step.to.assetId}|${amountIn}`;
    const cached = quoteCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const result: StepResult = {
        pathId,
        stepIndex,
        amountOut: cached.amountOut,
        amountOutFormatted: (parseFloat(cached.amountOut) / Math.pow(10, step.to.decimals)).toFixed(6),
        amountOutUsd: ((parseFloat(cached.amountOut) / Math.pow(10, step.to.decimals)) * parseFloat(step.to.price)).toFixed(4),
        success: true,
      };
      this.handleStepResult(result);
      return;
    }
    
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
      
      quoteCache.set(cacheKey, {
        amountOut: quote.quote.amountOut,
        timestamp: Date.now(),
      });
      
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
    this.completedRequests++;
    
    if (result.success && result.stepIndex + 1 < pathState.stepCount) {
      const nextStep = pathState.steps[result.stepIndex + 1];
      this.totalRequests++;
      this.sendRequest(result.pathId, result.stepIndex + 1, nextStep, result.amountOut);
    }
    
    if (pathState.results.size === pathState.stepCount) {
      this.completePath(pathState);
    }
  }

  private completePath(pathState: PathState): void {
    if (pathState.completed) return;
    pathState.completed = true;
    
    let allSuccess = true;
    for (let i = 0; i < pathState.stepCount; i++) {
      const result = pathState.results.get(i);
      if (!result || !result.success) {
        allSuccess = false;
        break;
      }
    }
    
    if (!allSuccess) return;
    
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
    
    if (!this.silentMode) {
      const profitEmoji = profitPercent >= config.scan.minProfitPercent ? '💰' : (profitPercent > 0 ? '✅' : '📉');
      const elapsed = Date.now() - pathState.startTime;
      console.log(`${profitEmoji} ${pathState.pathStr.join(' → ')}: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(4)}% (${elapsed}ms)`);
    }
    
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
          });
          addedTokens.add(step.from.assetId);
        }
        if (!addedTokens.has(step.to.assetId)) {
          tokensInfo.push({
            symbol: step.to.symbol,
            assetId: step.to.assetId,
            blockchain: step.to.blockchain,
            decimals: step.to.decimals,
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
      
      fileStorage.saveProfitableRoute(profitableRoute);
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