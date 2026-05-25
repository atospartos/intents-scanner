// debug-graph.ts
import 'dotenv/config';
import { GraphManager } from './services/GraphManager';
import { RateLimitedQueue } from './services/RateLimitedQueue';

async function main() {
  const queue = new RateLimitedQueue();
  const graphManager = new GraphManager(queue);
  await graphManager.init();
  
  const tokens = graphManager.getTokens();
  const stables = tokens.filter(t => ['USDC','USDT','DAI'].includes(t.symbol));
  console.log(`Stables: ${stables.map(s => `${s.symbol}(${s.blockchain})`).join(', ')}`);
  
  for (const stable of stables) {
    const outgoing = graphManager.getNeighbors(stable.assetId);
    console.log(`\nFrom ${stable.symbol} (${stable.blockchain}) -> ${outgoing.length} neighbors`);
    for (const neighbor of outgoing.slice(0, 5)) { // первые 5
      const backRate = graphManager.getRate(neighbor.assetId, stable.assetId);
      if (backRate) {
        const forwardRate = graphManager.getRate(stable.assetId, neighbor.assetId);
        console.log(`  -> ${neighbor.symbol}(${neighbor.blockchain}) : forward=${forwardRate?.toFixed(6)}, back=${backRate.toFixed(6)}, profit=${((forwardRate! * backRate) - 1)*100}%`);
      } else {
        console.log(`  -> ${neighbor.symbol}(${neighbor.blockchain}) (no back edge)`);
      }
    }
  }
}
main();