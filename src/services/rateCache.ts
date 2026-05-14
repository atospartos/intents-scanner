import { Token, nearIntentsClient } from '../clients/nearIntentsClient';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

export class RateCache {
  private cache = new Map<string, number>(); // key = `${fromAssetId}|${toAssetId}`
  private lastUpdate = 0;
  private cachePath: string;

  constructor() {
    this.cachePath = path.join(process.cwd(), 'storage', 'rate_cache.json');
    this.load();
  }

  async ensureFresh(allTokens: Token[], testAmountUSD: number): Promise<void> {
    if (Date.now() - this.lastUpdate < config.scan.rateCacheTTL && this.cache.size > 0) {
      console.log(`📦 Используем кэш коэффициентов (${this.cache.size} записей)`);
      return;
    }
    await this.build(allTokens, testAmountUSD);
  }

  private async build(tokens: Token[], testAmountUSD: number): Promise<void> {
    console.log(`🚀 Строим кэш для ${tokens.length} токенов (всего пар ${tokens.length * (tokens.length - 1)})...`);
    const start = Date.now();

    const pairs: { from: Token; to: Token }[] = [];
    for (const from of tokens) {
      for (const to of tokens) {
        if (from.assetId === to.assetId) continue;
        pairs.push({ from, to });
      }
    }

    const concurrency = 10;
    const results: { key: string; rate: number }[] = [];
    const queue = [...pairs];
    let completed = 0;

    const worker = async () => {
      while (queue.length) {
        const { from, to } = queue.shift()!;
        try {
          const amountIn = this.amountToSend(testAmountUSD, parseFloat(from.price), from.decimals);
          const quote = await nearIntentsClient.getQuote({
            originAsset: from.assetId,
            destinationAsset: to.assetId,
            amount: amountIn,
            depositType: 'INTENTS',
            recipientType: 'INTENTS',
            recipient: this.getAddress(),
            refundTo: this.getAddress(),
            dry: true,
          });
          if (quote.quote?.amountOutUsd) {
            const outUsd = parseFloat(quote.quote.amountOutUsd);
            const rate = outUsd / testAmountUSD;
            results.push({ key: `${from.assetId}|${to.assetId}`, rate });
          }
        } catch (err) { /* пропускаем пары без ликвидности */ }
        completed++;
        if (completed % 500 === 0) console.log(`   Прогресс пар: ${completed}/${pairs.length}`);
      }
    };

    const workers = Array(concurrency).fill(null).map(() => worker());
    await Promise.all(workers);

    this.cache.clear();
    for (const { key, rate } of results) this.cache.set(key, rate);
    this.lastUpdate = Date.now();
    this.save();
    console.log(`✅ Кэш построен за ${(Date.now() - start) / 1000} сек. Записей: ${this.cache.size}`);
  }

  getRate(fromAssetId: string, toAssetId: string): number | undefined {
    return this.cache.get(`${fromAssetId}|${toAssetId}`);
  }

  private amountToSend(usd: number, price: number, decimals: number): string {
    return Math.floor((usd / price) * 10 ** decimals).toString();
  }

  private getAddress(): string {
    return config.addresses.near;
  }

  private save() {
    const data = { timestamp: this.lastUpdate, entries: Object.fromEntries(this.cache) };
    fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
  }

  private load() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const { timestamp, entries } = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        this.cache = new Map(Object.entries(entries));
        this.lastUpdate = timestamp;
        console.log(`📂 Загружен кэш из файла (${this.cache.size} записей)`);
      }
    } catch (e) { /* ignore */ }
  }
}