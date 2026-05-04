// src/executor/executor.ts
import { nearRpcClient } from '../clients/nearRpcClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { stringToUint8Array } from '../utils/crypto';
import { Action, ActionType } from '../utils/borsh';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TokenInfo {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
  price?: string;
}

export interface ProfitableRoute {
  id: string;
  path: string[];
  profitPercent: number;
  profitAmount: number;
  tokensInfo: TokenInfo[];
}

export interface ExecutionResult {
  success: boolean;
  routeId: string;
  txHash?: string;
  error?: string;
  profitPercent?: number;
  simulated?: boolean;
}

export class Executor {
  private contractId: string = 'intents.near';
  private storageDir: string;
  private profitablePath: string;
  private recipientAddress: string;

  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage');
    this.profitablePath = path.join(this.storageDir, 'profitable.json');
    this.recipientAddress = config.addresses.near || config.near.accountId || '';

    if (!this.recipientAddress) {
      logger.warn('⚠️ Адрес получателя не указан в конфигурации');
    }
  }

  loadRoutesFromFile(): ProfitableRoute[] {
    try {
      if (!fs.existsSync(this.profitablePath)) {
        logger.warn(`Файл ${this.profitablePath} не найден`);
        return [];
      }

      const content = fs.readFileSync(this.profitablePath, 'utf-8');
      if (!content || content.trim() === '') {
        logger.warn(`Файл ${this.profitablePath} пуст`);
        return [];
      }

      const routes: ProfitableRoute[] = JSON.parse(content);
      logger.info(`📂 Загружено ${routes.length} маршрутов из ${this.profitablePath}`);
      return routes;

    } catch (error: any) {
      logger.error(`❌ Ошибка загрузки путей: ${error.message}`);
      return [];
    }
  }

  // ===== РЕАЛЬНАЯ СИМУЛЯЦИЯ ПРИБЫЛЬНОСТИ ЧЕРЕЗ RPC =====
  // src/executor/executor.ts - исправленный метод simulateProfitability

  async simulateProfitability(route: ProfitableRoute): Promise<{
    isProfitable: boolean;
    currentProfitPercent: number;
    currentProfitAmount: number;
    amountOut?: string;
    error?: string;
  }> {
    logger.debug(`🔍 RPC симуляция с правильной подписью: ${route.path.join(' → ')}`);

    if (!this.recipientAddress) {
      return {
        isProfitable: false,
        currentProfitPercent: 0,
        currentProfitAmount: 0,
        error: 'Адрес получателя не указан'
      };
    }

    try {
      const startToken = route.tokensInfo[0];
      const endToken = route.tokensInfo[route.tokensInfo.length - 1];
      const testAmountUSD = config.trading.testAmountUSD;

      if (!startToken.price || !endToken.price) {
        return {
          isProfitable: false,
          currentProfitPercent: 0,
          currentProfitAmount: 0,
          error: 'Отсутствует цена токена'
        };
      }

      const amountIn = Math.floor(
        (testAmountUSD / parseFloat(startToken.price)) * Math.pow(10, startToken.decimals)
      );

      // Формируем diff для token_diff интента
      const diff: Record<string, string> = {};
      diff[startToken.assetId] = `-${amountIn}`;
      // Выход пока неизвестен, ставим 0 - контракт сам рассчитает
      diff[endToken.assetId] = `+0`;

      const intent = {
        intent: "token_diff",
        diff: diff
      };

      // Генерируем nonce и deadline
      const nonce = nearRpcClient.getRandomNonce();
      const deadline = new Date(Date.now() + 60000).toISOString();

      // Создаём подписанный интент
      const signedIntent = await nearRpcClient.createSignedIntent(
        intent,
        nonce,
        deadline,
        'intents.near'
      );

      logger.debug(`   Подписанный интент создан`);

      // Вызываем simulate_intents
      const simulation = await nearRpcClient.simulateIntent([signedIntent]);

      logger.debug(`   Simulation logs: ${JSON.stringify(simulation.logs)}`);

      let finalAmountOut = 0;

      // Парсим результат из логов
      if (simulation.logs && Array.isArray(simulation.logs)) {
        for (const log of simulation.logs) {
          if (typeof log === 'string' && log.includes('EVENT_JSON')) {
            const match = log.match(/EVENT_JSON:(.*)/);
            if (match && match[1]) {
              try {
                const eventData = JSON.parse(match[1]);
                if (eventData.event === 'token_diff' && Array.isArray(eventData.data)) {
                  for (const item of eventData.data) {
                    if (item && item.account_id === this.recipientAddress && item.diff) {
                      for (const [assetId, amountValue] of Object.entries(item.diff)) {
                        if (assetId === endToken.assetId && typeof amountValue === 'string') {
                          if (amountValue.startsWith('+')) {
                            finalAmountOut = parseInt(amountValue.substring(1), 10);
                            logger.debug(`   Найден amount_out: ${finalAmountOut}`);
                          }
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                logger.debug(`   Ошибка парсинга: ${e}`);
              }
            }
          }
        }
      }

      if (finalAmountOut === 0) {
        logger.warn(`   ⚠️ Не удалось получить amount_out из симуляции`);
        logger.debug(`   Полный ответ: ${JSON.stringify(simulation)}`);
        return {
          isProfitable: false,
          currentProfitPercent: 0,
          currentProfitAmount: 0,
          error: 'Не удалось получить результат симуляции'
        };
      }

      const amountOutUSD = (finalAmountOut / Math.pow(10, endToken.decimals)) * parseFloat(endToken.price);
      const profitAmount = amountOutUSD - testAmountUSD;
      const profitPercent = (profitAmount / testAmountUSD) * 100;

      logger.debug(`   📊 Результат: ${amountOutUSD.toFixed(4)} USD, прибыль: ${profitPercent.toFixed(4)}%`);

      return {
        isProfitable: profitPercent >= config.executor.minProfitPercent,
        currentProfitPercent: profitPercent,
        currentProfitAmount: profitAmount,
        amountOut: finalAmountOut.toString()
      };

    } catch (error: any) {
      logger.error(`❌ Ошибка RPC симуляции: ${error.message}`);
      return {
        isProfitable: false,
        currentProfitPercent: 0,
        currentProfitAmount: 0,
        error: error.message
      };
    }
  }
  private buildIntentArgs(route: ProfitableRoute): Record<string, unknown> {
    const startToken = route.tokensInfo[0];
    const endToken = route.tokensInfo[route.tokensInfo.length - 1];

    const amountIn = Math.floor(
      config.executor.baseAmount * Math.pow(10, startToken.decimals)
    );

    let expectedOut = 0;
    if (endToken.price) {
      expectedOut = (config.executor.baseAmount / parseFloat(endToken.price))
        * Math.pow(10, endToken.decimals);
    }

    const slippageFactor = 1 - (config.trading.slippageToleranceBps / 10000);
    const minAmountOut = Math.floor(expectedOut * slippageFactor);

    return {
      path: route.tokensInfo.map(t => t.assetId),
      amount_in: amountIn.toString(),
      min_amount_out: minAmountOut.toString(),
      recipient: this.recipientAddress || config.near.accountId,
      deposit_type: "INTENTS",
      recipient_type: "INTENTS"
    };
  }

  private createActions(route: ProfitableRoute): Action[] {
    const args = this.buildIntentArgs(route);
    const argsJson = JSON.stringify(args);
    const argsBase64 = Buffer.from(argsJson).toString('base64');

    const GAS_FOR_FUNCTION_CALL = 300_000_000_000_000n;

    const action: Action = {
      type: ActionType.FunctionCall,
      functionCall: {
        methodName: 'execute_intent',
        args: stringToUint8Array(argsBase64),
        gas: GAS_FOR_FUNCTION_CALL,
        deposit: 0n
      }
    };

    return [action];
  }

  async executeAtomicSwap(route: ProfitableRoute): Promise<ExecutionResult> {
    logger.trade(`🔄 Атомарный INTENTS своп: ${route.path.join(' → ')}`);
    logger.info(`   Прибыль: ${route.profitPercent.toFixed(4)}%`);
    logger.info(`   Сумма: ${config.executor.baseAmount} USDC`);

    if (config.dryRunOnly) {
      logger.info(`   💡 DRY-RUN: симуляция без реальной транзакции`);
      await new Promise(r => setTimeout(r, 500));

      this.saveExecutionHistory({
        routeId: route.id,
        path: route.path,
        profitPercent: route.profitPercent,
        profitAmount: route.profitAmount,
        txHash: `dry-run-${Date.now()}`,
        executedAt: Date.now(),
        success: true
      });

      return {
        success: true,
        routeId: route.id,
        txHash: `dry-run-${Date.now()}`,
        profitPercent: route.profitPercent,
      };
    }

    if (!this.recipientAddress) {
      const error = 'Адрес получателя не указан';
      logger.error(`❌ ${error}`);
      return {
        success: false,
        routeId: route.id,
        error: error,
      };
    }

    try {
      const account = await nearRpcClient.getAccount();
      const block = await nearRpcClient.getLatestBlock();

      logger.debug(`   Nonce: ${account.nonce}, Block: ${block.height}`);

      const actions = this.createActions(route);

      const signedTx = await nearRpcClient.createAndSignTransaction(
        this.contractId,
        actions,
        account.nonce,
        block.hash
      );

      const result = await nearRpcClient.sendTransaction(signedTx);

      logger.trade(`✅ Исполнено! TX: ${result.transaction_hash}`);

      this.saveExecutionHistory({
        routeId: route.id,
        path: route.path,
        profitPercent: route.profitPercent,
        profitAmount: route.profitAmount,
        txHash: result.transaction_hash,
        executedAt: Date.now(),
        success: true
      });

      return {
        success: true,
        routeId: route.id,
        txHash: result.transaction_hash,
        profitPercent: route.profitPercent,
      };

    } catch (error: any) {
      logger.error(`❌ Ошибка: ${error.message}`);

      this.saveExecutionHistory({
        routeId: route.id,
        path: route.path,
        profitPercent: route.profitPercent,
        profitAmount: route.profitAmount,
        error: error.message,
        executedAt: Date.now(),
        success: false
      });

      return {
        success: false,
        routeId: route.id,
        error: error.message,
      };
    }
  }

  private saveExecutionHistory(record: Record<string, unknown>): void {
    const historyFile = path.resolve('./execution_history.json');
    let history: Record<string, unknown>[] = [];

    if (fs.existsSync(historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      } catch (e) { }
    }

    history.push(record);

    if (history.length > 1000) {
      history = history.slice(-1000);
    }

    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  }

  async executeProfitableRoutes(): Promise<ExecutionResult[]> {
    if (!config.dryRunOnly) {
      await nearRpcClient.init();
    }

    const routes = this.loadRoutesFromFile();

    if (routes.length === 0) {
      logger.warn('Нет маршрутов для исполнения');
      return [];
    }

    const sortedRoutes = [...routes].sort((a, b) => b.profitPercent - a.profitPercent);
    const candidates = sortedRoutes.filter(r => r.profitPercent >= config.executor.minProfitPercent);

    if (candidates.length === 0) {
      logger.warn(`Нет маршрутов с прибылью >= ${config.executor.minProfitPercent}%`);
      return [];
    }

    logger.info(`🚀 Проверка ${candidates.length} маршрутов на актуальность через RPC...`);
    logger.info(`   Режим: ${config.dryRunOnly ? 'DRY-RUN (симуляция)' : 'РЕАЛЬНЫЙ'}`);

    const results: ExecutionResult[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const route = candidates[i];
      logger.info(`\n📋 [${i + 1}/${candidates.length}] ${route.path.join(' → ')}`);
      logger.info(`   Историческая прибыль: ${route.profitPercent.toFixed(4)}%`);

      const simulation = await this.simulateProfitability(route);

      if (!simulation.isProfitable) {
        logger.info(`   📉 Текущая прибыль: ${simulation.currentProfitPercent.toFixed(4)}% (ниже порога или нет ликвидности)`);
        if (simulation.error) {
          logger.debug(`      Причина: ${simulation.error}`);
        }
        continue;
      }

      logger.info(`   ✅ Текущая прибыль: ${simulation.currentProfitPercent.toFixed(4)}% (выше порога)`);

      const result = await this.executeAtomicSwap(route);
      results.push(result);

      if (i < candidates.length - 1) {
        await new Promise(r => setTimeout(r, config.executor.executionDelayMs));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalProfit = results
      .filter(r => r.success && r.profitPercent)
      .reduce((sum, r) => sum + (r.profitPercent || 0), 0);

    logger.info(`\n📊 ИТОГИ: ${successCount}/${results.length} успешно`);
    logger.info(`💰 Суммарная прибыль: ${totalProfit.toFixed(4)}%`);

    return results;
  }
}

export const executor = new Executor();