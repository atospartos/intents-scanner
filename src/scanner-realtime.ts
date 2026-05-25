// scanner-realtime.ts
import 'dotenv/config';
import { GraphManager } from './services/GraphManager';
import { RouteVerifier } from './services/RouteVerifier';
import { RouteGenerator } from './services/RouteGenerator';
import { RateLimitedQueue } from './services/RateLimitedQueue';
import { config } from './config';

async function main() {
  console.log('🚀 Starting real-time arbitrage scanner...');
  const queue = new RateLimitedQueue();
  const graphManager = new GraphManager(queue);
  await graphManager.init();
  console.log(`✅ Graph ready. Edges: ${graphManager.getEdgesCount()}`);

  const verifier = new RouteVerifier(graphManager, queue);
  const generator = new RouteGenerator(graphManager);

  // Запуск периодической генерации и верификации маршрутов
  setInterval(async () => {
    console.log('\n🔍 Scanning for new cycles...');
    await generator.findAndEmitCycles(async (cycle) => {
      const profitable = await verifier.verifyRoute(cycle);
      if (profitable) {
        console.log(`✅ Saved profitable route: ${profitable.pathStr}`);
      }
    });
  }, 30000); // каждые 30 секунд

  process.on('SIGINT', () => {
    console.log('Shutting down...');
    graphManager.stop();
    process.exit(0);
  });
}

main().catch(console.error);