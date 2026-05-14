// src/executor.ts
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getSwapQuote, submitSwap } from './intents/swap-tokens-near.js';
import { getTokenBalances } from './intents/get-balances.js';
import { getNearIntentsSigner } from './intents/utils/near-config.js';
import { getTokenById } from './intents/get-tokens-list.js';
import { parseUnits, formatUnits } from 'viem';

// ==================== ЛОГГЕР ====================
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `executor-${new Date().toISOString().replace(/:/g, '-')}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(message: string, level: 'INFO' | 'ERROR' | 'WARN' | 'DEBUG' = 'INFO') {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level}] ${message}`;
  console.log(formatted);
  logStream.write(formatted + '\n');
}

// ==================== КОНФИГ ====================
const STORAGE_FILE = './storage/profitable_routes.json';
const PROFIT_TOLERANCE = parseFloat(process.env.PROFIT_TOLERANCE || '0.8');    // 80%
const LOOP_INTERVAL_MS = parseInt(process.env.LOOP_INTERVAL_MS || '15000', 10);
const DRY_RUN = process.env.DRY_RUN_ONLY === 'true' || process.argv.includes('--dry-run');

const EXECUTION_OPTIONS = {
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '5000', 10),
  balanceWaitMs: parseInt(process.env.BALANCE_WAIT_MS || '8000', 10),
};

log(`🚀 Executor started (DRY_RUN=${DRY_RUN})`);
log(`Config: loop=${LOOP_INTERVAL_MS}ms, tolerance=${PROFIT_TOLERANCE}, retries=${EXECUTION_OPTIONS.maxRetries}`);

// ==================== ТИПЫ ====================
interface StoredTokenInfo {
  symbol: string;
  assetId: string;
  blockchain: string;
  decimals: number;
}

interface ScannedRoute {
  id: string;
  pathStr: string;
  profitPercent: number;
  testAmountUSD: number;
  tokensInfo: StoredTokenInfo[];
}

// ==================== ФУНКЦИИ ====================
async function recheckRoute(route: ScannedRoute): Promise<number | null> {
  const { tokensInfo, testAmountUSD } = route;
  const fullTokens = [];
  for (const info of tokensInfo) {
    const token = await getTokenById({ intents_token_id: info.assetId });
    if (!token) {
      log(`Token not found: ${info.assetId}`, 'WARN');
      return null;
    }
    fullTokens.push(token);
  }
  const firstToken = fullTokens[0];
  let currentAmount = parseUnits(testAmountUSD.toString(), firstToken.decimals);
  for (let i = 0; i < tokensInfo.length; i++) {
    const from = fullTokens[i];
    const to = fullTokens[(i + 1) % tokensInfo.length];
    const quote = await getSwapQuote({
      originAsset: from,
      destinationAsset: to,
      amountIn: currentAmount.toString(),
    });
    if (!quote.quote?.amountOut) {
      log(`No quote for ${from.symbol}->${to.symbol}`, 'WARN');
      return null;
    }
    currentAmount = BigInt(quote.quote.amountOut);
  }
  const finalAmount = parseFloat(formatUnits(currentAmount, firstToken.decimals));
  const finalUSD = finalAmount * firstToken.price;
  return ((finalUSD - testAmountUSD) / testAmountUSD) * 100;
}

async function executeRoute(route: ScannedRoute): Promise<boolean> {
  const { tokensInfo, testAmountUSD } = route;
  log(`Executing route: ${route.pathStr}, expected profit ${route.profitPercent.toFixed(4)}%`);

  if (DRY_RUN) {
    log(`⚠️ DRY RUN: skipping actual swap`, 'WARN');
    return true;
  }

  const signer = await getNearIntentsSigner();
  const { walletClient, authIdentifier, authMethod } = signer;
  log(`Signer ready: ${authIdentifier}`);

  const fullTokens = [];
  for (const info of tokensInfo) {
    const token = await getTokenById({ intents_token_id: info.assetId });
    if (!token) throw new Error(`Token ${info.assetId} not found`);
    fullTokens.push(token);
  }

  const firstToken = fullTokens[0];
  let currentAmount = parseUnits(testAmountUSD.toString(), firstToken.decimals);

  for (let stepIdx = 0; stepIdx < tokensInfo.length; stepIdx++) {
    const from = fullTokens[stepIdx];
    const to = fullTokens[(stepIdx + 1) % tokensInfo.length];
    log(`Step ${stepIdx+1}/${tokensInfo.length}: ${from.symbol} -> ${to.symbol}`, 'INFO');

    let success = false;
    for (let attempt = 1; attempt <= EXECUTION_OPTIONS.maxRetries; attempt++) {
      try {
        // Check balance
        const balances = await getTokenBalances({ authIdentifier, authMethod });
        const fromBalance = balances.find(b => b.assetId === from.assetId);
        const required = formatUnits(currentAmount, from.decimals);
        if (!fromBalance || parseFloat(fromBalance.balanceFormatted) < parseFloat(required)) {
          throw new Error(`Insufficient ${from.symbol}: need ${required}, have ${fromBalance?.balanceFormatted || '0'}`);
        }
        log(`Balance OK: ${fromBalance.balanceFormatted} ${from.symbol}`);

        // Get quote
        const quote = await getSwapQuote({
          originAsset: from,
          destinationAsset: to,
          amountIn: currentAmount.toString(),
        });
        if (!quote.quote?.amountOut) throw new Error('Empty quote');
        log(`Quote: ${formatUnits(BigInt(quote.quote.amountIn), from.decimals)} ${from.symbol} -> ${formatUnits(BigInt(quote.quote.amountOut), to.decimals)} ${to.symbol}`);

        // Execute swap
        const result = await submitSwap({
          quote,
          account: walletClient.account,
          authIdentifier,
          authMethod,
        });
        log(`Swap submitted, tx: ${result.txHash}`);

        // Wait for balance update
        await new Promise(r => setTimeout(r, EXECUTION_OPTIONS.balanceWaitMs));
        const newBalances = await getTokenBalances({ authIdentifier, authMethod });
        const toBalance = newBalances.find(b => b.assetId === to.assetId);
        if (!toBalance || BigInt(toBalance.balance) === 0n) throw new Error('Target balance still zero');
        currentAmount = BigInt(toBalance.balance);
        log(`New balance: ${formatUnits(currentAmount, to.decimals)} ${to.symbol}`);
        success = true;
        break;
      } catch (err) {
        log(`Attempt ${attempt} failed: ${err.message}`, 'ERROR');
        if (attempt < EXECUTION_OPTIONS.maxRetries) {
          log(`Retrying in ${EXECUTION_OPTIONS.retryDelayMs}ms...`, 'WARN');
          await new Promise(r => setTimeout(r, EXECUTION_OPTIONS.retryDelayMs));
        }
      }
    }
    if (!success) {
      log(`Step ${stepIdx+1} failed, aborting route`, 'ERROR');
      return false;
    }
  }
  log(`Route executed successfully!`, 'INFO');
  return true;
}

// ==================== MAIN LOOP ====================
let shutdown = false;
process.on('SIGINT', () => { log('Received SIGINT, shutting down...', 'WARN'); shutdown = true; });
process.on('SIGTERM', () => { log('Received SIGTERM, shutting down...', 'WARN'); shutdown = true; });

async function main() {
  log('Executor main loop started');
  while (!shutdown) {
    try {
      if (!fs.existsSync(STORAGE_FILE)) {
        log(`Storage file not found: ${STORAGE_FILE}, waiting...`, 'DEBUG');
        await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
        continue;
      }
      const content = fs.readFileSync(STORAGE_FILE, 'utf-8').trim();
      if (!content) {
        log('Storage file empty, waiting...', 'DEBUG');
        await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
        continue;
      }
      const routes: ScannedRoute[] = JSON.parse(content);
      if (routes.length === 0) {
        log('No profitable routes in file, waiting...', 'DEBUG');
        await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
        continue;
      }
      const best = routes.sort((a,b) => b.profitPercent - a.profitPercent)[0];
      log(`Best route: ${best.pathStr} (profit ${best.profitPercent.toFixed(4)}%)`);

      // Re-check fresh profit
      const freshProfit = await recheckRoute(best);
      if (freshProfit === null) {
        log(`Recheck failed, removing route`, 'WARN');
        const remaining = routes.filter(r => r.id !== best.id);
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(remaining, null, 2));
        continue;
      }
      log(`Fresh profit: ${freshProfit.toFixed(4)}% (threshold: ${(best.profitPercent * PROFIT_TOLERANCE).toFixed(4)}%)`);
      if (freshProfit < best.profitPercent * PROFIT_TOLERANCE) {
        log(`Profit too low, skipping`, 'WARN');
        // Optionally keep route for next cycles?
        await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
        continue;
      }

      // Execute
      const success = await executeRoute(best);
      if (success) {
        // Remove executed route
        const remaining = routes.filter(r => r.id !== best.id);
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(remaining, null, 2));
        log(`Route executed and removed from file`);
      } else {
        log(`Execution failed, keeping route for later retry`);
      }
      await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
    } catch (err) {
      log(`Loop error: ${err.stack || err.message}`, 'ERROR');
      await new Promise(r => setTimeout(r, LOOP_INTERVAL_MS));
    }
  }
  log('Executor stopped');
  logStream.end();
}

main().catch(err => {
  log(`Fatal: ${err.stack || err.message}`, 'ERROR');
  process.exit(1);
});