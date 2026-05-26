import 'dotenv/config';
import { GraphManager } from './services/GraphManager';
import { RouteVerifier } from './services/RouteVerifier';
import { RouteGenerator } from './services/RouteGenerator';
import { RateLimitedQueue } from './services/RateLimitedQueue';
import { config } from './config';

async function main() {
  console.log('🚀 Starting real-time arbitrage scanner (continuous loop)...');
  const queue = new RateLimitedQueue();
  const graphManager = new GraphManager();
  await graphManager.init();
  console.log(`✅ Graph ready. Edges: ${graphManager.getEdgesCount()}`);

  const verifier = new RouteVerifier(graphManager, queue);
  const generator = new RouteGenerator(graphManager);

  let iteration = 0;

  iteration++;
  console.log(`\n🔍 Iteration ${iteration}: Searching for cycles...`);
  const cycles: { path: any[] }[] = [];
  await generator.findAndEmitCycles(async (cycle) => {
    cycles.push(cycle);
  });
  console.log(`Found ${cycles.length} potential cycles. Verifying up to 5...`);
  let verified = 0;
  for (const cycle of cycles.slice(0, 5)) {
    const profitable = await verifier.verifyPath(cycle.path);
    if (profitable) verified++;
    console.log(`Verified ${verified} profitable routes.`);
  }
  console.log(`Verified ${verified} profitable routes.`);
}


main().catch(console.error);