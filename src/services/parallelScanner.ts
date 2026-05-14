import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import { ArbitragePath } from './pathGenerator';
import { fileStorage, ScannedRoute } from './fileStorage';

interface StepResult {
  pathId: string;
  stepIndex: number;
  amountOut: string;
  amountOutUsd: string;
  success: boolean;
  error?: string;
}

interface PathState {
  path: ArbitragePath;
  startAmount: string;
  testAmountUSD: number;
  results: Map<number, StepResult>;
  stepCount: number;
  startTime: number;
  completed: boolean;
}

export class ParallelScanner {
  private pathStates = new Map<string, PathState>();
  private results: ScannedRoute[] = [];
  private totalPaths = 0;
  private completedPaths = 0;
  private activeTimeouts = new Set<NodeJS.Timeout>();
  private requestDelay = 200; // мс между отправками первых запросов

  async scanPaths(paths: ArbitragePath[], testAmountUSD: number = 100): Promise<ScannedRoute[]> {
    this.results = [];
    this.pathStates.clear();
    this.completedPaths = 0;
    this.activeTimeouts.clear();
    this.totalPaths = paths.length;

    if (this.totalPaths === 0) return [];

    console.log(`\n🚀 АСИНХРОННОЕ СКАНИРОВАНИЕ`);
    console.log(`   Всего маршрутов: ${this.totalPaths}`);
    console.log(`   Интервал между отправками: ${this.requestDelay}мс\n`);

    const stable = paths[0].tokens[0];
    const startAmount = this.usdToAmount(testAmountUSD, parseFloat(stable.price), stable.decimals);

    // Отправляем первые запросы для ВСЕХ путей (как в старой версии)
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const state: PathState = {
        path,
        startAmount,
        testAmountUSD,
        results: new Map(),
        stepCount: path.steps.length,
        startTime: Date.now(),
        completed: false,
      };
      this.pathStates.set(path.id, state);
      this.executeStep(state, 0, startAmount); // без await – запускаем асинхронно
      if (i < paths.length - 1) await this.delay(this.requestDelay);
    }

    // Таймер для проверки зависших путей (каждые 10 секунд)
    const checkInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, state] of this.pathStates) {
        if (!state.completed && (now - state.startTime) > 120000) {
          console.log(`⚠️ Таймаут пути: ${state.path.id}`);
          for (let i = 0; i < state.stepCount; i++) {
            if (!state.results.has(i)) {
              state.results.set(i, { pathId: id, stepIndex: i, amountOut: '', amountOutUsd: '', success: false, error: 'global timeout' });
            }
          }
          this.completePath(state);
          this.completedPaths++;
        }
      }
    }, 10000);

    // Ждём завершения всех
    let lastLog = 0;
    while (this.completedPaths < this.totalPaths) {
      await this.delay(1000);
      if (this.completedPaths !== lastLog) {
        lastLog = this.completedPaths;
        console.log(`   Прогресс: ${this.completedPaths}/${this.totalPaths} (${Math.round(this.completedPaths/this.totalPaths*100)}%)`);
      }
    }

    clearInterval(checkInterval);
    for (const t of this.activeTimeouts) clearTimeout(t);
    console.log(`\n✅ Сканирование завершено. Обработано: ${this.completedPaths}/${this.totalPaths}`);
    return this.results;
  }

  private async executeStep(state: PathState, stepIdx: number, amountIn: string, retries = 2) {
    if (state.completed) return;
    const step = state.path.steps[stepIdx];
    if (!step) return;

    const timeoutId = setTimeout(() => {
      const errResult: StepResult = {
        pathId: state.path.id,
        stepIndex: stepIdx,
        amountOut: '',
        amountOutUsd: '',
        success: false,
        error: 'timeout',
      };
      this.handleStepResult(state, errResult);
    }, 30000);
    this.activeTimeouts.add(timeoutId);

    try {
      // Определяем адреса согласно типам (как в новой логике)
      const recipient = step.recipientType === 'INTENTS'
        ? config.addresses.near
        : this.getAddressForBlockchain(step.to.blockchain);

      const refundTo = step.depositType === 'INTENTS'
        ? config.addresses.near
        : this.getAddressForBlockchain(step.from.blockchain);

      const quote = await nearIntentsClient.getQuote({
        originAsset: step.from.assetId,
        destinationAsset: step.to.assetId,
        amount: amountIn,
        depositType: step.depositType,
        recipientType: step.recipientType,
        recipient,
        refundTo,
        dry: true,
      });

      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);

      if (!quote.quote?.amountOut) throw new Error('No liquidity');

      const result: StepResult = {
        pathId: state.path.id,
        stepIndex: stepIdx,
        amountOut: quote.quote.amountOut,
        amountOutUsd: quote.quote.amountOutUsd,
        success: true,
      };
      this.handleStepResult(state, result);
    } catch (err: any) {
      clearTimeout(timeoutId);
      this.activeTimeouts.delete(timeoutId);
      const errorMsg = err.response?.data?.message || err.message;
      const isTimeout = errorMsg.includes('timeout') || err.code === 'ECONNRESET';
      if (retries > 0 && isTimeout) {
        console.log(`🔄 Повтор шага ${stepIdx+1} для ${state.path.id} (осталось: ${retries})`);
        await this.delay(1000);
        await this.executeStep(state, stepIdx, amountIn, retries - 1);
      } else {
        const failResult: StepResult = {
          pathId: state.path.id,
          stepIndex: stepIdx,
          amountOut: '',
          amountOutUsd: '',
          success: false,
          error: errorMsg,
        };
        this.handleStepResult(state, failResult);
      }
    }
  }

  private handleStepResult(state: PathState, result: StepResult): void {
    if (state.completed) return;
    if (state.results.has(result.stepIndex)) return;
    state.results.set(result.stepIndex, result);

    // Если шаг успешен и есть следующий – продолжаем
    if (result.success && result.stepIndex + 1 < state.stepCount) {
      this.executeStep(state, result.stepIndex + 1, result.amountOut, 2);
    }

    // Если это последний шаг или ошибка – завершаем путь
    const isLast = result.stepIndex === state.stepCount - 1;
    if (isLast || !result.success) {
      // Заполняем пропущенные шаги ошибкой
      for (let i = 0; i < state.stepCount; i++) {
        if (!state.results.has(i)) {
          state.results.set(i, {
            pathId: state.path.id,
            stepIndex: i,
            amountOut: '',
            amountOutUsd: '',
            success: false,
            error: 'aborted',
          });
        }
      }
      this.completePath(state);
      this.completedPaths++;
    }
  }

  private completePath(state: PathState): void {
    if (state.completed) return;
    state.completed = true;

    // Проверяем, все ли шаги успешны
    let allSuccess = true;
    for (let i = 0; i < state.stepCount; i++) {
      if (!state.results.get(i)?.success) { allSuccess = false; break; }
    }
    if (!allSuccess) return;

    const last = state.results.get(state.stepCount - 1)!;
    const finalUSD = parseFloat(last.amountOutUsd);
    const profitAmount = finalUSD - state.testAmountUSD;
    const profitPercent = (profitAmount / state.testAmountUSD) * 100;

    const routeData: ScannedRoute = {
      id: state.path.id,
      pathStr: state.path.tokens.map(t => `${t.symbol}(${t.blockchain})`).join(' → '),
      steps: state.path.tokens.map(t => `${t.symbol}(${t.blockchain})`),
      profitPercent,
      profitAmount,
      testAmountUSD: state.testAmountUSD,
      timestamp: Date.now(),
      usdIn: state.testAmountUSD,
      usdOut: finalUSD,
      tokensInfo: state.path.tokens.map(t => ({
        symbol: t.symbol,
        assetId: t.assetId,
        blockchain: t.blockchain,
        decimals: t.decimals,
      })),
      isProfitable: profitPercent >= config.scan.minProfitPercent,
    };

    this.results.push(routeData);

    if (profitPercent >= config.scan.minProfitPercent && profitPercent < 50) {
      fileStorage.saveProfitableRoute(routeData);
      console.log(`💰 ПРИБЫЛЬ: ${routeData.pathStr} → +${profitPercent.toFixed(4)}%`);
    } else {
      fileStorage.saveNonProfitableRoute(routeData);
      if (profitPercent > 0) {
        console.log(`✅ Мелкая прибыль: ${routeData.pathStr} → +${profitPercent.toFixed(4)}%`);
      }
      // убытки не выводим, чтобы не засорять консоль
    }
  }

  private getAddressForBlockchain(blockchain: string): string {
    return config.addresses.near;
  }

  private usdToAmount(usd: number, price: number, decimals: number): string {
    return Math.floor((usd / price) * Math.pow(10, decimals)).toString();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const parallelScanner = new ParallelScanner();