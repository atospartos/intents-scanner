import fs from 'fs';
import path from 'path';

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
  profitPercent: number;
  testAmountUSD: number;
  tokensInfo: Array<{
    symbol: string;
    assetId: string;
    blockchain: string;
    decimals: number;
  }>;
}

export class FileStorage {
  private storageDir: string;
  private cyclesPath: string;

  constructor() {
    this.storageDir = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.cyclesPath = path.join(this.storageDir, 'profitable_cycles.json');
    // Инициализируем пустым массивом, только если файл отсутствует
    if (!fs.existsSync(this.cyclesPath)) {
      fs.writeFileSync(this.cyclesPath, JSON.stringify([]));
    }
  }

  saveProfitableCycle(route: ScannedRoute): void {
    const tempPath = this.cyclesPath + '.tmp';
    try {
      // Читаем текущий массив (если файл повреждён, делаем бэкап и начинаем новый)
      let routes: ScannedRoute[] = [];
      if (fs.existsSync(this.cyclesPath)) {
        const content = fs.readFileSync(this.cyclesPath, 'utf-8');
        if (content.trim()) {
          try {
            routes = JSON.parse(content);
            if (!Array.isArray(routes)) routes = [];
          } catch (parseErr) {
            // Повреждённый JSON: бэкапим и начинаем заново
            const backup = this.cyclesPath + '.broken.' + Date.now();
            fs.copyFileSync(this.cyclesPath, backup);
            console.error(`⚠️ Повреждённый файл ${this.cyclesPath} скопирован в ${backup}. Начинаем новый массив.`);
            routes = [];
          }
        }
      }
      // Добавляем новый маршрут (можно проверить на уникальность по id, если нужно)
      // Удаляем старый маршрут с таким же id, чтобы обновить
      const existingIndex = routes.findIndex(r => r.id === route.id);
      if (existingIndex !== -1) {
        routes[existingIndex] = route; // обновляем
      } else {
        routes.push(route);
      }
      // Пишем во временный файл
      fs.writeFileSync(tempPath, JSON.stringify(routes, null, 2));
      // Атомарно заменяем основной файл
      fs.renameSync(tempPath, this.cyclesPath);
    } catch (error) {
      console.error(`Ошибка при сохранении маршрута в ${this.cyclesPath}:`, error);
      // Если временный файл остался, удаляем его
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  // Дополнительный метод для чтения всех маршрутов (если понадобится)
  getAllRoutes(): ScannedRoute[] {
    try {
      if (fs.existsSync(this.cyclesPath)) {
        const content = fs.readFileSync(this.cyclesPath, 'utf-8');
        if (content.trim()) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (e) {
      console.error('Ошибка чтения маршрутов:', e);
    }
    return [];
  }
}

export const fileStorage = new FileStorage();