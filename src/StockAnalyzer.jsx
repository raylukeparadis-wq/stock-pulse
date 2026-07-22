import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const WORKER_URL = "https://alpaca-proxy.raylukeparadis.workers.dev";
const STOCK_PULSE_WORKER_URL = "https://stock-pulse-worker.raylukeparadis.workers.dev";
const COOLDOWN_MS = 1000;

function calcMA(data, period) {
  return data.map((d, i) => {
    if (i < period - 1) return { ...d, ma: null };
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, x) => s + x.close, 0) / period;
    return { ...d, ma: parseFloat(avg.toFixed(2)) };
  });
}

function calcRSI(data, period = 7) {
  if (data.length < period + 1) return data.map(d => ({ ...d, rsi: null }));
  const gains = [], losses = [];
  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  return data.map((d, i) => {
    if (i < period) return { ...d, rsi: null };
    const g = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    const l = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    const rs = l === 0 ? 100 : g / l;
    return { ...d, rsi: parseFloat((100 - 100 / (1 + rs)).toFixed(1)) };
  });
}

// Looks up a single ticker's status within the latest Stock Pulse report.
// Returns null if no report is available yet, or a status object describing
// where (if anywhere) this ticker currently sits: an active buy/short signal,
// a watch-list entry one step away from confirming, or no signal at all.
const SECTOR_MAP = {"A":"Health Care","AAPL":"Information Technology","ABBV":"Health Care","ABNB":"Consumer Discretionary","ABT":"Health Care","ACGL":"Financials","ACN":"Information Technology","ADBE":"Information Technology","ADI":"Information Technology","ADM":"Consumer Staples","ADP":"Information Technology","ADSK":"Information Technology","AEE":"Utilities","AEP":"Utilities","AES":"Utilities","AFL":"Financials","AIG":"Financials","AIZ":"Financials","AJG":"Financials","AKAM":"Information Technology","ALB":"Materials","ALGN":"Health Care","ALL":"Financials","ALLE":"Industrials","AMAT":"Information Technology","AMCR":"Materials","AMD":"Information Technology","AME":"Industrials","AMGN":"Health Care","AMP":"Financials","AMT":"Real Estate","AMZN":"Consumer Discretionary","ANET":"Information Technology","AON":"Financials","AOS":"Industrials","APA":"Energy","APD":"Materials","APH":"Information Technology","APO":"Financials","APP":"Information Technology","APTV":"Consumer Discretionary","ARE":"Real Estate","ARES":"Financials","ATO":"Utilities","AVB":"Real Estate","AVGO":"Information Technology","AVY":"Materials","AWK":"Utilities","AXON":"Industrials","AXP":"Financials","AZO":"Consumer Discretionary","BA":"Industrials","BAC":"Financials","BALL":"Materials","BAX":"Health Care","BBY":"Consumer Discretionary","BDX":"Health Care","BEN":"Financials","BG":"Consumer Staples","BIIB":"Health Care","BK":"Financials","BKNG":"Consumer Discretionary","BKR":"Energy","BLDR":"Industrials","BLK":"Financials","BMY":"Health Care","BNY":"Financials","BR":"Information Technology","BRK.B":"Financials","BRO":"Financials","BSX":"Health Care","BX":"Financials","BXP":"Real Estate","C":"Financials","CAG":"Consumer Staples","CAH":"Health Care","CARR":"Industrials","CASY":"Consumer Staples","CAT":"Industrials","CB":"Financials","CBOE":"Financials","CBRE":"Real Estate","CCI":"Real Estate","CCL":"Consumer Discretionary","CDNS":"Information Technology","CDW":"Information Technology","CEG":"Utilities","CF":"Materials","CFG":"Financials","CHD":"Consumer Staples","CHRW":"Industrials","CHTR":"Communication Services","CI":"Health Care","CIEN":"Information Technology","CINF":"Financials","CL":"Consumer Staples","CLX":"Consumer Staples","CMCSA":"Communication Services","CME":"Financials","CMG":"Consumer Discretionary","CMI":"Industrials","CMS":"Utilities","CNP":"Utilities","COF":"Financials","COHR":"Information Technology","COIN":"Financials","COO":"Health Care","COP":"Energy","COR":"Health Care","COST":"Consumer Staples","CPAY":"Financials","CPB":"Consumer Staples","CPRT":"Industrials","CPT":"Real Estate","CRH":"Materials","CRL":"Health Care","CRM":"Information Technology","CRWD":"Information Technology","CSCO":"Information Technology","CSGP":"Real Estate","CSX":"Industrials","CTAS":"Industrials","CTSH":"Information Technology","CTVA":"Materials","CVNA":"Consumer Discretionary","CVS":"Health Care","CVX":"Energy","D":"Utilities","DAL":"Industrials","DASH":"Consumer Discretionary","DDOG":"Information Technology","DE":"Industrials","DECK":"Consumer Discretionary","DELL":"Information Technology","DG":"Consumer Discretionary","DGX":"Health Care","DHI":"Consumer Discretionary","DHR":"Health Care","DIS":"Communication Services","DLR":"Real Estate","DLTR":"Consumer Discretionary","DOC":"Real Estate","DOV":"Industrials","DOW":"Materials","DPZ":"Consumer Discretionary","DRI":"Consumer Discretionary","DTE":"Utilities","DUK":"Utilities","DVA":"Health Care","DVN":"Energy","EA":"Communication Services","EBAY":"Consumer Discretionary","ECL":"Materials","ED":"Utilities","EFX":"Industrials","EG":"Financials","EIX":"Utilities","EL":"Consumer Staples","ELV":"Health Care","EME":"Industrials","EMR":"Industrials","EOG":"Energy","EPAM":"Information Technology","EQIX":"Real Estate","EQR":"Real Estate","EQT":"Energy","ERIE":"Financials","ES":"Utilities","ESS":"Real Estate","ETN":"Industrials","ETR":"Utilities","EVRG":"Utilities","EW":"Health Care","EXC":"Utilities","EXE":"Energy","EXPD":"Industrials","EXPE":"Consumer Discretionary","EXR":"Real Estate","F":"Consumer Discretionary","FANG":"Energy","FAST":"Industrials","FCX":"Materials","FDS":"Financials","FDX":"Industrials","FE":"Utilities","FFIV":"Information Technology","FICO":"Information Technology","FIS":"Information Technology","FITB":"Financials","FIX":"Industrials","FOX":"Communication Services","FOXA":"Communication Services","FRT":"Real Estate","FSLR":"Information Technology","FTNT":"Information Technology","FTV":"Industrials","GD":"Industrials","GDDY":"Information Technology","GE":"Industrials","GEHC":"Health Care","GEN":"Information Technology","GEV":"Industrials","GILD":"Health Care","GIS":"Consumer Staples","GL":"Financials","GLW":"Information Technology","GM":"Consumer Discretionary","GNRC":"Industrials","GOOG":"Communication Services","GOOGL":"Communication Services","GPC":"Consumer Discretionary","GPN":"Financials","GRMN":"Consumer Discretionary","GS":"Financials","GWW":"Industrials","HAL":"Energy","HAS":"Consumer Discretionary","HBAN":"Financials","HCA":"Health Care","HD":"Consumer Discretionary","HIG":"Financials","HII":"Industrials","HLT":"Consumer Discretionary","HON":"Industrials","HOOD":"Financials","HPE":"Information Technology","HPQ":"Information Technology","HRL":"Consumer Staples","HSIC":"Health Care","HST":"Real Estate","HSY":"Consumer Staples","HUBB":"Industrials","HUM":"Health Care","HWM":"Industrials","IBKR":"Financials","IBM":"Information Technology","ICE":"Financials","IDXX":"Health Care","IEX":"Industrials","IFF":"Materials","INCY":"Health Care","INTC":"Information Technology","INTU":"Information Technology","INVH":"Real Estate","IP":"Materials","IQV":"Health Care","IR":"Industrials","IRM":"Real Estate","ISRG":"Health Care","IT":"Information Technology","ITW":"Industrials","IVZ":"Financials","J":"Industrials","JBHT":"Industrials","JBL":"Information Technology","JCI":"Industrials","JKHY":"Financials","JNJ":"Health Care","JPM":"Financials","KDP":"Consumer Staples","KEY":"Financials","KEYS":"Information Technology","KHC":"Consumer Staples","KIM":"Real Estate","KKR":"Financials","KMB":"Consumer Staples","KMI":"Energy","KO":"Consumer Staples","KR":"Consumer Staples","KVUE":"Consumer Staples","L":"Financials","LDOS":"Information Technology","LEN":"Consumer Discretionary","LH":"Health Care","LHX":"Industrials","LII":"Industrials","LIN":"Materials","LITE":"Information Technology","LLY":"Health Care","LMT":"Industrials","LNT":"Utilities","LOW":"Consumer Discretionary","LRCX":"Information Technology","LULU":"Consumer Discretionary","LUV":"Industrials","LVS":"Consumer Discretionary","LYB":"Materials","LYV":"Communication Services","MA":"Financials","MAA":"Real Estate","MAR":"Consumer Discretionary","MAS":"Industrials","MCD":"Consumer Discretionary","MCHP":"Information Technology","MCK":"Health Care","MCO":"Financials","MDLZ":"Consumer Staples","MDT":"Health Care","MET":"Financials","META":"Communication Services","MGM":"Consumer Discretionary","MKC":"Consumer Staples","MLM":"Materials","MMC":"Financials","MMM":"Industrials","MNST":"Consumer Staples","MO":"Consumer Staples","MOS":"Materials","MPC":"Energy","MPWR":"Information Technology","MRK":"Health Care","MRNA":"Health Care","MS":"Financials","MSCI":"Financials","MSFT":"Information Technology","MSI":"Information Technology","MTB":"Financials","MTD":"Health Care","MU":"Information Technology","NCLH":"Consumer Discretionary","NDAQ":"Financials","NDSN":"Industrials","NEE":"Utilities","NEM":"Materials","NFLX":"Communication Services","NI":"Utilities","NKE":"Consumer Discretionary","NOC":"Industrials","NOW":"Information Technology","NRG":"Utilities","NSC":"Industrials","NTAP":"Information Technology","NTRS":"Financials","NUE":"Materials","NVDA":"Information Technology","NVR":"Consumer Discretionary","NWS":"Communication Services","NWSA":"Communication Services","NXPI":"Information Technology","O":"Real Estate","ODFL":"Industrials","OKE":"Energy","OMC":"Communication Services","ON":"Information Technology","ORCL":"Information Technology","ORLY":"Consumer Discretionary","OTIS":"Industrials","OXY":"Energy","PANW":"Information Technology","PAYX":"Information Technology","PCAR":"Industrials","PCG":"Utilities","PEG":"Utilities","PEP":"Consumer Staples","PFE":"Health Care","PFG":"Financials","PG":"Consumer Staples","PGR":"Financials","PH":"Industrials","PHM":"Consumer Discretionary","PKG":"Materials","PLD":"Real Estate","PLTR":"Information Technology","PM":"Consumer Staples","PNC":"Financials","PNR":"Industrials","PNW":"Utilities","PODD":"Health Care","POOL":"Consumer Discretionary","PPG":"Materials","PPL":"Utilities","PRU":"Financials","PSA":"Real Estate","PSKY":"Communication Services","PSX":"Energy","PTC":"Information Technology","PWR":"Industrials","PYPL":"Financials","Q":"Communication Services","QCOM":"Information Technology","RCL":"Consumer Discretionary","REG":"Real Estate","REGN":"Health Care","RF":"Financials","RJF":"Financials","RL":"Consumer Discretionary","RMD":"Health Care","ROK":"Industrials","ROL":"Industrials","ROP":"Industrials","ROST":"Consumer Discretionary","RSG":"Industrials","RTX":"Industrials","RVTY":"Health Care","SBAC":"Real Estate","SBUX":"Consumer Discretionary","SCHW":"Financials","SHW":"Materials","SJM":"Consumer Staples","SLB":"Energy","SMCI":"Information Technology","SNA":"Industrials","SNDK":"Information Technology","SNPS":"Information Technology","SO":"Utilities","SOLV":"Health Care","SPG":"Real Estate","SPGI":"Financials","SRE":"Utilities","STE":"Health Care","STLD":"Materials","STT":"Financials","STX":"Information Technology","STZ":"Consumer Staples","SW":"Materials","SWK":"Industrials","SWKS":"Information Technology","SYF":"Financials","SYK":"Health Care","SYY":"Consumer Staples","T":"Communication Services","TAP":"Consumer Staples","TDG":"Industrials","TDY":"Industrials","TECH":"Health Care","TEL":"Information Technology","TER":"Information Technology","TFC":"Financials","TGT":"Consumer Discretionary","TJX":"Consumer Discretionary","TKO":"Communication Services","TMO":"Health Care","TMUS":"Communication Services","TPL":"Energy","TPR":"Consumer Discretionary","TRGP":"Energy","TRMB":"Information Technology","TROW":"Financials","TRV":"Financials","TSCO":"Consumer Discretionary","TSLA":"Consumer Discretionary","TSN":"Consumer Staples","TT":"Industrials","TTD":"Communication Services","TTWO":"Communication Services","TXN":"Information Technology","TXT":"Industrials","TYL":"Information Technology","UAL":"Industrials","UBER":"Industrials","UDR":"Real Estate","UHS":"Health Care","ULTA":"Consumer Discretionary","UNH":"Health Care","UNP":"Industrials","UPS":"Industrials","URI":"Industrials","USB":"Financials","V":"Financials","VEEV":"Health Care","VICI":"Real Estate","VLO":"Energy","VLTO":"Industrials","VMC":"Materials","VRSK":"Industrials","VRSN":"Information Technology","VRT":"Industrials","VRTX":"Health Care","VST":"Utilities","VTR":"Real Estate","VTRS":"Health Care","VZ":"Communication Services","WAB":"Industrials","WAT":"Health Care","WBD":"Communication Services","WDAY":"Information Technology","WDC":"Information Technology","WEC":"Utilities","WELL":"Real Estate","WFC":"Financials","WM":"Industrials","WMB":"Energy","WMT":"Consumer Staples","WRB":"Financials","WSM":"Consumer Discretionary","WST":"Health Care","WTW":"Financials","WY":"Real Estate","WYNN":"Consumer Discretionary","XEL":"Utilities","XOM":"Energy","XYL":"Industrials","XYZ":"Financials","YUM":"Consumer Discretionary","ZBH":"Health Care","ZBRA":"Information Technology","ZTS":"Health Care"};

function getSector(symbol) {
  return SECTOR_MAP[symbol] || 'Unknown';
}

const COMPANY_NAMES = {"A":"Agilent Technologies","AAPL":"Apple","ABBV":"AbbVie","ABNB":"Airbnb","ABT":"Abbott Laboratories","ACGL":"Arch Capital Group","ACN":"Accenture","ADBE":"Adobe","ADI":"Analog Devices","ADM":"Archer-Daniels-Midland","ADP":"Automatic Data Processing","ADSK":"Autodesk","AEE":"Ameren","AEP":"American Electric Power","AES":"AES Corporation","AFL":"Aflac","AIG":"American International Group","AIZ":"Assurant","AJG":"Arthur J. Gallagher","AKAM":"Akamai Technologies","ALB":"Albemarle","ALGN":"Align Technology","ALL":"Allstate","ALLE":"Allegion","AMAT":"Applied Materials","AMCR":"Amcor","AMD":"Advanced Micro Devices","AME":"AMETEK","AMGN":"Amgen","AMP":"Ameriprise Financial","AMT":"American Tower","AMZN":"Amazon","ANET":"Arista Networks","AON":"Aon","AOS":"A. O. Smith","APA":"APA Corporation","APD":"Air Products and Chemicals","APH":"Amphenol","APO":"Apollo Global Management","APP":"AppLovin","APTV":"Aptiv","ARE":"Alexandria Real Estate Equities","ARES":"Ares Management","ATO":"Atmos Energy","AVB":"AvalonBay Communities","AVGO":"Broadcom","AVY":"Avery Dennison","AWK":"American Water Works","AXON":"Axon Enterprise","AXP":"American Express","AZO":"AutoZone","BA":"Boeing","BAC":"Bank of America","BALL":"Ball Corporation","BAX":"Baxter International","BBY":"Best Buy","BDX":"Becton Dickinson","BEN":"Franklin Resources","BG":"Bunge Global","BIIB":"Biogen","BK":"Bank of New York Mellon","BKNG":"Booking Holdings","BKR":"Baker Hughes","BLDR":"Builders FirstSource","BLK":"BlackRock","BMY":"Bristol-Myers Squibb","BNY":"Bank of New York Mellon","BR":"Broadridge Financial Solutions","BRK.B":"Berkshire Hathaway","BRO":"Brown & Brown","BSX":"Boston Scientific","BX":"Blackstone","BXP":"BXP, Inc.","C":"Citigroup","CAG":"Conagra Brands","CAH":"Cardinal Health","CARR":"Carrier Global","CASY":"Casey's General Stores","CAT":"Caterpillar","CB":"Chubb","CBOE":"Cboe Global Markets","CBRE":"CBRE Group","CCI":"Crown Castle","CCL":"Carnival Corporation","CDNS":"Cadence Design Systems","CDW":"CDW Corporation","CEG":"Constellation Energy","CF":"CF Industries","CFG":"Citizens Financial Group","CHD":"Church & Dwight","CHRW":"C.H. Robinson","CHTR":"Charter Communications","CI":"Cigna","CIEN":"Ciena Corporation","CINF":"Cincinnati Financial","CL":"Colgate-Palmolive","CLX":"Clorox","CMCSA":"Comcast","CME":"CME Group","CMG":"Chipotle Mexican Grill","CMI":"Cummins","CMS":"CMS Energy","CNP":"CenterPoint Energy","COF":"Capital One","COHR":"Coherent Corp","COIN":"Coinbase Global","COO":"Cooper Companies","COP":"ConocoPhillips","COR":"Cencora","COST":"Costco Wholesale","CPAY":"Corpay","CPB":"Campbell's Company","CPRT":"Copart","CPT":"Camden Property Trust","CRH":"CRH plc","CRL":"Charles River Laboratories","CRM":"Salesforce","CRWD":"CrowdStrike","CSCO":"Cisco Systems","CSGP":"CoStar Group","CSX":"CSX Corporation","CTAS":"Cintas","CTSH":"Cognizant Technology Solutions","CTVA":"Corteva","CVNA":"Carvana","CVS":"CVS Health","CVX":"Chevron","D":"Dominion Energy","DAL":"Delta Air Lines","DASH":"DoorDash","DDOG":"Datadog","DE":"Deere & Company","DECK":"Deckers Brands","DELL":"Dell Technologies","DG":"Dollar General","DGX":"Quest Diagnostics","DHI":"D.R. Horton","DHR":"Danaher","DIS":"Walt Disney Company","DLR":"Digital Realty Trust","DLTR":"Dollar Tree","DOC":"Healthpeak Properties","DOV":"Dover Corporation","DOW":"Dow Inc.","DPZ":"Domino's Pizza","DRI":"Darden Restaurants","DTE":"DTE Energy","DUK":"Duke Energy","DVA":"DaVita","DVN":"Devon Energy","EA":"Electronic Arts","EBAY":"eBay","ECL":"Ecolab","ED":"Consolidated Edison","EFX":"Equifax","EG":"Everest Group","EIX":"Edison International","EL":"Est\u00e9e Lauder Companies","ELV":"Elevance Health","EME":"EMCOR Group","EMR":"Emerson Electric","EOG":"EOG Resources","EPAM":"EPAM Systems","EQIX":"Equinix","EQR":"Equity Residential","EQT":"EQT Corporation","ERIE":"Erie Indemnity","ES":"Eversource Energy","ESS":"Essex Property Trust","ETN":"Eaton Corporation","ETR":"Entergy","EVRG":"Evergy","EW":"Edwards Lifesciences","EXC":"Exelon","EXE":"Expand Energy","EXPD":"Expeditors International","EXPE":"Expedia Group","EXR":"Extra Space Storage","F":"Ford Motor Company","FANG":"Diamondback Energy","FAST":"Fastenal","FCX":"Freeport-McMoRan","FDS":"FactSet Research Systems","FDX":"FedEx","FE":"FirstEnergy","FFIV":"F5, Inc.","FICO":"Fair Isaac Corporation","FIS":"Fidelity National Information Services","FITB":"Fifth Third Bancorp","FIX":"Comfort Systems USA","FOX":"Fox Corporation","FOXA":"Fox Corporation","FRT":"Federal Realty Investment Trust","FSLR":"First Solar","FTNT":"Fortinet","FTV":"Fortive","GD":"General Dynamics","GDDY":"GoDaddy","GE":"GE Aerospace","GEHC":"GE HealthCare","GEN":"Gen Digital","GEV":"GE Vernova","GILD":"Gilead Sciences","GIS":"General Mills","GL":"Globe Life","GLW":"Corning","GM":"General Motors","GNRC":"Generac Holdings","GOOG":"Alphabet","GOOGL":"Alphabet","GPC":"Genuine Parts Company","GPN":"Global Payments","GRMN":"Garmin","GS":"Goldman Sachs","GWW":"W.W. Grainger","HAL":"Halliburton","HAS":"Hasbro","HBAN":"Huntington Bancshares","HCA":"HCA Healthcare","HD":"Home Depot","HIG":"Hartford Financial Services","HII":"Huntington Ingalls Industries","HLT":"Hilton Worldwide","HON":"Honeywell","HOOD":"Robinhood Markets","HPE":"Hewlett Packard Enterprise","HPQ":"HP Inc.","HRL":"Hormel Foods","HSIC":"Henry Schein","HST":"Host Hotels & Resorts","HSY":"Hershey Company","HUBB":"Hubbell","HUM":"Humana","HWM":"Howmet Aerospace","IBKR":"Interactive Brokers","IBM":"IBM","ICE":"Intercontinental Exchange","IDXX":"IDEXX Laboratories","IEX":"IDEX Corporation","IFF":"International Flavors & Fragrances","INCY":"Incyte","INTC":"Intel","INTU":"Intuit","INVH":"Invitation Homes","IP":"International Paper","IQV":"IQVIA Holdings","IR":"Ingersoll Rand","IRM":"Iron Mountain","ISRG":"Intuitive Surgical","IT":"Gartner","ITW":"Illinois Tool Works","IVZ":"Invesco","J":"Jacobs Solutions","JBHT":"J.B. Hunt Transport","JBL":"Jabil","JCI":"Johnson Controls","JKHY":"Jack Henry & Associates","JNJ":"Johnson & Johnson","JPM":"JPMorgan Chase","KDP":"Keurig Dr Pepper","KEY":"KeyCorp","KEYS":"Keysight Technologies","KHC":"Kraft Heinz","KIM":"Kimco Realty","KKR":"KKR & Co.","KMB":"Kimberly-Clark","KMI":"Kinder Morgan","KO":"Coca-Cola Company","KR":"Kroger","KVUE":"Kenvue","L":"Loews Corporation","LDOS":"Leidos","LEN":"Lennar","LH":"LabCorp","LHX":"L3Harris Technologies","LII":"Lennox International","LIN":"Linde plc","LITE":"Lumentum Holdings","LLY":"Eli Lilly and Company","LMT":"Lockheed Martin","LNT":"Alliant Energy","LOW":"Lowe's Companies","LRCX":"Lam Research","LULU":"Lululemon Athletica","LUV":"Southwest Airlines","LVS":"Las Vegas Sands","LYB":"LyondellBasell Industries","LYV":"Live Nation Entertainment","MA":"Mastercard","MAA":"Mid-America Apartment Communities","MAR":"Marriott International","MAS":"Masco","MCD":"McDonald's","MCHP":"Microchip Technology","MCK":"McKesson Corporation","MCO":"Moody's Corporation","MDLZ":"Mondelez International","MDT":"Medtronic","MET":"MetLife","META":"Meta Platforms","MGM":"MGM Resorts International","MKC":"McCormick & Company","MLM":"Martin Marietta Materials","MMC":"Marsh McLennan","MMM":"3M","MNST":"Monster Beverage","MO":"Altria Group","MOS":"Mosaic Company","MPC":"Marathon Petroleum","MPWR":"Monolithic Power Systems","MRK":"Merck & Co.","MRNA":"Moderna","MS":"Morgan Stanley","MSCI":"MSCI Inc.","MSFT":"Microsoft","MSI":"Motorola Solutions","MTB":"M&T Bank","MTD":"Mettler-Toledo","MU":"Micron Technology","NCLH":"Norwegian Cruise Line Holdings","NDAQ":"Nasdaq, Inc.","NDSN":"Nordson Corporation","NEE":"NextEra Energy","NEM":"Newmont Corporation","NFLX":"Netflix","NI":"NiSource","NKE":"Nike","NOC":"Northrop Grumman","NOW":"ServiceNow","NRG":"NRG Energy","NSC":"Norfolk Southern","NTAP":"NetApp","NTRS":"Northern Trust","NUE":"Nucor","NVDA":"NVIDIA","NVR":"NVR, Inc.","NWS":"News Corp","NWSA":"News Corp","NXPI":"NXP Semiconductors","O":"Realty Income","ODFL":"Old Dominion Freight Line","OKE":"ONEOK","OMC":"Omnicom Group","ON":"ON Semiconductor","ORCL":"Oracle Corporation","ORLY":"O'Reilly Automotive","OTIS":"Otis Worldwide","OXY":"Occidental Petroleum","PANW":"Palo Alto Networks","PAYX":"Paychex","PCAR":"PACCAR","PCG":"PG&E Corporation","PEG":"Public Service Enterprise Group","PEP":"PepsiCo","PFE":"Pfizer","PFG":"Principal Financial Group","PG":"Procter & Gamble","PGR":"Progressive Corporation","PH":"Parker Hannifin","PHM":"PulteGroup","PKG":"Packaging Corporation of America","PLD":"Prologis","PLTR":"Palantir Technologies","PM":"Philip Morris International","PNC":"PNC Financial Services","PNR":"Pentair","PNW":"Pinnacle West Capital","PODD":"Insulet Corporation","POOL":"Pool Corporation","PPG":"PPG Industries","PPL":"PPL Corporation","PRU":"Prudential Financial","PSA":"Public Storage","PSKY":"Paramount Skydance","PSX":"Phillips 66","PTC":"PTC Inc.","PWR":"Quanta Services","PYPL":"PayPal Holdings","Q":"Q (name unverified)","QCOM":"Qualcomm","RCL":"Royal Caribbean Group","REG":"Regency Centers","REGN":"Regeneron Pharmaceuticals","RF":"Regions Financial","RJF":"Raymond James Financial","RL":"Ralph Lauren Corporation","RMD":"ResMed","ROK":"Rockwell Automation","ROL":"Rollins, Inc.","ROP":"Roper Technologies","ROST":"Ross Stores","RSG":"Republic Services","RTX":"RTX Corporation","RVTY":"Revvity","SBAC":"SBA Communications","SBUX":"Starbucks","SCHW":"Charles Schwab Corporation","SHW":"Sherwin-Williams","SJM":"J.M. Smucker Company","SLB":"SLB","SMCI":"Super Micro Computer","SNA":"Snap-on","SNDK":"SanDisk","SNPS":"Synopsys","SO":"Southern Company","SOLV":"Solventum","SPG":"Simon Property Group","SPGI":"S&P Global","SRE":"Sempra","STE":"Steris","STLD":"Steel Dynamics","STT":"State Street Corporation","STX":"Seagate Technology","STZ":"Constellation Brands","SW":"Smurfit Westrock","SWK":"Stanley Black & Decker","SWKS":"Skyworks Solutions","SYF":"Synchrony Financial","SYK":"Stryker Corporation","SYY":"Sysco","T":"AT&T","TAP":"Molson Coors Beverage Company","TDG":"TransDigm Group","TDY":"Teledyne Technologies","TECH":"Bio-Techne","TEL":"TE Connectivity","TER":"Teradyne","TFC":"Truist Financial","TGT":"Target Corporation","TJX":"TJX Companies","TKO":"TKO Group Holdings","TMO":"Thermo Fisher Scientific","TMUS":"T-Mobile US","TPL":"Texas Pacific Land Corporation","TPR":"Tapestry, Inc.","TRGP":"Targa Resources","TRMB":"Trimble Inc.","TROW":"T. Rowe Price","TRV":"Travelers Companies","TSCO":"Tractor Supply Company","TSLA":"Tesla","TSN":"Tyson Foods","TT":"Trane Technologies","TTD":"The Trade Desk","TTWO":"Take-Two Interactive","TXN":"Texas Instruments","TXT":"Textron","TYL":"Tyler Technologies","UAL":"United Airlines Holdings","UBER":"Uber Technologies","UDR":"UDR, Inc.","UHS":"Universal Health Services","ULTA":"Ulta Beauty","UNH":"UnitedHealth Group","UNP":"Union Pacific Corporation","UPS":"United Parcel Service","URI":"United Rentals","USB":"U.S. Bancorp","V":"Visa Inc.","VEEV":"Veeva Systems","VICI":"VICI Properties","VLO":"Valero Energy","VLTO":"Veralto","VMC":"Vulcan Materials Company","VRSK":"Verisk Analytics","VRSN":"VeriSign","VRT":"Vertiv Holdings","VRTX":"Vertex Pharmaceuticals","VST":"Vistra Corp","VTR":"Ventas","VTRS":"Viatris","VZ":"Verizon Communications","WAB":"Westinghouse Air Brake Technologies","WAT":"Waters Corporation","WBD":"Warner Bros. Discovery","WDAY":"Workday","WDC":"Western Digital","WEC":"WEC Energy Group","WELL":"Welltower","WFC":"Wells Fargo","WM":"Waste Management","WMB":"Williams Companies","WMT":"Walmart","WRB":"W. R. Berkley Corporation","WSM":"Williams-Sonoma","WST":"West Pharmaceutical Services","WTW":"Willis Towers Watson","WY":"Weyerhaeuser","WYNN":"Wynn Resorts","XEL":"Xcel Energy","XOM":"ExxonMobil","XYL":"Xylem Inc.","XYZ":"Block, Inc.","YUM":"Yum! Brands","ZBH":"Zimmer Biomet","ZBRA":"Zebra Technologies","ZTS":"Zoetis"};

function getCompanyName(symbol) {
  return COMPANY_NAMES[symbol] || symbol;
}

// Per-sector: the price window with the highest historical win rate, from
// a 5,339-cycle backtest across 6 years of history (n>=100 per bucket).
const SECTOR_TOP_WINDOW = {"Industrials":{"bucket":"250to500","low":250,"high":500,"winRate":65.5,"avgReturn":1.48,"n":226},"Health Care":{"bucket":"250to500","low":250,"high":500,"winRate":54.1,"avgReturn":0.25,"n":146},"Information Technology":{"bucket":"50to100","low":50,"high":100,"winRate":62.2,"avgReturn":0.96,"n":156},"Financials":{"bucket":"50to100","low":50,"high":100,"winRate":58.1,"avgReturn":0.81,"n":260},"Consumer Discretionary":{"bucket":"100to250","low":100,"high":250,"winRate":50.9,"avgReturn":-0.07,"n":222},"Real Estate":{"bucket":"100to250","low":100,"high":250,"winRate":43.6,"avgReturn":-0.42,"n":117},"Utilities":{"bucket":"50to100","low":50,"high":100,"winRate":52.3,"avgReturn":0.09,"n":149},"Consumer Staples":{"bucket":"50to100","low":50,"high":100,"winRate":47.7,"avgReturn":-0.34,"n":111},"Energy":{"bucket":"100to250","low":100,"high":250,"winRate":55.9,"avgReturn":0.12,"n":118}};

function isInTopWinRateWindow(sector, price) {
  const window = SECTOR_TOP_WINDOW[sector];
  if (!window) return false;
  return price >= window.low && price < window.high;
}

function getRecommendation(report, ticker) {
  if (!report || report.error) return null;

  const inLong = report.long?.find(item => item.symbol === ticker);
  if (inLong) {
    return {
      status: "BUY", label: "Active Buy Signal", color: "#22c55e",
      detail: `Score ${inLong.score} · confirmed ${inLong.streakDays}d`,
      entryDate: inLong.entryDate, entryPrice: inLong.entryPrice,
      historicalStrength: inLong.historicalStrength,
      asOfDate: report.asOfDate,
    };
  }

  const inLongWatch = report.longWatch?.find(item => item.symbol === ticker);
  if (inLongWatch) {
    return {
      status: "BUY_WATCH", label: "Buy Watch List", color: "#84cc16",
      detail: `Score ${inLongWatch.score} · one day from confirming`,
      asOfDate: report.asOfDate,
    };
  }

  return {
    status: "NONE", label: "No Active Signal", color: "#64748b",
    detail: "Not currently meeting buy criteria",
    asOfDate: report.asOfDate,
  };
}

function fmtVol(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return n.toLocaleString();
}

const PriceTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: "2px 0" }}>
          {p.name}: <strong>${p.value?.toLocaleString()}</strong>
        </p>
      ))}
    </div>
  );
};

const VolTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#38bdf8", margin: 0 }}>Vol: <strong>{fmtVol(payload[0]?.value)}</strong></p>
    </div>
  );
};

const RSITooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length || !payload[0]?.value) return null;
  const v = payload[0].value;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#a78bfa", margin: 0 }}>RSI: <strong>{v}</strong></p>
      <p style={{ color: v >= 70 ? "#ef4444" : v <= 30 ? "#22c55e" : "#94a3b8", margin: "2px 0 0", fontSize: 11 }}>
        {v >= 70 ? "Overbought" : v <= 30 ? "Oversold" : "Neutral"}
      </p>
    </div>
  );
};

export default function StockAnalyzer() {
  const [ticker, setTicker] = useState("");
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("price");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [bars, setBars] = useState([]);
  const [intradayBars, setIntradayBars] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [allRecommendations, setAllRecommendations] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef(null);

  const startCooldown = useCallback(() => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    const total = Math.ceil(COOLDOWN_MS / 1000);
    setCooldown(total);
    cooldownTimer.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownTimer.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => clearInterval(cooldownTimer.current), []);

  useEffect(() => {
    fetch(`${STOCK_PULSE_WORKER_URL}/report/latest`)
      .then(r => r.json())
      .then(data => {
        if (!data.error) setAllRecommendations(data);
      })
      .catch(() => {})
      .finally(() => setRecsLoading(false));
  }, []);

  async function handleLookup(symbolOverride) {
    if (cooldown > 0) return;
    const t = (symbolOverride || input).trim().toUpperCase();
    if (!t) return;
    setInput(t);

    setLoading(true);
    setError(null);
    setQuote(null);
    setBars([]);
    setIntradayBars([]);
    setRecommendation(null);
    startCooldown();

    try {
      const [quoteRes, barsRes, reportRes] = await Promise.all([
        fetch(`${WORKER_URL}/quote?symbol=${t}`),
        fetch(`${WORKER_URL}/bars?symbol=${t}&limit=30&timeframe=1Day`),
        fetch(`${STOCK_PULSE_WORKER_URL}/report/latest`).catch(() => null),
      ]);

      if (quoteRes.status === 429 || barsRes.status === 429) {
        throw new Error("Rate limited. Please wait a moment and try again.");
      }

      const quoteData = await quoteRes.json();
      const barsData = await barsRes.json();

      if (quoteData.error) throw new Error(quoteData.error);
      if (barsData.error) throw new Error(barsData.error);
      if (!quoteData.price) throw new Error(`No data found for "${t}". Check the ticker symbol.`);

      setQuote(quoteData);
      setBars(barsData.bars || []);
      setTicker(t);

      // Today's intraday bars -- best-effort, separate from the main fetch
      // so a failure here doesn't break the rest of the analyzer.
      const todayStr = new Date().toISOString().slice(0, 10);
      fetch(`${WORKER_URL}/bars?symbol=${t}&timeframe=5Min&start=${todayStr}&end=${todayStr}&limit=200`)
        .then(r => r.json())
        .then(data => setIntradayBars(data.bars || []))
        .catch(() => setIntradayBars([]));

      // Recommendation lookup is best-effort -- if the backend is down or
      // hasn't run a refresh yet, the rest of the analyzer still works fine,
      // it just shows "no recommendation available" instead.
      if (reportRes && reportRes.ok) {
        const reportData = await reportRes.json();
        setRecommendation(getRecommendation(reportData, t));
      } else {
        setRecommendation(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const { priceData, rsiData } = useMemo(() => {
    if (!bars.length) return { priceData: [], rsiData: [] };
    const withMA = calcMA(bars, 5);
    const rsi = calcRSI(bars, 7);
    return { priceData: withMA, rsiData: rsi };
  }, [bars]);

  const lastRSI = rsiData[rsiData.length - 1]?.rsi;
  const momentum = bars.length >= 2
    ? ((bars[bars.length - 1].close - bars[0].close) / bars[0].close * 100).toFixed(2)
    : "0.00";

  const tabs = ["price", "volume", "rsi", "recommendation"];

  return (
    <div style={{
      minHeight: "100vh", background: "#060c18", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 16px",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Search */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input
            value={input}
            onChange={e => { setInput(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={e => e.key === "Enter" && handleLookup()}
            placeholder="Ticker"
            style={{
              flex: 1, background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 6, padding: "3px 4px", color: "#e2e8f0",
              fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", outline: "none",
            }}
          />
          <button
            onClick={() => handleLookup()}
            disabled={cooldown > 0 || loading}
            style={{
              background: cooldown > 0 || loading ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              border: cooldown > 0 || loading ? "1px solid #334155" : "none",
              borderRadius: 6, padding: "3px 6px",
              color: cooldown > 0 || loading ? "#475569" : "#fff",
              fontWeight: 600, fontSize: 10,
              cursor: cooldown > 0 || loading ? "not-allowed" : "pointer",
              minWidth: 28, transition: "all 0.2s",
            }}
          >
            {loading ? "..." : cooldown > 0 ? `${cooldown}s` : "Go"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: 11, color: "#475569", textAlign: "center", marginBottom: 16 }}>
          For informational purposes only. Not financial advice.
        </p>

        {/* Clickable recommendations -- tap a ticker to analyze it directly */}
        {!recsLoading && allRecommendations && (
          <div style={{ marginBottom: 24 }}>
            {allRecommendations.asOfDate && (
              <p style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Recommendations as of {allRecommendations.asOfDate}</p>
            )}
            {(() => {
              const MAX_SELL_ITEMS = 20;
              const reasonSeverity = { trailing_stop: 1, ma50_breakdown: 2, score_reversal: 3, atr_spike: 4, profit_target: 5 };
              const trackedPositions = allRecommendations.trackedPositions || [];

              const sellTriggers = trackedPositions
                .filter(item => item.exitStatus && item.exitStatus.closed)
                .sort((a, b) => (reasonSeverity[a.exitStatus.exitReason] || 3) - (reasonSeverity[b.exitStatus.exitReason] || 3))
                .slice(0, MAX_SELL_ITEMS);

              const sellWatch = trackedPositions
                .filter(item => item.exitStatus && !item.exitStatus.closed)
                .sort((a, b) => {
                  const gainA = Math.abs((a.lastClose - a.entryPrice) / a.entryPrice);
                  const gainB = Math.abs((b.lastClose - b.entryPrice) / b.entryPrice);
                  return gainB - gainA;
                })
                .slice(0, MAX_SELL_ITEMS);

              const categories = {
                long: allRecommendations.long,
                longWatch: allRecommendations.longWatch,
                sellTriggers, sellWatch,
              };
              return [
                { key: "long", label: "Active Buy Signals", color: "#3b82f6" },
                { key: "longWatch", label: "Buy Watch List", color: "#84cc16" },
                { key: "sellTriggers", label: "Sell Triggers", color: "#6366f1" },
                { key: "sellWatch", label: "Sell Watch", color: "#f97316" },
              ].map(({ key, label, color }) => {
                const items = categories[key];
                if (!items || items.length === 0) return null;
                return (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 600 }}>{label} ({items.length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {items.map(item => {
                        const strengthColors = { strong: "#16a34a", neutral: "#94a3b8", weak: "#dc2626" };
                        const strengthEmoji = { strong: "🟢", neutral: "⚪", weak: "🔴" };
                        const itemColor = item.historicalStrength ? strengthColors[item.historicalStrength.tier] : color;
                        const emoji = item.historicalStrength ? strengthEmoji[item.historicalStrength.tier] : null;
                        return (
                          <button
                            key={item.symbol}
                            onClick={() => handleLookup(item.symbol)}
                            disabled={cooldown > 0 || loading}
                            style={{
                              background: `${itemColor}1a`, border: `1px solid ${itemColor}66`,
                              borderRadius: 8, padding: "6px 12px", color: itemColor,
                              fontWeight: 700, fontSize: 13,
                              cursor: cooldown > 0 || loading ? "not-allowed" : "pointer",
                            }}
                          >
                            {emoji ? `${emoji} ` : ""}{item.symbol}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}



        {quote && (
          <>
            {/* Hero card */}
            <div style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 3, padding: "3px 4px", marginBottom: 3,
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              flexWrap: "wrap", gap: 2,
            }}>
              <div>
                <div style={{ fontSize: 8, color: "#64748b", marginBottom: 1 }}>{ticker} · {getCompanyName(ticker)} · {getSector(ticker)} · Live Quote</div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "-0.03em", color: isInTopWinRateWindow(getSector(ticker), quote.price) ? "#3b82f6" : "#e2e8f0" }}>
                  ${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 8, color: quote.change >= 0 ? "#22c55e" : "#ef4444", marginTop: 1 }}>
                  {quote.change >= 0 ? "▲" : "▼"} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.changePct).toFixed(2)}%) today
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  ["Open", `$${quote.open.toLocaleString()}`],
                  ["Prev Close", `$${quote.prevClose.toLocaleString()}`],
                  ["Volume", fmtVol(quote.volume)],
                  ["30d Momentum", (momentum > 0 ? "+" : "") + momentum + "%"],
                  ["RSI (7)", lastRSI ?? "—"],
                ].map(([label, val]) => (
                  <div key={label} style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#cbd5e1" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
              {tabs.map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={{
                  background: activeTab === t ? "#1e293b" : "transparent",
                  border: activeTab === t ? "1px solid #334155" : "1px solid transparent",
                  borderRadius: 8, padding: "7px 16px",
                  color: activeTab === t ? "#e2e8f0" : "#64748b",
                  fontWeight: 600, fontSize: 13, cursor: "pointer", textTransform: "capitalize",
                }}>
                  {t === "rsi" ? "RSI" : t === "recommendation" ? "Recommendation" : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Chart panel */}
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: "20px 8px 8px", marginBottom: 20 }}>

              {activeTab === "price" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Price & 5-Day MA</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>Last 30 sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={priceData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false}
                        domain={["auto", "auto"]} tickFormatter={v => `$${v.toLocaleString()}`} width={72} />
                      <Tooltip content={<PriceTooltip />} />
                      <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Close" />
                      <Line type="monotone" dataKey="ma" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="5-Day MA" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: 20, paddingLeft: 24, paddingTop: 8, marginBottom: 24 }}>
                    {[["#3b82f6", "Close Price"], ["#f59e0b", "5-Day MA"]].map(([c, l]) => (
                      <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
                        <div style={{ width: 20, height: 2, background: c, borderRadius: 2 }} />{l}
                      </div>
                    ))}
                  </div>

                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Today's Price</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>5-min intervals</span>
                  </div>
                  {intradayBars.length === 0 ? (
                    <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 13 }}>
                      {loading ? "Loading..." : "No intraday data yet (market may be closed)"}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={intradayBars} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false}
                          tickFormatter={d => d.slice(11, 16)} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false}
                          domain={["auto", "auto"]} tickFormatter={v => `$${v.toLocaleString()}`} width={72} />
                        <Tooltip content={<PriceTooltip />} />
                        <Line type="monotone" dataKey="close" stroke="#22c55e" strokeWidth={2.5} dot={false} name="Close" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  <div style={{ display: "flex", gap: 20, paddingLeft: 24, paddingTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
                      <div style={{ width: 20, height: 2, background: "#22c55e", borderRadius: 2 }} />Today's Close
                    </div>
                  </div>
                </>
              )}

              {activeTab === "volume" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Volume</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>Last 30 sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={bars} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => fmtVol(v)} width={52} />
                      <Tooltip content={<VolTooltip />} />
                      <Bar dataKey="volume" fill="#38bdf8" radius={[3, 3, 0, 0]} opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}

              {activeTab === "rsi" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>RSI (7-period)</span>
                    <span style={{ marginLeft: 12, fontSize: 12, color: lastRSI >= 70 ? "#ef4444" : lastRSI <= 30 ? "#22c55e" : "#64748b" }}>
                      {lastRSI ? `${lastRSI} · ${lastRSI >= 70 ? "Overbought" : lastRSI <= 30 ? "Oversold" : "Neutral zone"}` : ""}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={rsiData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                      <Tooltip content={<RSITooltip />} />
                      <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.6} label={{ value: "70", fill: "#ef4444", fontSize: 10, position: "right" }} />
                      <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.6} label={{ value: "30", fill: "#22c55e", fontSize: 10, position: "right" }} />
                      <ReferenceLine y={50} stroke="#334155" strokeDasharray="2 4" />
                      <Line type="monotone" dataKey="rsi" stroke="#a78bfa" strokeWidth={2.5} dot={false} name="RSI" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ paddingLeft: 20, paddingTop: 8, fontSize: 12, color: "#475569" }}>
                    Above 70 = overbought · Below 30 = oversold
                  </div>
                </>
              )}

              {activeTab === "recommendation" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 16 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Stock Pulse Recommendation</span>
                    {recommendation?.asOfDate && (
                      <span style={{ marginLeft: 12, fontSize: 12, color: "#475569" }}>As of {recommendation.asOfDate}</span>
                    )}
                  </div>

                  {!recommendation && (
                    <div style={{ padding: "20px 16px", textAlign: "center", color: "#334155" }}>
                      <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
                      <p style={{ margin: 0, fontSize: 14 }}>No recommendation data available right now.</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#475569" }}>The daily analysis may not have run yet today.</p>
                    </div>
                  )}

                  {recommendation && (
                    <div style={{ padding: "8px 16px 20px" }}>
                      <div style={{
                        display: "inline-block", padding: "8px 20px", borderRadius: 10,
                        background: `${recommendation.color}1a`, border: `1px solid ${recommendation.color}66`,
                        marginBottom: 14,
                      }}>
                        <span style={{ fontSize: 20, fontWeight: 800, color: recommendation.color, letterSpacing: "-0.02em" }}>
                          {recommendation.label}
                        </span>
                      </div>
                      <p style={{ fontSize: 14, color: "#94a3b8", margin: "0 0 4px" }}>{recommendation.detail}</p>
                      {recommendation.entryDate && recommendation.entryPrice && (
                        <p style={{ fontSize: 13, color: "#cbd5e1", margin: "0 0 4px" }}>
                          Signal confirmed on <strong>{recommendation.entryDate}</strong> @ <strong>${recommendation.entryPrice.toFixed(2)}</strong>
                          {quote && (
                            <> ({(
                              ((quote.price - recommendation.entryPrice) / recommendation.entryPrice) * 100
                            ).toFixed(2)}% since entry)</>
                          )}
                        </p>
                      )}

                      {recommendation.historicalStrength && (
                        <p style={{ fontSize: 12, color: recommendation.historicalStrength.tier === "strong" ? "#22c55e" : recommendation.historicalStrength.tier === "weak" ? "#ef4444" : "#94a3b8", margin: "0 0 4px" }}>
                          {recommendation.historicalStrength.tier === "strong" ? "🟢" : recommendation.historicalStrength.tier === "weak" ? "🔴" : "⚪"} This sector/price combination averaged {recommendation.historicalStrength.avgReturn >= 0 ? "+" : ""}{recommendation.historicalStrength.avgReturn}% across {recommendation.historicalStrength.n} similar historical trades
                        </p>
                      )}

                      {recommendation.status === "BUY" && (
                        <p style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
                          Meets all buy criteria: composite score ≥ 2.0, controlled volatility, above both moving averages, confirmed volume trend.
                        </p>
                      )}
                      {recommendation.status === "BUY_WATCH" && (
                        <p style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
                          Passed all conditions today for the first time — needs one more qualifying day to confirm.
                        </p>
                      )}
                      {recommendation.status === "NONE" && (
                        <p style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
                          This is not a rating of the company — it just means current price action doesn't meet the rule set's entry criteria today.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Signal summary bar */}
            <div style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 3, padding: "2px 3px",
              display: "flex", gap: 3, flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 7, color: "#475569", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", alignSelf: "center" }}>
                Signals
              </div>
              {[
                {
                  label: "Trend",
                  value: parseFloat(momentum) > 0 ? "Bullish" : "Bearish",
                  color: parseFloat(momentum) > 0 ? "#22c55e" : "#ef4444",
                  detail: `${momentum}% 30-day`,
                },
                {
                  label: "Volume",
                  value: fmtVol(quote.volume),
                  color: "#38bdf8",
                  detail: "today",
                },
                {
                  label: "RSI",
                  value: lastRSI >= 70 ? "Overbought" : lastRSI <= 30 ? "Oversold" : "Neutral",
                  color: lastRSI >= 70 ? "#ef4444" : lastRSI <= 30 ? "#22c55e" : "#64748b",
                  detail: `${lastRSI ?? "—"}`,
                },
                {
                  label: "Recommendation",
                  value: recommendation ? recommendation.label : "Unavailable",
                  color: recommendation ? recommendation.color : "#475569",
                  detail: recommendation?.status === "NONE" ? "no signal" : recommendation ? "Stock Pulse" : "no data",
                },
              ].map(({ label, value, color, detail }) => (
                <div key={label} style={{
                  flex: 1, minWidth: 60, background: "#060c18", borderRadius: 3, padding: "2px 3px",
                  border: `1px solid ${color}33`,
                }}>
                  <div style={{ fontSize: 6, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color, marginTop: 1 }}>{value}</div>
                  <div style={{ fontSize: 6, color: "#334155", marginTop: 1 }}>{detail}</div>
                </div>
              ))}
            </div>

            <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 16 }}>
              Live data via Alpaca Markets · Recommendations from Stock Pulse ruleset · Not financial advice
            </p>
          </>
        )}
      </div>
    </div>
  );
}
