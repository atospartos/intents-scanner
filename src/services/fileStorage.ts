import fs from 'fs';
import path from 'path';

export interface StoredTokenInfo {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
}

export interface ScannedRoute {
  id: string;
  pathStr: string;
  profitPercent: number;
  testAmountUSD: number;
  tokensInfo: StoredTokenInfo[];
}

export class FileStorage {
  private cyclesPath: string;

  constructor() {
    const dir = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.cyclesPath = path.join(dir, 'profitable_cycles.json');
    if (!fs.existsSync(this.cyclesPath)) fs.writeFileSync(this.cyclesPath, JSON.stringify([]));
  }

  saveProfitableCycle(route: ScannedRoute): void {
    let existing: ScannedRoute[] = [];
    try {
      const content = fs.readFileSync(this.cyclesPath, 'utf-8');
      if (content.trim()) existing = JSON.parse(content);
    } catch (e) {}
    const exists = existing.some(r => r.id === route.id);
    if (!exists) {
      existing.push(route);
      fs.writeFileSync(this.cyclesPath, JSON.stringify(existing, null, 2));
    }
  }
}

export const fileStorage = new FileStorage();