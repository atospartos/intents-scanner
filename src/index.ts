import { tokenManager } from './services/tokenManager';
import { pathGenerator } from './services/pathGenerator';
import { parallelScanner } from './services/parallelScanner';
import { config } from './config';
import { logger } from './utils/logger';
import { fileStorage } from './services/fileStorage';

let isScanning = false;
let isFirstRun = true;
let timeoutId: NodeJS.Timeout | null = null;

async function scanCycle() {
  if (isScanning) {
    logger.info('⏳ Предыдущий цикл ещё выполняется, пропускаем...');
    // Планируем следующий цикл через интервал
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      scanCycle().catch(error => {
        logger.error(`❌ Ошибка в цикле: ${error.message}`);
      });
    }, config.scan.intervalSec * 1000);
    return;
  }
  
  isScanning = true;
  const startTime = Date.now();
  
  logger.info('\n' + '='.repeat(60));
  logger.info('🔄 НАЧАЛО ЦИКЛА СКАНИРОВАНИЯ');
  logger.info('='.repeat(60));
  
  try {
    const { stablecoins, workingTokens } = await tokenManager.getAllTradingTokens();
    
    if (stablecoins.length === 0 || workingTokens.length === 0) {
      logger.error('❌ Недостаточно токенов');
      return;
    }
    
    logger.info(`💎 Стейблкоины: ${stablecoins.map(s => s.symbol).join(', ')}`);
    logger.info(`📊 Рабочие токены: ${workingTokens.map(t => t.symbol).join(', ')}`);
    
    // СКАНИРУЕМ ПУТИ ДЛИНЫ 4
    const pathLength = 4;
    let pathsToScan: any[] = [];
    
    // Пробуем загрузить из файла
    const loadedPaths = pathGenerator.loadPathsFromFile(stablecoins, workingTokens, pathLength);
    
    if (loadedPaths && loadedPaths.length > 0) {
      pathsToScan = loadedPaths;
      logger.info(`📂 Используем сохранённые пути длины ${pathLength} (${pathsToScan.length} путей)`);
    } else {
      logger.info(`🔍 Генерируем новые пути длины ${pathLength}...`);
      pathsToScan = pathGenerator.generateAndSavePaths(stablecoins, workingTokens, pathLength);
    }
    
    logger.info(`🔍 Сканируем ${pathsToScan.length} путей длины ${pathLength}...`);
    
    // Включаем тихий режим после первого цикла
    if (!isFirstRun) {
      parallelScanner.setSilentMode(true);
    }
    
    const results = await parallelScanner.scanPaths(pathsToScan, config.trading.testAmountUSD);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    
    // Подсчитываем прибыльные пути
    const profitable = results.filter(r => r.success && r.profitPercent >= config.scan.minProfitPercent);
    
    logger.info(`⏱️ Цикл завершён за ${elapsed} секунд`);
    logger.info(`💰 Найдено прибыльных путей в этом цикле: ${profitable.length}`);
    
    // Показываем сохранённые прибыльные маршруты (только в первом цикле)
    const profitableRoutes = fileStorage.loadProfitableRoutes();
    if (profitableRoutes.length > 0 && isFirstRun) {
      console.log('\n🏆 СОХРАНЁННЫЕ ПРИБЫЛЬНЫЕ МАРШРУТЫ:');
      profitableRoutes.slice(0, 10).forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.path.join(' → ')}: ср.${r.avgProfit.toFixed(4)}% (найден ${r.timesSeen} раз)`);
      });
    }
    
    logger.info(`📁 Всего сохранено прибыльных маршрутов: ${profitableRoutes.length}`);
    
    if (isFirstRun) {
      logger.info(`\n⏱️ Первый цикл завершён. Следующий через ${config.scan.intervalSec} сек...\n`);
      isFirstRun = false;
    }
    
  } catch (error: any) {
    logger.error(`❌ Ошибка: ${error.message}`);
  }
  
  logger.info('='.repeat(60) + '\n');
  isScanning = false;
  
  // Планируем следующий цикл
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = setTimeout(() => {
    scanCycle().catch(error => {
      logger.error(`❌ Ошибка в следующем цикле: ${error.message}`);
    });
  }, config.scan.intervalSec * 1000);
}

async function main() {
  console.log('\n🤖 NEAR ARBITRAGE BOT\n');
  console.log(`💰 Режим: ${config.dryRunOnly ? 'DRY-RUN' : 'РЕАЛЬНЫЙ'}`);
  console.log(`⏱️ Интервал: ${config.scan.intervalSec} сек`);
  console.log(`🎯 Мин. прибыль: ${config.scan.minProfitPercent}%`);
  
  const stats = fileStorage.getStats();
  console.log(`📁 Кэш: ${stats.tokensCount} токенов, ${stats.pathsCount} путей, ${stats.profitableCount} прибыльных`);
  console.log(`📅 Последнее обновление: ${stats.lastUpdate}\n`);
  
  // Запускаем первый цикл
  await scanCycle();
}

main().catch(error => {
  logger.error(`❌ Критическая ошибка: ${error.message}`);
  process.exit(1);
});