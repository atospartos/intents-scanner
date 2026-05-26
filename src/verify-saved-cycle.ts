import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GraphManager } from './services/GraphManager';
import { RouteVerifier } from './services/RouteVerifier';
import { RateLimitedQueue } from './services/RateLimitedQueue';
import { Token } from './clients/nearIntentsClient';

async function verifySavedCycle() {
  const filePath = path.join(process.cwd(), 'storage', 'best_cycle.json');
  if (!fs.existsSync(filePath)) {
    console.log('Нет сохранённого маршрута. Сначала запустите npm run cycle-scan');
    return;
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const fullPathAssetIds = data.fullPathTokens; // массив assetId

  const graphManager = new GraphManager();
  await graphManager.init();

  // Восстанавливаем объекты Token по assetId
  const allTokens = graphManager.getTokens();
  const tokenMap = new Map(allTokens.map(t => [t.assetId, t]));
  const fullPath = fullPathAssetIds.map(id => tokenMap.get(id)).filter(t => t !== undefined) as Token[];
  if (fullPath.length !== fullPathAssetIds.length) {
    console.error('Некоторые токены не найдены в графе');
    return;
  }

  const queue = new RateLimitedQueue();
  const verifier = new RouteVerifier(graphManager, queue);
  const verified = await verifier.verifyPath(fullPath);
  if (verified) {
    console.log(`✅ Подтверждённая прибыль: ${verified.profitPercent.toFixed(4)}%`);
    console.log(`   Путь: ${verified.pathStr}`);
  } else {
    console.log('❌ Маршрут не прибыльный по реальным квотам');
  }
}

verifySavedCycle().catch(console.error);