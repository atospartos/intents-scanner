import fs from 'fs';
import path from 'path';
import { Token } from '../clients/nearIntentsClient';

export interface StoredLiquidToken {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
  price: string;
  bestPair: string;
  bestPairValue: number;
  lastVerified: number;
}

export interface StoredPath {
  id: string;
  path: string[];
  steps: string[];
  startStable: string;
  endStable: string;
  workingTokens: string[];
  profitHistory: Array<{
    timestamp: number;
    profitPercent: number;
    profitAmount: number;
  }>;
  avgProfit: number;
  lastChecked: number;
  successCount: number;
  failCount: number;
}

export interface StoredTokenInfo {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
}

export interface ProfitableRoute {
  id: string;
  path: string[];
  steps: string[];
  startStable: string;
  endStable: string;
  workingTokens: string[];
  profitPercent: number;
  profitAmount: number;
  detectedAt: number;
  lastSeen: number;
  timesSeen: number;
  avgProfit: number;
  minProfit: number;
  maxProfit: number;
  tokensInfo?: StoredTokenInfo[];  // ← НОВОЕ ПОЛЕ
}

export class FileStorage {
  private storageDir: string;
  private tokensPath: string;
  private pathsPath: string;
  private profitablePath: string;

  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.tokensPath = path.join(this.storageDir, 'liquid-tokens.json');
    this.pathsPath = path.join(this.storageDir, 'paths.json');
    this.profitablePath = path.join(this.storageDir, 'profitable.json');
  }

  // ========== ТОКЕНЫ ==========

  saveTokens(stablecoins: Token[], liquidTokens: StoredLiquidToken[]): void {
    try {
      const data = {
        timestamp: Date.now(),
        stablecoins: stablecoins.map(t => ({
          symbol: t.symbol,
          assetId: t.assetId,
          blockchain: t.blockchain,
          decimals: t.decimals,
          price: t.price,
        })),
        liquidTokens,
      };
      fs.writeFileSync(this.tokensPath, JSON.stringify(data, null, 2));
      console.log(`💾 Токены сохранены: ${liquidTokens.length} ликвидных`);
    } catch (error: any) {
      console.error(`❌ Ошибка сохранения токенов: ${error.message}`);
    }
  }

  loadTokens(): { stablecoins: Token[]; liquidTokens: StoredLiquidToken[]; timestamp: number } | null {
    try {
      if (fs.existsSync(this.tokensPath)) {
        const data = JSON.parse(fs.readFileSync(this.tokensPath, 'utf-8'));
        return data;
      }
    } catch (error: any) {
      console.error(`❌ Ошибка загрузки токенов: ${error.message}`);
    }
    return null;
  }

  isTokensValid(maxAgeHours: number = 1): boolean {
    try {
      if (!fs.existsSync(this.tokensPath)) return false;
      const stat = fs.statSync(this.tokensPath);
      const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
      return ageHours < maxAgeHours;
    } catch {
      return false;
    }
  }

  // ========== ВСЕ ПУТИ ==========

  savePaths(paths: StoredPath[], pathLength: number): void {
    try {
      let existing: Record<number, { timestamp: number; count: number; paths: StoredPath[] }> = {};
      if (fs.existsSync(this.pathsPath)) {
        existing = JSON.parse(fs.readFileSync(this.pathsPath, 'utf-8'));
      }

      existing[pathLength] = {
        timestamp: Date.now(),
        count: paths.length,
        paths: paths
      };

      fs.writeFileSync(this.pathsPath, JSON.stringify(existing, null, 2));
      console.log(`💾 Пути длины ${pathLength} сохранены: ${paths.length} путей`);
    } catch (error: any) {
      console.error(`❌ Ошибка сохранения путей: ${error.message}`);
    }
  }

  private pathsCache: { paths: StoredPath[]; timestamp: number } | null = null;
  private cacheTTL = 60000; // 60 секунд

  loadPaths(pathLength: number): { paths: StoredPath[]; timestamp: number } | null {
    // Проверяем кэш
    if (this.pathsCache && Date.now() - this.pathsCache.timestamp < this.cacheTTL) {
      return this.pathsCache;
    }

    try {
      if (fs.existsSync(this.pathsPath)) {
        const data = JSON.parse(fs.readFileSync(this.pathsPath, 'utf-8'));
        if (data[pathLength]) {
          this.pathsCache = data[pathLength];
          return data[pathLength];
        }
      }
    } catch (error: any) {
      console.error(`❌ Ошибка загрузки путей: ${error.message}`);
    }
    return null;
  }

  // ========== ПРИБЫЛЬНЫЕ МАРШРУТЫ ==========
  saveProfitableRoutes(routes: ProfitableRoute[]): void {
    try {
      let profitable: ProfitableRoute[] = [];
      if (fs.existsSync(this.profitablePath)) {
        profitable = JSON.parse(fs.readFileSync(this.profitablePath, 'utf-8'));
      }

      for (const route of routes) {
        const existingIndex = profitable.findIndex(r => r.id === route.id);

        if (existingIndex !== -1) {
          const existing = profitable[existingIndex];
          existing.lastSeen = route.detectedAt;
          existing.timesSeen++;
          existing.profitPercent = route.profitPercent;
          existing.profitAmount = route.profitAmount;
          existing.tokensInfo = route.tokensInfo;  // Обновляем токены

          const newAvg = (existing.avgProfit * (existing.timesSeen - 1) + route.profitPercent) / existing.timesSeen;
          existing.avgProfit = newAvg;
          existing.minProfit = Math.min(existing.minProfit, route.profitPercent);
          existing.maxProfit = Math.max(existing.maxProfit, route.profitPercent);

          profitable[existingIndex] = existing;
        } else {
          profitable.push({
            ...route,
            timesSeen: 1,
            avgProfit: route.profitPercent,
            minProfit: route.profitPercent,
            maxProfit: route.profitPercent,
          });
        }
      }

      profitable.sort((a, b) => b.profitPercent - a.profitPercent);
      fs.writeFileSync(this.profitablePath, JSON.stringify(profitable, null, 2));
      console.log(`💾 Сохранено ${routes.length} прибыльных маршрутов`);
    } catch (error: any) {
      console.error(`❌ Ошибка сохранения маршрутов: ${error.message}`);
    }
  }

  loadProfitableRoutes(): ProfitableRoute[] {
    try {
      if (fs.existsSync(this.profitablePath)) {
        return JSON.parse(fs.readFileSync(this.profitablePath, 'utf-8'));
      }
    } catch (error: any) {
      console.error(`❌ Ошибка загрузки прибыльных маршрутов: ${error.message}`);
    }
    return [];
  }

  // ========== СТАТИСТИКА ==========

  getStats(): { tokensCount: number; pathsCount: number; profitableCount: number; lastUpdate: string } {
    let tokensCount = 0;
    let pathsCount = 0;
    let profitableCount = 0;
    let lastUpdate = 'никогда';

    try {
      const tokens = this.loadTokens();
      if (tokens) {
        tokensCount = tokens.liquidTokens?.length || 0;
        lastUpdate = new Date(tokens.timestamp).toLocaleString();
      }

      if (fs.existsSync(this.pathsPath)) {
        const data = JSON.parse(fs.readFileSync(this.pathsPath, 'utf-8'));
        for (const key of Object.keys(data)) {
          if (data[key]?.paths) {
            pathsCount += data[key].paths.length;
          }
        }
      }

      const profitable = this.loadProfitableRoutes();
      profitableCount = profitable.length;

    } catch (error: any) {
      console.error(`❌ Ошибка получения статистики: ${error.message}`);
    }

    return { tokensCount, pathsCount, profitableCount, lastUpdate };
  }

  clearCache(): void {
    try {
      if (fs.existsSync(this.tokensPath)) fs.unlinkSync(this.tokensPath);
      if (fs.existsSync(this.pathsPath)) fs.unlinkSync(this.pathsPath);
      if (fs.existsSync(this.profitablePath)) fs.unlinkSync(this.profitablePath);
      console.log('🗑️ Кэш очищен');
    } catch (error: any) {
      console.error(`❌ Ошибка очистки кэша: ${error.message}`);
    }
  }
}

export const fileStorage = new FileStorage();