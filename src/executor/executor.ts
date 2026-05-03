// src/executor/executor.ts
import { nearRpcClient } from '../clients/nearRpcClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { stringToUint8Array } from '../utils/crypto';
import { Action, ActionType } from '../utils/borsh';  // Добавляем импорт ActionType
import fs from 'fs';
import path from 'path';

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
}

export class Executor {
  private contractId: string = 'intents.near';

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
      recipient: config.near.accountId,
      deposit_type: "INTENTS",
      recipient_type: "INTENTS"
    };
  }

  private createActions(route: ProfitableRoute): Action[] {
    const args = this.buildIntentArgs(route);
    const argsJson = JSON.stringify(args);
    const argsBase64 = Buffer.from(argsJson).toString('base64');
    
    // Согласно документации NEAR:
    // - Максимальное количество газа на транзакцию = 300 TGas
    // - 1 TGas ≈ 1ms вычислительного времени
    const GAS_FOR_FUNCTION_CALL = 300_000_000_000_000n; // 300 TGas
    
    const action: Action = {
      type: ActionType.FunctionCall,  // 2 для FunctionCall
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
      } catch (e) {}
    }
    
    history.push(record);
    
    if (history.length > 1000) {
      history = history.slice(-1000);
    }
    
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
  }

  async executeProfitableRoutes(): Promise<ExecutionResult[]> {
    await nearRpcClient.init();
    
    const routes = this.loadRoutesFromFile();
    
    if (routes.length === 0) {
      logger.warn('Нет маршрутов для исполнения');
      return [];
    }
    
    const profitable = routes.filter(r => r.profitPercent >= config.executor.minProfitPercent);
    
    if (profitable.length === 0) {
      logger.warn(`Нет маршрутов с прибылью >= ${config.executor.minProfitPercent}%`);
      return [];
    }
    
    logger.info(`🚀 Исполнение ${profitable.length} маршрутов...`);
    
    const results: ExecutionResult[] = [];
    for (let i = 0; i < profitable.length; i++) {
      const route = profitable[i];
      if (route && route.id) {
        logger.info(`\n📋 [${i + 1}/${profitable.length}] Исполнение...`);
        
        const result = await this.executeAtomicSwap(route);
        results.push(result);
        
        if (i < profitable.length - 1) {
          await new Promise(r => setTimeout(r, config.executor.executionDelayMs));
        }
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