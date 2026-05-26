// debug-route.ts
import 'dotenv/config';
import { nearIntentsClient, Token } from './clients/nearIntentsClient.js';
// import { getTokenById } from './src/intents/get-tokens-list.js';
import { parseUnits, formatUnits } from 'viem';

// Вставьте сюда полный маршрут из storage/profitable_cycles.json (один объект)
const testRoute = {
  "id": "USDT→USDT→USDT",
  "pathStr": "USDT(pol) → USDT(bsc) → USDT(pol)",
  "profitPercent": 0.41078937754841505,
  "testAmountUSD": 100,
  "tokensInfo": [
    {
      "symbol": "USDC",
      "assetId": "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr",
      "blockchain": "pol",
      "decimals": 7
    },
    {
      "symbol": "AAVE",
      "assetId": "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g",
      "blockchain": "bsc",
      "decimals": 18
    },
    {
      "symbol": "USDC",
      "assetId": "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr",
      "blockchain": "pol",
      "decimals": 7
    }
  ]
};

async function debugRoute() {
  console.log('🔍 Starting debug for route:', testRoute.pathStr);
  const dummyAddress = 'b817fd571bfb3272bafc2961f92c947d7ed63a4f23758ee23d00d60190440b4b';

  const fullTokens: any = [];
  for (const info of testRoute.tokensInfo) {
    fullTokens.push(info);
  }

  let currentAmount = parseUnits(testRoute.testAmountUSD.toString(), fullTokens[0].decimals);
  console.log(`💰 Start amount: ${formatUnits(currentAmount, fullTokens[0].decimals)} ${fullTokens[0].symbol} (USD: ${testRoute.testAmountUSD})`);

  for (let i = 0; i < testRoute.tokensInfo.length; i++) {
    const from = fullTokens[i];
    const to = fullTokens[(i + 1) % fullTokens.length];
    console.log(`\n🔄 Step ${i + 1}/${testRoute.tokensInfo.length}: ${from.symbol} (${from.assetId}) -> ${to.symbol} (${to.assetId})`);
    console.log(`   Amount in: ${formatUnits(currentAmount, from.decimals)} ${from.symbol}`);

    try {
      const start = Date.now();
      const quote = await nearIntentsClient.getQuote({
        originAsset: from.assetId,
        destinationAsset: to.assetId,
        amount: currentAmount.toString(),
        dry: true,
        quoteWaitingTimeMs: 3000,
      });
      const duration = Date.now() - start;
      console.log(`   ⏱️  Quote received in ${duration}ms`);
      if (quote.quote?.amountOut) {
        currentAmount = BigInt(quote.quote.amountOut);
        console.log(`   ✅ Amount out: ${formatUnits(currentAmount, to.decimals)} ${to.symbol} (USD: ${quote.quote.amountOutUsd})`);
      } else {
        console.error(`   ❌ No amountOut in response:`, quote);
        return;
      }
    } catch (err) {
      console.error(`   ❌ Error: ${err}`);
      if (err) console.error('   API response:', err);
      return;
    }
  }
  const finalAmount = parseFloat(formatUnits(currentAmount, fullTokens[0].decimals));
  const finalUSD = finalAmount * fullTokens[0].price;
  const profitPercent = ((finalUSD - testRoute.testAmountUSD) / testRoute.testAmountUSD) * 100;
  console.log(`\n📊 Final amount: ${finalAmount} ${fullTokens[0].symbol} (USD: ${finalUSD.toFixed(2)})`);
  console.log(`💰 Profit: ${profitPercent.toFixed(4)}%`);
}

debugRoute().catch(console.error);