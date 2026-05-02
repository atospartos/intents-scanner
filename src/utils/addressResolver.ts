export type Blockchain = 
  | 'near'
  | 'eth'
  | 'base'
  | 'arb'
  | 'btc'
  | 'sol'
  | 'ton'
  | 'dash'
  | 'doge'
  | 'xrp'
  | 'zec'
  | 'gnosis'
  | 'bera'
  | 'bsc'
  | 'pol'
  | 'tron'
  | 'sui'
  | 'op'
  | 'avax'
  | 'cardano'
  | 'ltc'
  | 'xlayer'
  | 'monad'
  | 'bch'
  | 'adi'
  | 'plasma'
  | 'scroll'
  | 'starknet'
  | 'aleo';

export interface BlockchainAddresses {
  recipient: string;
  refundTo: string;
}

export class AddressResolver {
  private static addresses: Record<Blockchain, BlockchainAddresses> = {
    near: { recipient: process.env.NEAR_ADDRESS || '', refundTo: process.env.NEAR_ADDRESS || '' },
    eth: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    base: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    arb: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    gnosis: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    bera: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    bsc: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    pol: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    op: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    avax: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    xlayer: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    monad: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    scroll: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    adi: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    plasma: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    starknet: { recipient: process.env.EVM_ADDRESS || '', refundTo: process.env.EVM_ADDRESS || '' },
    
    btc: { recipient: process.env.BTC_ADDRESS || '', refundTo: process.env.BTC_ADDRESS || '' },
    dash: { recipient: process.env.DASH_ADDRESS || '', refundTo: process.env.DASH_ADDRESS || '' },
    ltc: { recipient: process.env.LTC_ADDRESS || '', refundTo: process.env.LTC_ADDRESS || '' },
    bch: { recipient: process.env.BCH_ADDRESS || '', refundTo: process.env.BCH_ADDRESS || '' },
    zec: { recipient: process.env.ZEC_ADDRESS || '', refundTo: process.env.ZEC_ADDRESS || '' },
    
    sol: { recipient: process.env.SOL_ADDRESS || '', refundTo: process.env.SOL_ADDRESS || '' },
    sui: { recipient: process.env.SUI_ADDRESS || '', refundTo: process.env.SUI_ADDRESS || '' },
    
    xrp: { recipient: process.env.XRP_ADDRESS || '', refundTo: process.env.XRP_ADDRESS || '' },
    cardano: { recipient: process.env.ADA_ADDRESS || '', refundTo: process.env.ADA_ADDRESS || '' },
    
    ton: { recipient: process.env.TON_ADDRESS || '', refundTo: process.env.TON_ADDRESS || '' },
    tron: { recipient: process.env.TRON_ADDRESS || '', refundTo: process.env.TRON_ADDRESS || '' },
    doge: { recipient: process.env.DOGE_ADDRESS || '', refundTo: process.env.DOGE_ADDRESS || '' },
    aleo: { recipient: process.env.ALEO_ADDRESS || '', refundTo: process.env.ALEO_ADDRESS || '' },
  };

  static getRecipient(blockchain: Blockchain): string {
    const addr = this.addresses[blockchain]?.recipient;
    if (!addr || addr === '') {
      throw new Error(`❌ Нет настроенного адреса для блокчейна: ${blockchain}`);
    }
    return addr;
  }

  static getRefundTo(blockchain: Blockchain): string {
    const addr = this.addresses[blockchain]?.refundTo;
    if (!addr || addr === '') {
      throw new Error(`❌ Нет настроенного адреса возврата для блокчейна: ${blockchain}`);
    }
    return addr;
  }

  static getBlockchainFromAssetId(assetId: string): Blockchain {
    const map: Record<string, Blockchain> = {
      'near': 'near',
      'eth': 'eth',
      'base': 'base',
      'arb': 'arb',
      'btc': 'btc',
      'sol': 'sol',
      'ton': 'ton',
      'dash': 'dash',
      'doge': 'doge',
      'xrp': 'xrp',
      'zec': 'zec',
      'gnosis': 'gnosis',
      'bera': 'bera',
      'bsc': 'bsc',
      'pol': 'pol',
      'tron': 'tron',
      'sui': 'sui',
      'op': 'op',
      'avax': 'avax',
      'cardano': 'cardano',
      'ltc': 'ltc',
      'xlayer': 'xlayer',
      'monad': 'monad',
      'bch': 'bch',
      'adi': 'adi',
      'plasma': 'plasma',
      'scroll': 'scroll',
      'starknet': 'starknet',
      'aleo': 'aleo',
    };
    
    for (const [key, blockchain] of Object.entries(map)) {
      if (assetId.includes(key)) return blockchain;
    }
    
    console.warn(`⚠️ Неизвестный блокчейн для assetId: ${assetId}, используем near`);
    return 'near';
  }

  static isAddressConfigured(blockchain: Blockchain): boolean {
    const addr = this.addresses[blockchain]?.recipient;
    return !!addr && addr !== '';
  }

  static getSupportedBlockchains(): Blockchain[] {
    return Object.keys(this.addresses).filter(
      chain => this.isAddressConfigured(chain as Blockchain)
    ) as Blockchain[];
  }
}