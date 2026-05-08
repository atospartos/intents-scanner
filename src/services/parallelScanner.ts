// src/services/parallelScanner.ts (исправлен)
import { nearIntentsClient, Token } from '../clients/nearIntentsClient';
import { config } from '../config';
import { ArbitragePath } from './pathGenerator';
import { fileStorage, ProfitableRoute } from './fileStorage';

interface StepResult {
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
  completed: boolean;
  currentStep: number;
}

export interface ScanResult {
  pathId: string;
  pathStr: string;
  profitPercent: number;
  profitAmount: number;
  success: boolean;
}

export class ParallelScanner {
  private activeStates = new Map<string, PathState>();
  private results: ScanResult[] = [];
  private total = 0;
  private completed = 0;
  private concurrencyLimit = 15;              // одновременных цепочек
  private activeChains = 0;
  private queue: ArbitragePath[] = [];

  async scanPaths(paths: ArbitragePath[], testAmountUSD = 100): Promise<ScanResult[]> {
    this.results = [];
    this.activeStates.clear();
    this.total = paths.length;
    this.completed = 0;
    this.activeChains = 0;
    this.queue = [...paths];

    const stable = paths[0]?.tokens[0];
    if (!stable) return [];

    const startAmount = this.usdToAmount(testAmountUSD, parseFloat(stable.price), stable.decimals);

    // Запускаем первоначальные цепочки
    for (let i = 0; i < this.concurrencyLimit && this.queue.length; i++) {
      this.startNextChain(stable, startAmount, testAmountUSD);
    }

    // Ожидаем завершения
    while (this.completed < this.total) {
      await this.delay(100);
    }

    return this.results;
  }

  private startNextChain(stable: Token, startAmount: string, testAmountUSD: number) {
    const path = this.queue.shift();
    if (!path) return;

    const state: PathState = {
      path,
      startAmount,
      testAmountUSD,
      results: new Map(),
      completed: false,
      currentStep: 0,
    };
    this.activeStates.set(path.id, state);
    this.activeChains++;
    this.executeStep(state, 0, startAmount);
  }

  private async executeStep(state: PathState, idx: number, amountIn: string) {
    if (state.completed) return;
    const step = state.path.steps[idx];
    if (!step) return;

    try {
      const recipient = step.recipientType === 'INTENTS'
        ? config.addresses.near
        : config.addresses.evm || config.addresses.near;

      const refundTo = step.depositType === 'INTENTS'
        ? config.addresses.near
        : config.addresses.evm || config.addresses.near;

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

      if (!quote.quote?.amountOut) throw new Error('no liquidity');

      const result: StepResult = {
        stepIndex: idx,
        amountOut: quote.quote.amountOut,
        amountOutUsd: quote.quote.amountOutUsd,
        success: true,
      };
      state.results.set(idx, result);

      if (idx + 1 < state.path.steps.length) {
        await this.executeStep(state, idx + 1, result.amountOut);
      } else {
        this.finishChain(state);
      }
    } catch (err: any) {
      state.results.set(idx, { stepIndex: idx, amountOut: '', amountOutUsd: '', success: false, error: err.message });
      this.finishChain(state);
    }
  }

  private finishChain(state: PathState) {
    if (state.completed) return;
    state.completed = true;

    const last = state.results.get(state.path.steps.length - 1);
    if (last?.success) {
      const finalUSD = parseFloat(last.amountOutUsd);
      const profitAmount = finalUSD - state.testAmountUSD;
      const profitPercent = (profitAmount / state.testAmountUSD) * 100;

      const result: ScanResult = {
        pathId: state.path.id,
        pathStr: state.path.tokens.map(t => `${t.symbol}(${t.blockchain})`).join(' → '),
        profitPercent,
        profitAmount,
        success: true,
      };
      this.results.push(result);

      if (profitPercent >= config.scan.minProfitPercent && profitPercent < 50) {
        const route: ProfitableRoute = {
          id: state.path.id,
          path: result.pathStr.split(' → '),
          steps: result.pathStr.split(' → '),
          startStable: state.path.tokens[0].symbol,
          endStable: state.path.tokens[state.path.tokens.length-1].symbol,
          workingTokens: state.path.tokens.slice(1, -1).map(t => t.symbol),
          profitPercent,
          profitAmount,
          detectedAt: Date.now(),
          lastSeen: Date.now(),
          timesSeen: 1,
          avgProfit: profitPercent,
          minProfit: profitPercent,
          maxProfit: profitPercent,
          tokensInfo: state.path.tokens.map(t => ({
            symbol: t.symbol,
            assetId: t.assetId,
            blockchain: t.blockchain,
            decimals: t.decimals,
          })),
        };
        fileStorage.saveProfitableRoutes([route]);
        console.log(`💰 ПРИБЫЛЬ: ${result.pathStr} → +${profitPercent.toFixed(4)}%`);
      }
    }

    this.activeStates.delete(state.path.id);
    this.activeChains--;
    this.completed++;

    // Запускаем следующую цепочку из очереди
    if (this.queue.length > 0) {
      const stable = state.path.tokens[0];
      this.startNextChain(stable, state.startAmount, state.testAmountUSD);
    }
  }

  private usdToAmount(usd: number, price: number, decimals: number): string {
    const amount = (usd / price) * Math.pow(10, decimals);
    return Math.floor(amount).toString();
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const parallelScanner = new ParallelScanner();