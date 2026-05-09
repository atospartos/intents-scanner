import fs from 'fs';
import path from 'path';

export interface StoredTokenInfo {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
}

export interface CycleResult {
  id: string;
  path: string[];
  profitPercent: number;
  timestamp: number;
  steps: number;
}

export interface ScannedRoute {
  id: string;
  pathStr: string;
  steps: string[];
  profitPercent: number;
  profitAmount: number;
  testAmountUSD: number;
  timestamp: number;
  usdIn: number;
  usdOut: number;
  tokensInfo: StoredTokenInfo[];
  isProfitable: boolean;
}

export class FileStorage {
  private storageDir: string;
  private profitablePath: string;
  private nonProfitablePath: string;
  private cyclesPath: string;

  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.profitablePath = path.join(this.storageDir, 'profitable_routes.json');
    this.nonProfitablePath = path.join(this.storageDir, 'nonprofitable_routes.json');
    if (!fs.existsSync(this.profitablePath)) {
      fs.writeFileSync(this.profitablePath, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(this.nonProfitablePath)) {
      fs.writeFileSync(this.nonProfitablePath, JSON.stringify([], null, 2));
    }
    this.cyclesPath = path.join(this.storageDir, 'profitable_cycles.json');
    if (!fs.existsSync(this.cyclesPath)) fs.writeFileSync(this.cyclesPath, JSON.stringify([]));
  }

  saveProfitableRoute(route: ScannedRoute): void {
    this.appendToFile(this.profitablePath, route);
  }

  saveNonProfitableRoute(route: ScannedRoute): void {
    this.appendToFile(this.nonProfitablePath, route);
  }

  saveCycle(cycle: CycleResult) {
    this.appendToFile(this.cyclesPath, cycle);
  }

  private appendToFile(filePath: string, route): void {
    try {
      let existing: ScannedRoute[] = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        existing = JSON.parse(content);
      }
      existing.push(route);
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    } catch (error) {
      console.error(`Ошибка записи в ${filePath}:`, error);
    }
  }
}

export const fileStorage = new FileStorage();