// src/executor/executor.ts
// Только для атомарного исполнения через NEAR RPC

import { KeyPair, connect, Account, transactions, utils } from 'near-api-js';
import { config } from '../config';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export interface TokenInfo {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
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
}

export class Executor {
  private account: Account | null = null;
  private accountId: string;
  private keyPair: KeyPair;
  private rpcUrl: string;
  private contractId: string = 'intents.near';

  constructor() {
    this.accountId = config.near.accountId;
    this.keyPair = KeyPair.fromString(config.near.privateKey);
    this.rpcUrl = config.near.nodeUrl;
  }

  async init(): Promise<void> {
    const near = await connect({
      networkId: config.near.networkId,
      nodeUrl: this.rpcUrl,
      keyStore: new (await import('near-api-js')).keyStores.InMemoryKeyStore(),
    });
    
    const keyStore = near.config.keyStore;
    await keyStore.setKey(config.near.networkId, this.accountId, this.keyPair);
    
    this.account = await near.account(this.accountId);
    logger.info(`✅ Executor инициализирован: ${this.accountId}`);
  }

  // Чтение маршрутов из файла (созданного сканером)
  loadRoutesFromFile(filePath: string = './profitable.json'): ProfitableRoute[] {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      logger.warn(`Файл ${fullPath} не найден`);
      return [];
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    const routes: ProfitableRoute[] = JSON.parse(content);
    
    logger.info(`📂 Загружено ${routes.length} маршрутов из ${fullPath}`);
    return routes;
  }

  // Проверка актуальности спреда (перепроверка перед исполнением)
  async verifySpread(route: ProfitableRoute): Promise<boolean> {
    // Здесь можно сделать быстрый RPC запрос к контракту
    // для проверки что спред ещё существует
    logger.debug(`🔍 Проверка спреда для ${route.id}...`);
    return true; // Пока заглушка
  }

  // Атомарное исполнение через INTENTS
  async executeAtomicSwap(route: ProfitableRoute): Promise<ExecutionResult> {
    if (!this.account) {
      throw new Error('Executor не инициализирован');
    }
    
    logger.trade(`🔄 Атомарный своп: ${route.path.join(' → ')}`);
    logger.info(`   Прибыль: ${route.profitPercent}%`);
    
    try {
      const startToken = route.tokensInfo[0];
      const amountIn = Math.floor(
        config.executor.baseAmount * Math.pow(10, startToken.decimals)
      );
      
      // Аргументы для INTENTS контракта
      const args = {
        path: route.tokensInfo.map(t => t.assetId),
        amount_in: amountIn.toString(),
        min_amount_out: this.calculateMinAmountOut(route),
        recipient: this.accountId,
      };
      
      const result = await this.account.functionCall({
        contractId: this.contractId,
        methodName: 'execute_intent',  // Уточнить имя метода
        args,
        gas: BigInt(300000000000000),
        attachedDeposit: BigInt(0),
      });
      
      logger.trade(`✅ Исполнено! TX: ${result.transaction.hash}`);
      
      return {
        success: true,
        routeId: route.id,
        txHash: result.transaction.hash,
        profitPercent: route.profitPercent,
      };
      
    } catch (error: any) {
      logger.error(`❌ Ошибка: ${error.message}`);
      return {
        success: false,
        routeId: route.id,
        error: error.message,
      };
    }
  }

  private calculateMinAmountOut(route: ProfitableRoute): string {
    const endToken = route.tokensInfo[route.tokensInfo.length - 1];
    const minProfit = 1 - (config.trading.slippageToleranceBps / 10000);
    const expectedOut = (config.executor.baseAmount / parseFloat(endToken.price)) 
      * Math.pow(10, endToken.decimals);
    return Math.floor(expectedOut * minProfit).toString();
  }

  // Основной метод: читает файл, фильтрует, исполняет
  async executeProfitableRoutes(): Promise<ExecutionResult[]> {
    // 1. Читаем маршруты из файла
    const routes = this.loadRoutesFromFile();
    
    if (routes.length === 0) {
      logger.warn('Нет маршрутов для исполнения');
      return [];
    }
    
    // 2. Фильтруем по прибыли
    const profitable = routes.filter(r => r.profitPercent >= config.executor.minProfitPercent);
    logger.info(`🚀 Исполнение ${profitable.length} маршрутов...`);
    
    // 3. Исполняем атомарно
    const results: ExecutionResult[] = [];
    for (const route of profitable) {
      // Проверяем актуальность спреда
      const isValid = await this.verifySpread(route);
      if (!isValid) {
        logger.warn(`Спред для ${route.id} больше не актуален`);
        continue;
      }
      
      const result = await this.executeAtomicSwap(route);
      results.push(result);
      
      // Пауза между транзакциями
      await new Promise(r => setTimeout(r, config.executor.executionDelayMs));
    }
    
    const successCount = results.filter(r => r.success).length;
    logger.info(`📊 Готово: ${successCount}/${results.length} успешно`);
    
    return results;
  }
}

export const executor = new Executor();