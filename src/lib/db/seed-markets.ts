// Seed forex pairs, NSE/BSE stocks, US stocks, and Indian indices.
// Run with: bun run src/lib/db/seed-markets.ts

import { db } from '@/lib/db';

const forexAssets = [
  { symbol: 'EURUSD', name: 'Euro / US Dollar', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'EURUSD=X' }) },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'GBPUSD=X' }) },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'USDJPY=X' }) },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'USDCHF=X' }) },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'AUDUSD=X' }) },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'USDCAD=X' }) },
  { symbol: 'USDINR', name: 'US Dollar / Indian Rupee', assetClass: 'forex', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'USDINR=X' }) },
];

const indexAssets = [
  { symbol: 'NIFTY50', name: 'Nifty 50', assetClass: 'index', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: '^NSEI' }) },
  { symbol: 'BANKNIFTY', name: 'Nifty Bank', assetClass: 'index', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: '^NSEBANK' }) },
  { symbol: 'SENSEX', name: 'BSE Sensex', assetClass: 'index', exchange: 'BSE', meta: JSON.stringify({ yahooSymbol: '^BSESN' }) },
  { symbol: 'SP500', name: 'S&P 500', assetClass: 'index', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: '^GSPC' }) },
  { symbol: 'NASDAQ', name: 'Nasdaq Composite', assetClass: 'index', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: '^IXIC' }) },
  { symbol: 'DOW', name: 'Dow Jones', assetClass: 'index', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: '^DJI' }) },
];

const commodityAssets = [
  { symbol: 'GOLD', name: 'Gold (Spot)', assetClass: 'commodity', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'GC=F' }) },
  { symbol: 'SILVER', name: 'Silver (Spot)', assetClass: 'commodity', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'SI=F' }) },
  { symbol: 'OIL', name: 'Crude Oil WTI', assetClass: 'commodity', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'CL=F' }) },
  { symbol: 'BRENT', name: 'Brent Crude Oil', assetClass: 'commodity', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'BZ=F' }) },
  { symbol: 'NATGAS', name: 'Natural Gas', assetClass: 'commodity', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'NG=F' }) },
  { symbol: 'COPPER', name: 'Copper', assetClass: 'commodity', exchange: 'yahoo', meta: JSON.stringify({ yahooSymbol: 'HG=F' }) },
];

const nseStocks = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'RELIANCE.NS' }) },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'TCS.NS' }) },
  { symbol: 'INFY.NS', name: 'Infosys', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'INFY.NS' }) },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'HDFCBANK.NS' }) },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'ICICIBANK.NS' }) },
  { symbol: 'SBIN.NS', name: 'State Bank of India', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'SBIN.NS' }) },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'BHARTIARTL.NS' }) },
  { symbol: 'ITC.NS', name: 'ITC Limited', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'ITC.NS' }) },
  { symbol: 'LT.NS', name: 'Larsen & Toubro', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'LT.NS' }) },
  { symbol: 'WIPRO.NS', name: 'Wipro', assetClass: 'stock', exchange: 'NSE', meta: JSON.stringify({ yahooSymbol: 'WIPRO.NS' }) },
];

const usStocks = [
  { symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'AAPL' }) },
  { symbol: 'MSFT', name: 'Microsoft Corp.', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'MSFT' }) },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'GOOGL' }) },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'AMZN' }) },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'NVDA' }) },
  { symbol: 'META', name: 'Meta Platforms', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'META' }) },
  { symbol: 'TSLA', name: 'Tesla Inc.', assetClass: 'stock', exchange: 'NASDAQ', meta: JSON.stringify({ yahooSymbol: 'TSLA' }) },
];

async function main() {
  console.log('🌱 Seeding forex, stocks, indices, commodities...');
  const all = [...forexAssets, ...indexAssets, ...commodityAssets, ...nseStocks, ...usStocks];
  for (const a of all) {
    await db.asset.upsert({ where: { symbol: a.symbol }, create: a, update: {} });
  }
  console.log(`  ✓ ${all.length} assets (${forexAssets.length} forex, ${indexAssets.length} indices, ${commodityAssets.length} commodities, ${nseStocks.length} NSE stocks, ${usStocks.length} US stocks)`);

  // Create watchlists
  const watchlists = [
    { name: 'Forex Majors', assetClass: 'forex', symbols: forexAssets.map(a => a.symbol) },
    { name: 'NSE Top 10', assetClass: 'stock', symbols: nseStocks.map(a => a.symbol) },
    { name: 'US Tech Giants', assetClass: 'stock', symbols: usStocks.map(a => a.symbol) },
    { name: 'Global Indices', assetClass: 'index', symbols: indexAssets.map(a => a.symbol) },
    { name: 'Commodities', assetClass: 'commodity', symbols: commodityAssets.map(a => a.symbol) },
  ];
  for (const wl of watchlists) {
    const existing = await db.watchlist.findUnique({ where: { name: wl.name } });
    if (!existing) {
      await db.watchlist.create({ data: { name: wl.name, assetClass: wl.assetClass, symbols: JSON.stringify(wl.symbols) } });
      console.log(`  ✓ Watchlist "${wl.name}" (${wl.symbols.length} symbols)`);
    }
  }
  console.log('\n✅ Markets seed complete.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await db.$disconnect(); });
