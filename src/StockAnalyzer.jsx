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
const SECTOR_MAP = {"A":"Health Care","AAPL":"Information Technology","ABBV":"Health Care","ABNB":"Consumer Discretionary","ABT":"Health Care","ACGL":"Financials","ACN":"Information Technology","ADBE":"Information Technology","ADI":"Information Technology","ADM":"Consumer Staples","ADP":"Information Technology","ADSK":"Information Technology","AEE":"Utilities","AEP":"Utilities","AES":"Utilities","AFL":"Financials","AIG":"Financials","AIZ":"Financials","AJG":"Financials","AKAM":"Information Technology","ALB":"Materials","ALGN":"Health Care","ALL":"Financials","ALLE":"Industrials","AMAT":"Information Technology","AMCR":"Materials","AMD":"Information Technology","AME":"Industrials","AMGN":"Health Care","AMP":"Financials","AMT":"Real Estate","AMZN":"Consumer Discretionary","ANET":"Information Technology","AON":"Financials","AOS":"Industrials","APA":"Energy","APD":"Materials","APH":"Information Technology","APO":"Financials","APP":"Information Technology","APTV":"Consumer Discretionary","ARE":"Real Estate","ARES":"Financials","ATO":"Utilities","AVB":"Real Estate","AVGO":"Information Technology","AVY":"Materials","AWK":"Utilities","AXON":"Industrials","AXP":"Financials","AZO":"Consumer Discretionary","BA":"Industrials","BAC":"Financials","BALL":"Materials","BAX":"Health Care","BBY":"Consumer Discretionary","BDX":"Health Care","BEN":"Financials","BG":"Consumer Staples","BIIB":"Health Care","BK":"Financials","BKNG":"Consumer Discretionary","BKR":"Energy","BLDR":"Industrials","BLK":"Financials","BMY":"Health Care","BNY":"Financials","BR":"Information Technology","BRK.B":"Financials","BRO":"Financials","BSX":"Health Care","BX":"Financials","BXP":"Real Estate","C":"Financials","CAG":"Consumer Staples","CAH":"Health Care","CARR":"Industrials","CASY":"Consumer Staples","CAT":"Industrials","CB":"Financials","CBOE":"Financials","CBRE":"Real Estate","CCI":"Real Estate","CCL":"Consumer Discretionary","CDNS":"Information Technology","CDW":"Information Technology","CEG":"Utilities","CF":"Materials","CFG":"Financials","CHD":"Consumer Staples","CHRW":"Industrials","CHTR":"Communication Services","CI":"Health Care","CIEN":"Information Technology","CINF":"Financials","CL":"Consumer Staples","CLX":"Consumer Staples","CMCSA":"Communication Services","CME":"Financials","CMG":"Consumer Discretionary","CMI":"Industrials","CMS":"Utilities","CNP":"Utilities","COF":"Financials","COHR":"Information Technology","COIN":"Financials","COO":"Health Care","COP":"Energy","COR":"Health Care","COST":"Consumer Staples","CPAY":"Financials","CPB":"Consumer Staples","CPRT":"Industrials","CPT":"Real Estate","CRH":"Materials","CRL":"Health Care","CRM":"Information Technology","CRWD":"Information Technology","CSCO":"Information Technology","CSGP":"Real Estate","CSX":"Industrials","CTAS":"Industrials","CTSH":"Information Technology","CTVA":"Materials","CVNA":"Consumer Discretionary","CVS":"Health Care","CVX":"Energy","D":"Utilities","DAL":"Industrials","DASH":"Consumer Discretionary","DDOG":"Information Technology","DE":"Industrials","DECK":"Consumer Discretionary","DELL":"Information Technology","DG":"Consumer Discretionary","DGX":"Health Care","DHI":"Consumer Discretionary","DHR":"Health Care","DIS":"Communication Services","DLR":"Real Estate","DLTR":"Consumer Discretionary","DOC":"Real Estate","DOV":"Industrials","DOW":"Materials","DPZ":"Consumer Discretionary","DRI":"Consumer Discretionary","DTE":"Utilities","DUK":"Utilities","DVA":"Health Care","DVN":"Energy","EA":"Communication Services","EBAY":"Consumer Discretionary","ECL":"Materials","ED":"Utilities","EFX":"Industrials","EG":"Financials","EIX":"Utilities","EL":"Consumer Staples","ELV":"Health Care","EME":"Industrials","EMR":"Industrials","EOG":"Energy","EPAM":"Information Technology","EQIX":"Real Estate","EQR":"Real Estate","EQT":"Energy","ERIE":"Financials","ES":"Utilities","ESS":"Real Estate","ETN":"Industrials","ETR":"Utilities","EVRG":"Utilities","EW":"Health Care","EXC":"Utilities","EXE":"Energy","EXPD":"Industrials","EXPE":"Consumer Discretionary","EXR":"Real Estate","F":"Consumer Discretionary","FANG":"Energy","FAST":"Industrials","FCX":"Materials","FDS":"Financials","FDX":"Industrials","FE":"Utilities","FFIV":"Information Technology","FICO":"Information Technology","FIS":"Information Technology","FITB":"Financials","FIX":"Industrials","FOX":"Communication Services","FOXA":"Communication Services","FRT":"Real Estate","FSLR":"Information Technology","FTNT":"Information Technology","FTV":"Industrials","GD":"Industrials","GDDY":"Information Technology","GE":"Industrials","GEHC":"Health Care","GEN":"Information Technology","GEV":"Industrials","GILD":"Health Care","GIS":"Consumer Staples","GL":"Financials","GLW":"Information Technology","GM":"Consumer Discretionary","GNRC":"Industrials","GOOG":"Communication Services","GOOGL":"Communication Services","GPC":"Consumer Discretionary","GPN":"Financials","GRMN":"Consumer Discretionary","GS":"Financials","GWW":"Industrials","HAL":"Energy","HAS":"Consumer Discretionary","HBAN":"Financials","HCA":"Health Care","HD":"Consumer Discretionary","HIG":"Financials","HII":"Industrials","HLT":"Consumer Discretionary","HON":"Industrials","HOOD":"Financials","HPE":"Information Technology","HPQ":"Information Technology","HRL":"Consumer Staples","HSIC":"Health Care","HST":"Real Estate","HSY":"Consumer Staples","HUBB":"Industrials","HUM":"Health Care","HWM":"Industrials","IBKR":"Financials","IBM":"Information Technology","ICE":"Financials","IDXX":"Health Care","IEX":"Industrials","IFF":"Materials","INCY":"Health Care","INTC":"Information Technology","INTU":"Information Technology","INVH":"Real Estate","IP":"Materials","IQV":"Health Care","IR":"Industrials","IRM":"Real Estate","ISRG":"Health Care","IT":"Information Technology","ITW":"Industrials","IVZ":"Financials","J":"Industrials","JBHT":"Industrials","JBL":"Information Technology","JCI":"Industrials","JKHY":"Financials","JNJ":"Health Care","JPM":"Financials","KDP":"Consumer Staples","KEY":"Financials","KEYS":"Information Technology","KHC":"Consumer Staples","KIM":"Real Estate","KKR":"Financials","KMB":"Consumer Staples","KMI":"Energy","KO":"Consumer Staples","KR":"Consumer Staples","KVUE":"Consumer Staples","L":"Financials","LDOS":"Information Technology","LEN":"Consumer Discretionary","LH":"Health Care","LHX":"Industrials","LII":"Industrials","LIN":"Materials","LITE":"Information Technology","LLY":"Health Care","LMT":"Industrials","LNT":"Utilities","LOW":"Consumer Discretionary","LRCX":"Information Technology","LULU":"Consumer Discretionary","LUV":"Industrials","LVS":"Consumer Discretionary","LYB":"Materials","LYV":"Communication Services","MA":"Financials","MAA":"Real Estate","MAR":"Consumer Discretionary","MAS":"Industrials","MCD":"Consumer Discretionary","MCHP":"Information Technology","MCK":"Health Care","MCO":"Financials","MDLZ":"Consumer Staples","MDT":"Health Care","MET":"Financials","META":"Communication Services","MGM":"Consumer Discretionary","MKC":"Consumer Staples","MLM":"Materials","MMC":"Financials","MMM":"Industrials","MNST":"Consumer Staples","MO":"Consumer Staples","MOS":"Materials","MPC":"Energy","MPWR":"Information Technology","MRK":"Health Care","MRNA":"Health Care","MS":"Financials","MSCI":"Financials","MSFT":"Information Technology","MSI":"Information Technology","MTB":"Financials","MTD":"Health Care","MU":"Information Technology","NCLH":"Consumer Discretionary","NDAQ":"Financials","NDSN":"Industrials","NEE":"Utilities","NEM":"Materials","NFLX":"Communication Services","NI":"Utilities","NKE":"Consumer Discretionary","NOC":"Industrials","NOW":"Information Technology","NRG":"Utilities","NSC":"Industrials","NTAP":"Information Technology","NTRS":"Financials","NUE":"Materials","NVDA":"Information Technology","NVR":"Consumer Discretionary","NWS":"Communication Services","NWSA":"Communication Services","NXPI":"Information Technology","O":"Real Estate","ODFL":"Industrials","OKE":"Energy","OMC":"Communication Services","ON":"Information Technology","ORCL":"Information Technology","ORLY":"Consumer Discretionary","OTIS":"Industrials","OXY":"Energy","PANW":"Information Technology","PAYX":"Information Technology","PCAR":"Industrials","PCG":"Utilities","PEG":"Utilities","PEP":"Consumer Staples","PFE":"Health Care","PFG":"Financials","PG":"Consumer Staples","PGR":"Financials","PH":"Industrials","PHM":"Consumer Discretionary","PKG":"Materials","PLD":"Real Estate","PLTR":"Information Technology","PM":"Consumer Staples","PNC":"Financials","PNR":"Industrials","PNW":"Utilities","PODD":"Health Care","POOL":"Consumer Discretionary","PPG":"Materials","PPL":"Utilities","PRU":"Financials","PSA":"Real Estate","PSKY":"Communication Services","PSX":"Energy","PTC":"Information Technology","PWR":"Industrials","PYPL":"Financials","Q":"Communication Services","QCOM":"Information Technology","RCL":"Consumer Discretionary","REG":"Real Estate","REGN":"Health Care","RF":"Financials","RJF":"Financials","RL":"Consumer Discretionary","RMD":"Health Care","ROK":"Industrials","ROL":"Industrials","ROP":"Industrials","ROST":"Consumer Discretionary","RSG":"Industrials","RTX":"Industrials","RVTY":"Health Care","SBAC":"Real Estate","SBUX":"Consumer Discretionary","SCHW":"Financials","SHW":"Materials","SJM":"Consumer Staples","SLB":"Energy","SMCI":"Information Technology","SNA":"Industrials","SNDK":"Information Technology","SNPS":"Information Technology","SO":"Utilities","SOLV":"Health Care","SPG":"Real Estate","SPGI":"Financials","SRE":"Utilities","STE":"Health Care","STLD":"Materials","STT":"Financials","STX":"Information Technology","STZ":"Consumer Staples","SW":"Materials","SWK":"Industrials","SWKS":"Information Technology","SYF":"Financials","SYK":"Health Care","SYY":"Consumer Staples","T":"Communication Services","TAP":"Consumer Staples","TDG":"Industrials","TDY":"Industrials","TECH":"Health Care","TEL":"Information Technology","TER":"Information Technology","TFC":"Financials","TGT":"Consumer Discretionary","TJX":"Consumer Discretionary","TKO":"Communication Services","TMO":"Health Care","TMUS":"Communication Services","TPL":"Energy","TPR":"Consumer Discretionary","TRGP":"Energy","TRMB":"Information Technology","TROW":"Financials","TRV":"Financials","TSCO":"Consumer Discretionary","TSLA":"Consumer Discretionary","TSN":"Consumer Staples","TT":"Industrials","TTD":"Communication Services","TTWO":"Communication Services","TXN":"Information Technology","TXT":"Industrials","TYL":"Information Technology","UAL":"Industrials","UBER":"Industrials","UDR":"Real Estate","UHS":"Health Care","ULTA":"Consumer Discretionary","UNH":"Health Care","UNP":"Industrials","UPS":"Industrials","URI":"Industrials","USB":"Financials","V":"Financials","VEEV":"Health Care","VICI":"Real Estate","VLO":"Energy","VLTO":"Industrials","VMC":"Materials","VRSK":"Industrials","VRSN":"Information Technology","VRT":"Industrials","VRTX":"Health Care","VST":"Utilities","VTR":"Real Estate","VTRS":"Health Care","VZ":"Communication Services","WAB":"Industrials","WAT":"Health Care","WBD":"Communication Services","WDAY":"Information Technology","WDC":"Information Technology","WEC":"Utilities","WELL":"Real Estate","WFC":"Financials","WM":"Industrials","WMB":"Energy","WMT":"Consumer Staples","WRB":"Financials","WSM":"Consumer Discretionary","WST":"Health Care","WTW":"Financials","WY":"Real Estate","WYNN":"Consumer Discretionary","XEL":"Utilities","XOM":"Energy","XYL":"Industrials","XYZ":"Financials","YUM":"Consumer Discretionary","ZBH":"Health Care","ZBRA":"Information Technology","ZTS":"Health Care","AA":"Materials","AAMI":"Financials","AAP":"Consumer Discretionary","AAT":"Real Estate","AAUC":"Materials","ABCB":"Financials","ABEV":"Consumer Staples","ABG":"Consumer Discretionary","ABM":"Industrials","ABR":"Real Estate","ABX":"Financials","ACA":"Industrials","ACCO":"Consumer Staples","ACEL":"Communication Services","ACHR":"Industrials","ACI":"Consumer Staples","ACM":"Industrials","ACR":"Real Estate","ACRE":"Real Estate","ACVA":"Industrials","AD":"Information Technology","ADC":"Real Estate","ADCT":"Health Care","ADNT":"Consumer Discretionary","ADT":"Industrials","AEG":"Financials","AEM":"Materials","AEO":"Consumer Discretionary","AER":"Industrials","AESI":"Energy","AEXA":"Financials","AFG":"Financials","AG":"Materials","AGCO":"Industrials","AGI":"Materials","AGL":"Health Care","AGM":"Financials","AGM.A":"Financials","AGO":"Financials","AGRO":"Consumer Staples","AGX":"Industrials","AHR":"Real Estate","AHT":"Real Estate","AI":"Information Technology","AII":"Financials","AIN":"Industrials","AIR":"Industrials","AIT":"Information Technology","AIV":"Real Estate","AKA":"Consumer Staples","AKO.A":"Consumer Staples","AKO.B":"Consumer Staples","AKR":"Real Estate","ALC":"Health Care","ALG":"Industrials","ALH":"Industrials","ALIT":"Industrials","ALK":"Industrials","ALLY":"Financials","ALSN":"Consumer Discretionary","ALTG":"Industrials","ALV":"Consumer Discretionary","ALX":"Real Estate","AM":"Energy","AMBP":"Materials","AMBQ":"Information Technology","AMC":"Communication Services","AMG":"Financials","AMH":"Consumer Discretionary","AMN":"Health Care","AMPX":"Information Technology","AMPY":"Energy","AMR":"Energy","AMRC":"Industrials","AMRZ":"Materials","AMTB":"Financials","AMTM":"Industrials","AMWL":"Health Care","AN":"Consumer Discretionary","ANF":"Consumer Discretionary","ANGX":"Communication Services","ANVS":"Health Care","AOMR":"Real Estate","AORT":"Health Care","AP":"Materials","APAM":"Financials","APG":"Industrials","APLE":"Real Estate","AQN":"Utilities","AR":"Energy","ARCO":"Consumer Discretionary","ARDT":"Health Care","ARI":"Real Estate","ARIS":"Materials","ARLO":"Information Technology","ARMK":"Consumer Discretionary","AROC":"Energy","ARR":"Real Estate","ARW":"Information Technology","ARX":"Financials","AS":"Consumer Discretionary","ASA":"Materials","ASAN":"Information Technology","ASB":"Financials","ASC":"Industrials","ASH":"Materials","ASIX":"Materials","ASPN":"Materials","ASX":"Information Technology","ATEN":"Information Technology","ATI":"Materials","ATKR":"Industrials","ATMU":"Information Technology","ATR":"Materials","AU":"Materials","AUB":"Financials","AUNA":"Health Care","AVA":"Utilities","AVD":"Materials","AVNS":"Health Care","AVNT":"Materials","AVTR":"Health Care","AWI":"Industrials","AWR":"Utilities","AX":"Financials","AXS":"Financials","AXTA":"Materials","AYI":"Industrials","AZN":"Health Care","AZZ":"Industrials","B":"Materials","BAH":"Information Technology","BALY":"Consumer Discretionary","BAM":"Financials","BANC":"Financials","BAP":"Financials","BARK":"Consumer Discretionary","BB":"Information Technology","BBAI":"Information Technology","BBAR":"Financials","BBBY":"Consumer Discretionary","BBDC":"Financials","BBUC":"Industrials","BBVA":"Financials","BBW":"Consumer Discretionary","BBWI":"Consumer Discretionary","BC":"Consumer Discretionary","BCC":"Materials","BCE":"Communication Services","BCO":"Industrials","BCS":"Financials","BCSF":"Financials","BDC":"Information Technology","BDN":"Real Estate","BE":"Energy","BEPC":"Utilities","BETA":"Information Technology","BF.A":"Consumer Staples","BF.B":"Consumer Staples","BFAM":"Consumer Discretionary","BFH":"Financials","BFLY":"Health Care","BFS":"Real Estate","BGS":"Consumer Staples","BGSF":"Industrials","BGSI":"Consumer Discretionary","BH":"Consumer Discretionary","BHC":"Health Care","BHE":"Information Technology","BHR":"Consumer Discretionary","BHVN":"Health Care","BILL":"Information Technology","BIO":"Health Care","BIO.B":"Health Care","BIP":"Utilities","BIPC":"Utilities","BIRK":"Consumer Discretionary","BJ":"Consumer Staples","BKD":"Health Care","BKE":"Consumer Discretionary","BKH":"Utilities","BKKT":"Financials","BKSY":"Information Technology","BKU":"Financials","BKV":"Energy","BLCO":"Health Care","BLND":"Information Technology","BLSH":"Financials","BLX":"Financials","BMA":"Financials","BMI":"Industrials","BMNR":"Information Technology","BMO":"Financials","BN":"Financials","BNED":"Consumer Discretionary","BNL":"Real Estate","BNS":"Financials","BNT":"Financials","BOBS":"Consumer Discretionary","BOC":"Financials","BOH":"Financials","BOOT":"Consumer Discretionary","BORR":"Energy","BOW":"Financials","BOX":"Information Technology","BP":"Energy","BRBR":"Consumer Staples","BRC":"Industrials","BRCC":"Consumer Staples","BRK.A":"Financials","BROS":"Consumer Discretionary","BRSL":"Consumer Discretionary","BRSP":"Real Estate","BRT":"Real Estate","BRX":"Real Estate","BSAC":"Financials","BSBR":"Financials","BTE":"Energy","BTU":"Energy","BUD":"Consumer Staples","BUR":"Financials","BURL":"Consumer Discretionary","BV":"Industrials","BVN":"Materials","BW":"Industrials","BWA":"Consumer Discretionary","BWLP":"Energy","BWMX":"Consumer Discretionary","BWXT":"Information Technology","BXC":"Industrials","BXMT":"Real Estate","BY":"Financials","BYD":"Consumer Discretionary","BZH":"Consumer Discretionary","CAAP":"Industrials","CABO":"Communication Services","CAL":"Consumer Discretionary","CALX":"Information Technology","CALY":"Consumer Discretionary","CANG":"Financials","CARS":"Communication Services","CATO":"Consumer Discretionary","CAVA":"Consumer Discretionary","CBAN":"Financials","CBNA":"Financials","CBT":"Materials","CBU":"Financials","CBZ":"Industrials","CC":"Materials","CCJ":"Materials","CCK":"Materials","CCM":"Health Care","CCO":"Communication Services","CCS":"Consumer Discretionary","CCU":"Consumer Staples","CDE":"Materials","CDP":"Industrials","CDRE":"Industrials","CE":"Materials","CFR":"Financials","CGAU":"Materials","CHCT":"Real Estate","CHE":"Health Care","CHGG":"Communication Services","CHH":"Consumer Discretionary","CHMI":"Real Estate","CHPT":"Information Technology","CHWY":"Consumer Discretionary","CIA":"Financials","CIM":"Financials","CINT":"Information Technology","CION":"Financials","CLB":"Energy","CLDT":"Real Estate","CLF":"Materials","CLH":"Industrials","CLPR":"Real Estate","CLS":"Information Technology","CLVT":"Information Technology","CLW":"Materials","CM":"Financials","CMC":"Materials","CMP":"Materials","CMRE":"Industrials","CMTG":"Real Estate","CNA":"Financials","CNC":"Health Care","CNH":"Industrials","CNI":"Industrials","CNK":"Communication Services","CNM":"Industrials","CNMD":"Health Care","CNNE":"Financials","CNO":"Financials","CNQ":"Energy","CNR":"Energy","CNS":"Financials","CNX":"Energy","CODI":"Industrials","COLD":"Real Estate","COMP":"Real Estate","CON":"Health Care","COSO":"Financials","COTY":"Consumer Staples","COUR":"Communication Services","CP":"Industrials","CPA":"Industrials","CPF":"Financials","CPK":"Utilities","CPNG":"Consumer Discretionary","CPRI":"Consumer Discretionary","CPS":"Consumer Discretionary","CR":"Industrials","CRBG":"Financials","CRC":"Energy","CRCL":"Financials","CRD.A":"Financials","CRD.B":"Financials","CRGY":"Energy","CRI":"Consumer Discretionary","CRK":"Energy","CRS":"Information Technology","CSL":"Industrials","CSR":"Real Estate","CSTM":"Materials","CSV":"Consumer Discretionary","CSW":"Industrials","CTO":"Real Estate","CTOS":"Industrials","CTRE":"Real Estate","CTRI":"Industrials","CTS":"Information Technology","CUBE":"Real Estate","CUBI":"Financials","CURB":"Real Estate","CURV":"Consumer Discretionary","CUZ":"Real Estate","CVE":"Energy","CVEO":"Industrials","CVI":"Energy","CVLG":"Industrials","CW":"Industrials","CWEN":"Energy","CWH":"Consumer Discretionary","CWK":"Real Estate","CWT":"Utilities","CX":"Materials","CXM":"Information Technology","CXT":"Industrials","CXW":"Industrials","CYD":"Industrials","CYH":"Health Care","DAC":"Industrials","DAN":"Consumer Discretionary","DAR":"Consumer Staples","DB":"Financials","DBD":"Information Technology","DBI":"Consumer Staples","DBRG":"Real Estate","DCI":"Industrials","DCO":"Industrials","DD":"Materials","DDD":"Information Technology","DDS":"Consumer Discretionary","DEA":"Real Estate","DEC":"Energy","DEI":"Real Estate","DEO":"Consumer Staples","DFH":"Consumer Discretionary","DFIN":"Industrials","DHT":"Energy","DHX":"Communication Services","DIN":"Consumer Staples","DINO":"Energy","DK":"Energy","DKS":"Consumer Discretionary","DLB":"Information Technology","DLX":"Industrials","DMC":"Consumer Staples","DNA":"Health Care","DNOW":"Energy","DOCN":"Information Technology","DOCS":"Health Care","DOLE":"Consumer Staples","DRD":"Materials","DSX":"Industrials","DT":"Information Technology","DTM":"Energy","DV":"Information Technology","DX":"Real Estate","DXC":"Information Technology","DXYZ":"Financials","DY":"Industrials","E":"Energy","EAF":"Materials","EARN":"Real Estate","EAT":"Consumer Discretionary","EBF":"Industrials","EBS":"Health Care","EC":"Energy","ECC":"Financials","ECG":"Industrials","ECVT":"Materials","EE":"Energy","EFC":"Real Estate","EGO":"Materials","EGP":"Real Estate","EGY":"Energy","EHC":"Health Care","EIC":"Financials","EIG":"Financials","ELAN":"Health Care","ELF":"Consumer Staples","ELME":"Real Estate","ELS":"Real Estate","EMA":"Utilities","EMN":"Materials","ENB":"Energy","ENOV":"Health Care","ENR":"Consumer Staples","ENS":"Industrials","ENVA":"Financials","EPAC":"Industrials","EPC":"Consumer Staples","EPR":"Real Estate","EPRT":"Real Estate","EQBK":"Financials","EQH":"Financials","ERO":"Materials","ESAB":"Industrials","ESE":"Information Technology","ESI":"Materials","ESNT":"Financials","ESRT":"Real Estate","ESTC":"Information Technology","ET":"Energy","ETD":"Consumer Discretionary","ETSY":"Consumer Discretionary","EVC":"Communication Services","EVEX":"Industrials","EVH":"Health Care","EVR":"Financials","EVTC":"Financials","EVTL":"Industrials","EXK":"Materials","EXP":"Materials","FAF":"Financials","FBIN":"Consumer Staples","FBK":"Financials","FBP":"Financials","FBRT":"Real Estate","FC":"Industrials","FCF":"Financials","FCN":"Industrials","FCPT":"Real Estate","FERG":"Industrials","FET":"Energy","FF":"Materials","FG":"Financials","FHI":"Financials","FHN":"Financials","FIG":"Information Technology","FIGS":"Consumer Discretionary","FLG":"Financials","FLO":"Consumer Staples","FLR":"Industrials","FLS":"Industrials","FLUT":"Communication Services","FMC":"Materials","FMS":"Health Care","FMX":"Consumer Staples","FN":"Information Technology","FNB":"Financials","FND":"Consumer Discretionary","FNF":"Financials","FNV":"Materials","FOA":"Financials","FOR":"Real Estate","FOUR":"Information Technology","FPH":"Real Estate","FPI":"Real Estate","FR":"Real Estate","FRO":"Energy","FSCO":"Financials","FSK":"Financials","FSM":"Materials","FSS":"Industrials","FTI":"Energy","FTK":"Energy","FTS":"Utilities","FUBO":"Communication Services","FUL":"Materials","FUN":"Communication Services","FVRR":"Information Technology","G":"Industrials","GAB":"Real Estate","GAP":"Consumer Discretionary","GATX":"Industrials","GBCI":"Financials","GBTG":"Industrials","GBX":"Industrials","GCO":"Consumer Discretionary","GDOT":"Financials","GEF":"Materials","GEF.B":"Materials","GENI":"Communication Services","GEO":"Industrials","GETY":"Communication Services","GFF":"Industrials","GFI":"Materials","GFL":"Industrials","GFR":"Energy","GGB":"Materials","GGG":"Industrials","GHC":"Communication Services","GHM":"Industrials","GIB":"Information Technology","GIC":"Industrials","GIL":"Consumer Discretionary","GKOS":"Health Care","GLAS":"Consumer Staples","GLOB":"Information Technology","GME":"Consumer Discretionary","GMED":"Health Care","GNE":"Energy","GNK":"Industrials","GNL":"Real Estate","GNW":"Financials","GOLF":"Consumer Discretionary","GOOS":"Consumer Discretionary","GPI":"Consumer Discretionary","GPK":"Materials","GPMT":"Real Estate","GPOR":"Energy","GPRK":"Energy","GRBK":"Consumer Discretionary","GRC":"Industrials","GRDN":"Health Care","GRND":"Communication Services","GRNT":"Energy","GROV":"Consumer Staples","GSBD":"Financials","GSL":"Industrials","GTES":"Industrials","GTN":"Communication Services","GTY":"Real Estate","GVA":"Industrials","GWH":"Industrials","GWRE":"Information Technology","GXO":"Industrials","H":"Consumer Discretionary","HAE":"Health Care","HAFN":"Industrials","HASI":"Financials","HAWK":"Information Technology","HAYW":"Industrials","HBB":"Consumer Staples","HBM":"Materials","HCC":"Energy","HCI":"Financials","HDB":"Financials","HE":"Utilities","HEI":"Industrials","HEI.A":"Industrials","HESM":"Energy","HG":"Financials","HGTY":"Financials","HGV":"Consumer Discretionary","HHH":"Real Estate","HIMS":"Health Care","HIPO":"Financials","HIW":"Real Estate","HL":"Materials","HLF":"Consumer Staples","HLI":"Financials","HLIO":"Information Technology","HLLY":"Consumer Discretionary","HLX":"Energy","HMC":"Consumer Discretionary","HMN":"Financials","HMY":"Materials","HNGE":"Health Care","HNI":"Industrials","HOG":"Consumer Discretionary","HOMB":"Financials","HOV":"Consumer Discretionary","HP":"Energy","HPP":"Real Estate","HQH":"Health Care","HQL":"Financials","HR":"Real Estate","HRB":"Consumer Discretionary","HRI":"Industrials","HRTG":"Financials","HSBC":"Financials","HSHP":"Industrials","HTB":"Financials","HTGC":"Financials","HTH":"Financials","HUBS":"Information Technology","HUN":"Materials","HUYA":"Communication Services","HVT":"Consumer Discretionary","HVT.A":"Consumer Discretionary","HXL":"Industrials","HY":"Industrials","HZO":"Consumer Discretionary","IAG":"Materials","IBN":"Financials","IBP":"Industrials","IBTA":"Communication Services","ICL":"Materials","IDA":"Utilities","IDT":"Communication Services","IFS":"Financials","IHG":"Consumer Discretionary","IHS":"Real Estate","IIIN":"Materials","IIPR":"Industrials","IMAX":"Communication Services","INFQ":"Information Technology","INGM":"Information Technology","INGR":"Consumer Staples","INN":"Real Estate","INR":"Energy","INSP":"Health Care","INSW":"Energy","INVX":"Energy","IONQ":"Information Technology","IOT":"Information Technology","IPI":"Materials","IRT":"Real Estate","ITGR":"Health Care","ITT":"Industrials","IVR":"Real Estate","IVT":"Real Estate","JAN":"Real Estate","JBGS":"Real Estate","JBI":"Industrials","JBS":"Consumer Staples","JBTM":"Industrials","JEF":"Financials","JELD":"Industrials","JHX":"Materials","JILL":"Consumer Discretionary","JKS":"Information Technology","JLL":"Real Estate","JMIA":"Information Technology","JOBY":"Industrials","JOE":"Real Estate","JXN":"Financials","KAI":"Industrials","KB":"Financials","KBH":"Consumer Discretionary","KBR":"Industrials","KD":"Information Technology","KEN":"Financials","KEP":"Utilities","KEX":"Industrials","KFRC":"Industrials","KFY":"Industrials","KGC":"Materials","KGS":"Energy","KLAR":"Financials","KLC":"Consumer Discretionary","KMPR":"Financials","KMT":"Industrials","KMX":"Consumer Discretionary","KN":"Information Technology","KNF":"Materials","KNSL":"Financials","KNTK":"Energy","KNX":"Industrials","KODK":"Information Technology","KOF":"Consumer Staples","KOP":"Materials","KOS":"Energy","KRC":"Real Estate","KREF":"Real Estate","KRG":"Real Estate","KRMN":"Industrials","KRO":"Materials","KSS":"Consumer Discretionary","KT":"Communication Services","KTB":"Consumer Staples","KVYO":"Information Technology","KWR":"Materials","KWY":"Financials","LAC":"Materials","LAD":"Consumer Discretionary","LADR":"Financials","LANV":"Consumer Discretionary","LAR":"Materials","LAW":"Information Technology","LAZ":"Financials","LB":"Energy","LBRT":"Energy","LCII":"Consumer Discretionary","LCLN":"Financials","LEA":"Consumer Discretionary","LEN.B":"Consumer Discretionary","LEO":"Financials","LEU":"Energy","LEVI":"Consumer Discretionary","LFT":"Real Estate","LION":"Communication Services","LMND":"Financials","LNC":"Financials","LNG":"Energy","LNN":"Industrials","LOAR":"Industrials","LOB":"Financials","LOCL":"Consumer Staples","LPG":"Energy","LPL":"Information Technology","LPX":"Materials","LRN":"Communication Services","LSPD":"Information Technology","LTC":"Real Estate","LTH":"Consumer Discretionary","LUCK":"Communication Services","LUMN":"Information Technology","LVWR":"Consumer Discretionary","LW":"Consumer Staples","LXFR":"Materials","LXP":"Real Estate","LXU":"Materials","LYG":"Financials","LZB":"Consumer Discretionary","LZM":"Materials","M":"Consumer Discretionary","MAC":"Real Estate","MAGN":"Materials","MAIN":"Financials","MAN":"Industrials","MANE":"Health Care","MANU":"Communication Services","MATV":"Materials","MATX":"Industrials","MAX":"Communication Services","MBC":"Industrials","MBI":"Financials","MC":"Financials","MCB":"Financials","MCS":"Communication Services","MCY":"Financials","MD":"Health Care","MDU":"Utilities","MDV":"Industrials","MEC":"Industrials","MED":"Consumer Staples","MEI":"Information Technology","MFA":"Real Estate","MFAN":"Real Estate","MFC":"Financials","MG":"Industrials","MGA":"Consumer Discretionary","MGY":"Energy","MHK":"Consumer Discretionary","MHLA":"Financials","MHO":"Consumer Discretionary","MIR":"Information Technology","MITT":"Real Estate","MKC.V":"Consumer Staples","MKL":"Financials","MLI":"Industrials","MLR":"Industrials","MMS":"Industrials","MOD":"Industrials","MOG.A":"Industrials","MOG.B":"Industrials","MOH":"Health Care","MOV":"Consumer Discretionary","MP":"Materials","MPT":"Real Estate","MRP":"Real Estate","MRSH":"Financials","MSA":"Industrials","MSGE":"Communication Services","MSGS":"Communication Services","MSM":"Industrials","MT":"Materials","MTDR":"Energy","MTG":"Financials","MTH":"Consumer Discretionary","MTN":"Consumer Discretionary","MTRN":"Materials","MTUS":"Materials","MTW":"Industrials","MTX":"Information Technology","MTZ":"Industrials","MUFG":"Financials","MUR":"Energy","MUSA":"Consumer Discretionary","MUX":"Materials","MVO":"Real Estate","MWA":"Industrials","MX":"Information Technology","MYE":"Materials","NABL":"Information Technology","NAT":"Energy","NATL":"Information Technology","NBHC":"Financials","NBR":"Energy","NC":"Energy","NCDL":"Financials","NE":"Energy","NET":"Information Technology","NEU":"Materials","NEXA":"Materials","NFG":"Energy","NGG":"Utilities","NGS":"Energy","NGVC":"Consumer Staples","NGVT":"Materials","NHI":"Health Care","NIC":"Financials","NJR":"Utilities","NLOP":"Real Estate","NLY":"Real Estate","NMAX":"Communication Services","NMG":"Materials","NMR":"Financials","NNI":"Financials","NNN":"Real Estate","NOA":"Industrials","NOG":"Energy","NOK":"Information Technology","NOMD":"Consumer Staples","NOV":"Energy","NP":"Financials","NPB":"Financials","NPK":"Consumer Discretionary","NPKI":"Energy","NPO":"Industrials","NPWR":"Utilities","NRDY":"Communication Services","NREF":"Real Estate","NRGV":"Energy","NSP":"Industrials","NTB":"Financials","NTR":"Materials","NTST":"Real Estate","NTZ":"Consumer Discretionary","NU":"Financials","NUS":"Consumer Staples","NUVB":"Health Care","NVGS":"Energy","NVO":"Health Care","NVRI":"Industrials","NVS":"Health Care","NVST":"Health Care","NVT":"Utilities","NWN":"Utilities","NX":"Industrials","NXDR":"Communication Services","NXE":"Energy","NXRT":"Real Estate","NYC":"Real Estate","NYT":"Communication Services","OBDC":"Financials","OBK":"Financials","OC":"Materials","ODC":"Energy","OEC":"Materials","OFG":"Financials","OGC":"Materials","OGE":"Energy","OGN":"Health Care","OGS":"Energy","OHI":"Health Care","OI":"Materials","OII":"Energy","OIS":"Energy","OKLO":"Utilities","OLN":"Materials","OLP":"Real Estate","OMF":"Financials","ONIT":"Financials","ONL":"Real Estate","ONON":"Consumer Discretionary","ONTO":"Information Technology","OOMA":"Information Technology","OPAD":"Real Estate","OPFI":"Financials","OPLN":"Industrials","OPY":"Financials","OR":"Materials","ORA":"Information Technology","ORC":"Real Estate","ORI":"Financials","ORN":"Industrials","OSCR":"Health Care","OSK":"Industrials","OUT":"Communication Services","OVV":"Energy","OWL":"Financials","OWLT":"Consumer Discretionary","OXM":"Consumer Discretionary","PAAS":"Materials","PAC":"Industrials","PACK":"Materials","PACS":"Health Care","PAG":"Consumer Discretionary","PAGS":"Information Technology","PAM":"Utilities","PAR":"Information Technology","PARR":"Energy","PATH":"Information Technology","PAY":"Information Technology","PAYC":"Information Technology","PB":"Financials","PBA":"Energy","PBF":"Energy","PBH":"Health Care","PBI":"Industrials","PBR":"Energy","PBR.A":"Energy","PCOR":"Information Technology","PD":"Information Technology","PDM":"Real Estate","PEB":"Real Estate","PEN":"Health Care","PERF":"Information Technology","PFGC":"Consumer Staples","PFLT":"Financials","PFS":"Financials","PFSI":"Financials","PHG":"Health Care","PHI":"Communication Services","PHIN":"Consumer Discretionary","PHR":"Health Care","PII":"Consumer Discretionary","PINE":"Real Estate","PINS":"Communication Services","PIPR":"Financials","PJT":"Financials","PK":"Consumer Discretionary","PKE":"Industrials","PL":"Information Technology","PLNT":"Consumer Discretionary","PLOW":"Industrials","PMT":"Real Estate","PNFP":"Financials","POR":"Utilities","POST":"Consumer Staples","PR":"Energy","PRG":"Consumer Discretionary","PRGO":"Health Care","PRI":"Financials","PRIM":"Industrials","PRKS":"Consumer Discretionary","PRLB":"Industrials","PRM":"Materials","PRMB":"Consumer Staples","PS":"Financials","PSBD":"Financials","PSFE":"Financials","PSN":"Industrials","PSO":"Communication Services","PSTL":"Real Estate","PSUS":"Financials","PUK":"Financials","PUMP":"Energy","PVH":"Consumer Discretionary","QBTS":"Information Technology","QGEN":"Health Care","QSR":"Consumer Staples","QTWO":"Information Technology","QUAD":"Industrials","QXO":"Industrials","R":"Industrials","RACE":"Consumer Discretionary","RAL":"Industrials","RAMP":"Information Technology","RBA":"Industrials","RBC":"Industrials","RBLX":"Communication Services","RBRK":"Information Technology","RC":"Real Estate","RCI":"Communication Services","RCUS":"Health Care","RDDT":"Communication Services","RDN":"Financials","RDW":"Industrials","RELX":"Industrials","RES":"Energy","REX":"Consumer Staples","REXR":"Real Estate","REZI":"Information Technology","RGA":"Financials","RGR":"Consumer Discretionary","RH":"Consumer Discretionary","RHI":"Industrials","RHP":"Real Estate","RIG":"Energy","RIO":"Materials","RITM":"Financials","RKT":"Financials","RLI":"Financials","RLJ":"Real Estate","RMAX":"Real Estate","RNG":"Information Technology","RNGR":"Energy","RNR":"Financials","RNST":"Financials","ROG":"Materials","RPM":"Materials","RRC":"Energy","RRX":"Industrials","RS":"Materials","RSI":"Consumer Discretionary","RSKD":"Information Technology","RVLV":"Consumer Discretionary","RWT":"Real Estate","RXO":"Industrials","RY":"Financials","RYAM":"Materials","RYAN":"Financials","RYN":"Real Estate","RYZ":"Materials","S":"Information Technology","SA":"Materials","SAFE":"Real Estate","SAH":"Consumer Discretionary","SAM":"Consumer Staples","SAN":"Financials","SAP":"Information Technology","SARO":"Industrials","SB":"Industrials","SBH":"Consumer Staples","SBS":"Utilities","SBSI":"Financials","SCCO":"Materials","SCI":"Consumer Discretionary","SCL":"Materials","SCM":"Financials","SD":"Energy","SDHC":"Consumer Discretionary","SDRL":"Energy","SEG":"Communication Services","SEI":"Energy","SES":"Industrials","SF":"Financials","SFBS":"Financials","SFL":"Industrials","SG":"Consumer Discretionary","SGHC":"Consumer Discretionary","SGI":"Consumer Discretionary","SHG":"Financials","SHO":"Real Estate","SI":"Health Care","SID":"Materials","SIG":"Consumer Discretionary","SII":"Financials","SITC":"Real Estate","SITE":"Industrials","SKE":"Materials","SKT":"Real Estate","SKY":"Consumer Discretionary","SKYH":"Industrials","SLF":"Financials","SLG":"Real Estate","SLGN":"Materials","SLQT":"Financials","SLVM":"Materials","SM":"Energy","SMA":"Real Estate","SMBK":"Financials","SMC":"Energy","SMG":"Consumer Staples","SMHI":"Industrials","SMP":"Consumer Discretionary","SMR":"Utilities","SMRT":"Information Technology","SMWB":"Information Technology","SN":"Consumer Discretionary","SNAP":"Communication Services","SNDA":"Health Care","SNDR":"Industrials","SNN":"Health Care","SNOW":"Information Technology","SNX":"Information Technology","SOBO":"Energy","SOC":"Energy","SON":"Materials","SOR":"Financials","SPB":"Consumer Staples","SPCE":"Industrials","SPHR":"Communication Services","SPIR":"Information Technology","SPMC":"Financials","SPNT":"Financials","SPOT":"Information Technology","SPRU":"Utilities","SPXC":"Information Technology","SQM":"Materials","SR":"Utilities","SRFM":"Industrials","SRG":"Real Estate","SRI":"Consumer Discretionary","SRL":"Materials","SSB":"Financials","SSD":"Industrials","SSL":"Energy","SST":"Communication Services","SSTK":"Communication Services","ST":"Information Technology","STAG":"Industrials","STC":"Financials","STEM":"Utilities","STLA":"Consumer Discretionary","STM":"Information Technology","STN":"Industrials","STNG":"Industrials","STUB":"Consumer Discretionary","STWD":"Real Estate","SU":"Energy","SUI":"Real Estate","SUNB":"Industrials","SUPV":"Financials","SVV":"Consumer Discretionary","SWX":"Energy","SXC":"Energy","SXI":"Industrials","SXT":"Information Technology","TAC":"Utilities","TAL":"Communication Services","TALO":"Energy","TAP.A":"Consumer Staples","TBBB":"Consumer Staples","TBI":"Industrials","TCBX":"Financials","TCI":"Real Estate","TD":"Financials","TDAY":"Communication Services","TDC":"Information Technology","TDOC":"Health Care","TDS":"Information Technology","TDW":"Energy","TE":"Energy","TECK":"Materials","TEN":"Energy","TEO":"Communication Services","TEX":"Industrials","TFII":"Industrials","TFIN":"Financials","TFPM":"Materials","TFX":"Health Care","TG":"Materials","TGLS":"Materials","TGS":"Energy","THC":"Health Care","THG":"Financials","THO":"Consumer Discretionary","TISI":"Industrials","TK":"Energy","TKC":"Communication Services","TKR":"Industrials","TLK":"Communication Services","TLYS":"Consumer Discretionary","TNC":"Industrials","TNET":"Industrials","TNK":"Industrials","TNL":"Consumer Discretionary","TOL":"Consumer Discretionary","TOST":"Information Technology","TPB":"Consumer Staples","TPC":"Industrials","TR":"Consumer Staples","TRC":"Real Estate","TREX":"Materials","TRLV":"Health Care","TRN":"Industrials","TRNO":"Real Estate","TROX":"Materials","TRP":"Energy","TRTX":"Real Estate","TRU":"Industrials","TS":"Materials","TSLX":"Financials","TSM":"Information Technology","TTAM":"Materials","TTC":"Industrials","TTE":"Energy","TTI":"Information Technology","TU":"Communication Services","TV":"Communication Services","TWI":"Industrials","TWLO":"Information Technology","TWO":"Financials","TXNM":"Energy","TYG":"Energy","U":"Information Technology","UA":"Consumer Discretionary","UAA":"Consumer Discretionary","UAMY":"Materials","UBS":"Financials","UCB":"Financials","UE":"Real Estate","UFI":"Consumer Discretionary","UGI":"Utilities","UGP":"Energy","UHAL":"Industrials","UI":"Information Technology","UIS":"Information Technology","UL":"Consumer Staples","ULS":"Industrials","UMC":"Information Technology","UMH":"Real Estate","UNF":"Industrials","UNFI":"Consumer Staples","UNM":"Financials","UP":"Industrials","USFD":"Consumer Staples","USNA":"Health Care","USPH":"Health Care","UTI":"Communication Services","UTL":"Utilities","UTZ":"Consumer Staples","UVE":"Financials","UVV":"Consumer Staples","UWMC":"Financials","VAC":"Consumer Discretionary","VAL":"Energy","VALE":"Materials","VEL":"Real Estate","VET":"Energy","VFC":"Consumer Discretionary","VG":"Energy","VHI":"Materials","VIA":"Industrials","VIK":"Consumer Discretionary","VIPS":"Consumer Discretionary","VIRT":"Financials","VIST":"Energy","VLN":"Information Technology","VLRS":"Industrials","VMI":"Industrials","VNO":"Real Estate","VNT":"Industrials","VOYA":"Financials","VOYG":"Information Technology","VPG":"Information Technology","VRTS":"Financials","VSH":"Information Technology","VSTS":"Industrials","VTEX":"Information Technology","VTOL":"Industrials","VTS":"Energy","VVV":"Consumer Discretionary","VVX":"Industrials","VYX":"Information Technology","W":"Consumer Discretionary","WAL":"Financials","WBS":"Financials","WCC":"Industrials","WCN":"Industrials","WD":"Real Estate","WEAV":"Communication Services","WEX":"Financials","WFG":"Materials","WGO":"Consumer Discretionary","WH":"Consumer Discretionary","WHD":"Energy","WHG":"Financials","WHR":"Consumer Discretionary","WIT":"Information Technology","WK":"Information Technology","WKC":"Energy","WLK":"Materials","WLY":"Communication Services","WLYB":"Communication Services","WMK":"Consumer Staples","WMS":"Industrials","WNC":"Industrials","WOLF":"Information Technology","WOR":"Materials","WPC":"Real Estate","WPM":"Materials","WPP":"Communication Services","WRBY":"Consumer Discretionary","WS":"Materials","WSO":"Industrials","WSO.B":"Industrials","WT":"Financials","WTI":"Energy","WTM":"Financials","WTRG":"Utilities","WTS":"Information Technology","WTTR":"Energy","WU":"Financials","WWW":"Consumer Discretionary","XHR":"Consumer Discretionary","XPER":"Information Technology","XPO":"Industrials","XPOF":"Consumer Discretionary","XPRO":"Energy","YELP":"Communication Services","YETI":"Consumer Discretionary","YEXT":"Information Technology","YOU":"Information Technology","YPF":"Energy","YUMC":"Consumer Discretionary","ZETA":"Information Technology","ZGN":"Consumer Discretionary","ZIM":"Industrials","ZIP":"Industrials","ZVIA":"Consumer Staples","ZWS":"Industrials"};

function getSector(symbol) {
  return SECTOR_MAP[symbol] || 'Unknown';
}

const COMPANY_NAMES = {"A":"Agilent Technologies","AAPL":"Apple","ABBV":"AbbVie","ABNB":"Airbnb","ABT":"Abbott Laboratories","ACGL":"Arch Capital Group","ACN":"Accenture","ADBE":"Adobe","ADI":"Analog Devices","ADM":"Archer-Daniels-Midland","ADP":"Automatic Data Processing","ADSK":"Autodesk","AEE":"Ameren","AEP":"American Electric Power","AES":"AES Corporation","AFL":"Aflac","AIG":"American International Group","AIZ":"Assurant","AJG":"Arthur J. Gallagher","AKAM":"Akamai Technologies","ALB":"Albemarle","ALGN":"Align Technology","ALL":"Allstate","ALLE":"Allegion","AMAT":"Applied Materials","AMCR":"Amcor","AMD":"Advanced Micro Devices","AME":"AMETEK","AMGN":"Amgen","AMP":"Ameriprise Financial","AMT":"American Tower","AMZN":"Amazon","ANET":"Arista Networks","AON":"Aon","AOS":"A. O. Smith","APA":"APA Corporation","APD":"Air Products and Chemicals","APH":"Amphenol","APO":"Apollo Global Management","APP":"AppLovin","APTV":"Aptiv","ARE":"Alexandria Real Estate Equities","ARES":"Ares Management","ATO":"Atmos Energy","AVB":"AvalonBay Communities","AVGO":"Broadcom","AVY":"Avery Dennison","AWK":"American Water Works","AXON":"Axon Enterprise","AXP":"American Express","AZO":"AutoZone","BA":"Boeing","BAC":"Bank of America","BALL":"Ball Corporation","BAX":"Baxter International","BBY":"Best Buy","BDX":"Becton Dickinson","BEN":"Franklin Resources","BG":"Bunge Global","BIIB":"Biogen","BK":"Bank of New York Mellon","BKNG":"Booking Holdings","BKR":"Baker Hughes","BLDR":"Builders FirstSource","BLK":"BlackRock","BMY":"Bristol-Myers Squibb","BNY":"Bank of New York Mellon","BR":"Broadridge Financial Solutions","BRK.B":"Berkshire Hathaway","BRO":"Brown & Brown","BSX":"Boston Scientific","BX":"Blackstone","BXP":"BXP, Inc.","C":"Citigroup","CAG":"Conagra Brands","CAH":"Cardinal Health","CARR":"Carrier Global","CASY":"Casey's General Stores","CAT":"Caterpillar","CB":"Chubb","CBOE":"Cboe Global Markets","CBRE":"CBRE Group","CCI":"Crown Castle","CCL":"Carnival Corporation","CDNS":"Cadence Design Systems","CDW":"CDW Corporation","CEG":"Constellation Energy","CF":"CF Industries","CFG":"Citizens Financial Group","CHD":"Church & Dwight","CHRW":"C.H. Robinson","CHTR":"Charter Communications","CI":"Cigna","CIEN":"Ciena Corporation","CINF":"Cincinnati Financial","CL":"Colgate-Palmolive","CLX":"Clorox","CMCSA":"Comcast","CME":"CME Group","CMG":"Chipotle Mexican Grill","CMI":"Cummins","CMS":"CMS Energy","CNP":"CenterPoint Energy","COF":"Capital One","COHR":"Coherent Corp","COIN":"Coinbase Global","COO":"Cooper Companies","COP":"ConocoPhillips","COR":"Cencora","COST":"Costco Wholesale","CPAY":"Corpay","CPB":"Campbell's Company","CPRT":"Copart","CPT":"Camden Property Trust","CRH":"CRH plc","CRL":"Charles River Laboratories","CRM":"Salesforce","CRWD":"CrowdStrike","CSCO":"Cisco Systems","CSGP":"CoStar Group","CSX":"CSX Corporation","CTAS":"Cintas","CTSH":"Cognizant Technology Solutions","CTVA":"Corteva","CVNA":"Carvana","CVS":"CVS Health","CVX":"Chevron","D":"Dominion Energy","DAL":"Delta Air Lines","DASH":"DoorDash","DDOG":"Datadog","DE":"Deere & Company","DECK":"Deckers Brands","DELL":"Dell Technologies","DG":"Dollar General","DGX":"Quest Diagnostics","DHI":"D.R. Horton","DHR":"Danaher","DIS":"Walt Disney Company","DLR":"Digital Realty Trust","DLTR":"Dollar Tree","DOC":"Healthpeak Properties","DOV":"Dover Corporation","DOW":"Dow Inc.","DPZ":"Domino's Pizza","DRI":"Darden Restaurants","DTE":"DTE Energy","DUK":"Duke Energy","DVA":"DaVita","DVN":"Devon Energy","EA":"Electronic Arts","EBAY":"eBay","ECL":"Ecolab","ED":"Consolidated Edison","EFX":"Equifax","EG":"Everest Group","EIX":"Edison International","EL":"Est\u00e9e Lauder Companies","ELV":"Elevance Health","EME":"EMCOR Group","EMR":"Emerson Electric","EOG":"EOG Resources","EPAM":"EPAM Systems","EQIX":"Equinix","EQR":"Equity Residential","EQT":"EQT Corporation","ERIE":"Erie Indemnity","ES":"Eversource Energy","ESS":"Essex Property Trust","ETN":"Eaton Corporation","ETR":"Entergy","EVRG":"Evergy","EW":"Edwards Lifesciences","EXC":"Exelon","EXE":"Expand Energy","EXPD":"Expeditors International","EXPE":"Expedia Group","EXR":"Extra Space Storage","F":"Ford Motor Company","FANG":"Diamondback Energy","FAST":"Fastenal","FCX":"Freeport-McMoRan","FDS":"FactSet Research Systems","FDX":"FedEx","FE":"FirstEnergy","FFIV":"F5, Inc.","FICO":"Fair Isaac Corporation","FIS":"Fidelity National Information Services","FITB":"Fifth Third Bancorp","FIX":"Comfort Systems USA","FOX":"Fox Corporation","FOXA":"Fox Corporation","FRT":"Federal Realty Investment Trust","FSLR":"First Solar","FTNT":"Fortinet","FTV":"Fortive","GD":"General Dynamics","GDDY":"GoDaddy","GE":"GE Aerospace","GEHC":"GE HealthCare","GEN":"Gen Digital","GEV":"GE Vernova","GILD":"Gilead Sciences","GIS":"General Mills","GL":"Globe Life","GLW":"Corning","GM":"General Motors","GNRC":"Generac Holdings","GOOG":"Alphabet","GOOGL":"Alphabet","GPC":"Genuine Parts Company","GPN":"Global Payments","GRMN":"Garmin","GS":"Goldman Sachs","GWW":"W.W. Grainger","HAL":"Halliburton","HAS":"Hasbro","HBAN":"Huntington Bancshares","HCA":"HCA Healthcare","HD":"Home Depot","HIG":"Hartford Financial Services","HII":"Huntington Ingalls Industries","HLT":"Hilton Worldwide","HON":"Honeywell","HOOD":"Robinhood Markets","HPE":"Hewlett Packard Enterprise","HPQ":"HP Inc.","HRL":"Hormel Foods","HSIC":"Henry Schein","HST":"Host Hotels & Resorts","HSY":"Hershey Company","HUBB":"Hubbell","HUM":"Humana","HWM":"Howmet Aerospace","IBKR":"Interactive Brokers","IBM":"IBM","ICE":"Intercontinental Exchange","IDXX":"IDEXX Laboratories","IEX":"IDEX Corporation","IFF":"International Flavors & Fragrances","INCY":"Incyte","INTC":"Intel","INTU":"Intuit","INVH":"Invitation Homes","IP":"International Paper","IQV":"IQVIA Holdings","IR":"Ingersoll Rand","IRM":"Iron Mountain","ISRG":"Intuitive Surgical","IT":"Gartner","ITW":"Illinois Tool Works","IVZ":"Invesco","J":"Jacobs Solutions","JBHT":"J.B. Hunt Transport","JBL":"Jabil","JCI":"Johnson Controls","JKHY":"Jack Henry & Associates","JNJ":"Johnson & Johnson","JPM":"JPMorgan Chase","KDP":"Keurig Dr Pepper","KEY":"KeyCorp","KEYS":"Keysight Technologies","KHC":"Kraft Heinz","KIM":"Kimco Realty","KKR":"KKR & Co.","KMB":"Kimberly-Clark","KMI":"Kinder Morgan","KO":"Coca-Cola Company","KR":"Kroger","KVUE":"Kenvue","L":"Loews Corporation","LDOS":"Leidos","LEN":"Lennar","LH":"LabCorp","LHX":"L3Harris Technologies","LII":"Lennox International","LIN":"Linde plc","LITE":"Lumentum Holdings","LLY":"Eli Lilly and Company","LMT":"Lockheed Martin","LNT":"Alliant Energy","LOW":"Lowe's Companies","LRCX":"Lam Research","LULU":"Lululemon Athletica","LUV":"Southwest Airlines","LVS":"Las Vegas Sands","LYB":"LyondellBasell Industries","LYV":"Live Nation Entertainment","MA":"Mastercard","MAA":"Mid-America Apartment Communities","MAR":"Marriott International","MAS":"Masco","MCD":"McDonald's","MCHP":"Microchip Technology","MCK":"McKesson Corporation","MCO":"Moody's Corporation","MDLZ":"Mondelez International","MDT":"Medtronic","MET":"MetLife","META":"Meta Platforms","MGM":"MGM Resorts International","MKC":"McCormick & Company","MLM":"Martin Marietta Materials","MMC":"Marsh McLennan","MMM":"3M","MNST":"Monster Beverage","MO":"Altria Group","MOS":"Mosaic Company","MPC":"Marathon Petroleum","MPWR":"Monolithic Power Systems","MRK":"Merck & Co.","MRNA":"Moderna","MS":"Morgan Stanley","MSCI":"MSCI Inc.","MSFT":"Microsoft","MSI":"Motorola Solutions","MTB":"M&T Bank","MTD":"Mettler-Toledo","MU":"Micron Technology","NCLH":"Norwegian Cruise Line Holdings","NDAQ":"Nasdaq, Inc.","NDSN":"Nordson Corporation","NEE":"NextEra Energy","NEM":"Newmont Corporation","NFLX":"Netflix","NI":"NiSource","NKE":"Nike","NOC":"Northrop Grumman","NOW":"ServiceNow","NRG":"NRG Energy","NSC":"Norfolk Southern","NTAP":"NetApp","NTRS":"Northern Trust","NUE":"Nucor","NVDA":"NVIDIA","NVR":"NVR, Inc.","NWS":"News Corp","NWSA":"News Corp","NXPI":"NXP Semiconductors","O":"Realty Income","ODFL":"Old Dominion Freight Line","OKE":"ONEOK","OMC":"Omnicom Group","ON":"ON Semiconductor","ORCL":"Oracle Corporation","ORLY":"O'Reilly Automotive","OTIS":"Otis Worldwide","OXY":"Occidental Petroleum","PANW":"Palo Alto Networks","PAYX":"Paychex","PCAR":"PACCAR","PCG":"PG&E Corporation","PEG":"Public Service Enterprise Group","PEP":"PepsiCo","PFE":"Pfizer","PFG":"Principal Financial Group","PG":"Procter & Gamble","PGR":"Progressive Corporation","PH":"Parker Hannifin","PHM":"PulteGroup","PKG":"Packaging Corporation of America","PLD":"Prologis","PLTR":"Palantir Technologies","PM":"Philip Morris International","PNC":"PNC Financial Services","PNR":"Pentair","PNW":"Pinnacle West Capital","PODD":"Insulet Corporation","POOL":"Pool Corporation","PPG":"PPG Industries","PPL":"PPL Corporation","PRU":"Prudential Financial","PSA":"Public Storage","PSKY":"Paramount Skydance","PSX":"Phillips 66","PTC":"PTC Inc.","PWR":"Quanta Services","PYPL":"PayPal Holdings","Q":"Q (name unverified)","QCOM":"Qualcomm","RCL":"Royal Caribbean Group","REG":"Regency Centers","REGN":"Regeneron Pharmaceuticals","RF":"Regions Financial","RJF":"Raymond James Financial","RL":"Ralph Lauren Corporation","RMD":"ResMed","ROK":"Rockwell Automation","ROL":"Rollins, Inc.","ROP":"Roper Technologies","ROST":"Ross Stores","RSG":"Republic Services","RTX":"RTX Corporation","RVTY":"Revvity","SBAC":"SBA Communications","SBUX":"Starbucks","SCHW":"Charles Schwab Corporation","SHW":"Sherwin-Williams","SJM":"J.M. Smucker Company","SLB":"SLB","SMCI":"Super Micro Computer","SNA":"Snap-on","SNDK":"SanDisk","SNPS":"Synopsys","SO":"Southern Company","SOLV":"Solventum","SPG":"Simon Property Group","SPGI":"S&P Global","SRE":"Sempra","STE":"Steris","STLD":"Steel Dynamics","STT":"State Street Corporation","STX":"Seagate Technology","STZ":"Constellation Brands","SW":"Smurfit Westrock","SWK":"Stanley Black & Decker","SWKS":"Skyworks Solutions","SYF":"Synchrony Financial","SYK":"Stryker Corporation","SYY":"Sysco","T":"AT&T","TAP":"Molson Coors Beverage Company","TDG":"TransDigm Group","TDY":"Teledyne Technologies","TECH":"Bio-Techne","TEL":"TE Connectivity","TER":"Teradyne","TFC":"Truist Financial","TGT":"Target Corporation","TJX":"TJX Companies","TKO":"TKO Group Holdings","TMO":"Thermo Fisher Scientific","TMUS":"T-Mobile US","TPL":"Texas Pacific Land Corporation","TPR":"Tapestry, Inc.","TRGP":"Targa Resources","TRMB":"Trimble Inc.","TROW":"T. Rowe Price","TRV":"Travelers Companies","TSCO":"Tractor Supply Company","TSLA":"Tesla","TSN":"Tyson Foods","TT":"Trane Technologies","TTD":"The Trade Desk","TTWO":"Take-Two Interactive","TXN":"Texas Instruments","TXT":"Textron","TYL":"Tyler Technologies","UAL":"United Airlines Holdings","UBER":"Uber Technologies","UDR":"UDR, Inc.","UHS":"Universal Health Services","ULTA":"Ulta Beauty","UNH":"UnitedHealth Group","UNP":"Union Pacific Corporation","UPS":"United Parcel Service","URI":"United Rentals","USB":"U.S. Bancorp","V":"Visa Inc.","VEEV":"Veeva Systems","VICI":"VICI Properties","VLO":"Valero Energy","VLTO":"Veralto","VMC":"Vulcan Materials Company","VRSK":"Verisk Analytics","VRSN":"VeriSign","VRT":"Vertiv Holdings","VRTX":"Vertex Pharmaceuticals","VST":"Vistra Corp","VTR":"Ventas","VTRS":"Viatris","VZ":"Verizon Communications","WAB":"Westinghouse Air Brake Technologies","WAT":"Waters Corporation","WBD":"Warner Bros. Discovery","WDAY":"Workday","WDC":"Western Digital","WEC":"WEC Energy Group","WELL":"Welltower","WFC":"Wells Fargo","WM":"Waste Management","WMB":"Williams Companies","WMT":"Walmart","WRB":"W. R. Berkley Corporation","WSM":"Williams-Sonoma","WST":"West Pharmaceutical Services","WTW":"Willis Towers Watson","WY":"Weyerhaeuser","WYNN":"Wynn Resorts","XEL":"Xcel Energy","XOM":"ExxonMobil","XYL":"Xylem Inc.","XYZ":"Block, Inc.","YUM":"Yum! Brands","ZBH":"Zimmer Biomet","ZBRA":"Zebra Technologies","ZTS":"Zoetis","AA":"Alcoa Corporation","AAMI":"Acadian Asset Management Inc.","AAP":"ADVANCE AUTO PARTS INC","AAT":"AMERICAN ASSETS TRUST, INC.","AAUC":"Allied Gold Corporation","ABCB":"Ameris Bancorp","ABEV":"AMBEV S.A.","ABG":"Asbury Automotive Group, Inc.","ABM":"ABM Industries, Inc.","ABR":"Arbor Realty Trust, Inc.","ABX":"Abacus Global Management, Inc.","ACA":"Arcosa, Inc.","ACCO":"Acco Brands Corporation","ACEL":"Accel Entertainment, Inc.","ACHR":"Archer Aviation Inc.","ACI":"Albertsons Companies, Inc.","ACM":"Aecom","ACR":"ACRES Commercial Realty Corp.","ACRE":"Ares Commercial Real Estate Corporation","ACVA":"ACV Auctions Inc.","AD":"Array Digital Infrastructure, Inc.","ADC":"Agree Realty Corporation","ADCT":"ADC Therapeutics SA","ADNT":"Adient plc","ADT":"ADT Inc.","AEG":"Aegon Ltd.","AEM":"Agnico Eagle Mines Ltd.","AEO":"American Eagle Outfitters","AER":"Aercap Holdings N.V.","AESI":"Atlas Energy Solutions Inc.","AEXA":"American Exceptionalism Acquisition Corp. A","AFG":"American Financial Group, Inc.","AG":"FIRST MAJESTIC SILVER CORP","AGCO":"AGCO Corporation","AGI":"Alamos Gold Inc. Class A Common Shares","AGL":"agilon health, inc.","AGM":"Federal Agricultural Mortgage Corporation","AGM.A":"Federal Agricultural Mortgage Corporation Class A Voting","AGO":"Assured Guaranty, LTD","AGRO":"ADECOAGRO S.A.","AGX":"Argan, Inc","AHR":"American Healthcare REIT, Inc.","AHT":"Ashford Hospitality Trust, Inc.","AI":"C3.ai, Inc.","AII":"American Integrity Insurance Group, Inc.","AIN":"Albany International Corp Class A","AIR":"AAR Corp.","AIT":"Applied Industrial Technologies, Inc.","AIV":"Apartment Investment and Management Company","AKA":"a.k.a. Brands Holding Corp.","AKO.A":"Embotelladora Andina S.A. Series A","AKO.B":"Embotelladora Andina S.A. Series B","AKR":"Acadia Realty Trust","ALC":"Alcon Inc.","ALG":"Alamo Group, Inc.","ALH":"Alliance Laundry Holdings Inc.","ALIT":"Alight, Inc.","ALK":"Alaska Air Group, Inc.","ALLY":"Ally Financial Inc.","ALSN":"ALLISON TRANSMISSION HOLDINGS, INC.","ALTG":"Alta Equipment Group Inc.","ALV":"Autoliv, Inc.","ALX":"Alexander's Inc.","AM":"Antero Midstream Corporation","AMBP":"Ardagh Metal Packaging S.A.","AMBQ":"Ambiq Micro, Inc.","AMC":"AMC ENTERTAINMENT HOLDINGS, INC.","AMG":"Affiliated Managers Group","AMH":"AMERICAN HOMES 4 RENT","AMN":"AMN Healthcare Services","AMPX":"Amprius Technologies, Inc.","AMPY":"Amplify Energy Corp.","AMR":"Alpha Metallurgical Resources, Inc.","AMRC":"Ameresco, Inc.","AMRZ":"Amrize Ltd","AMTB":"Amerant Bancorp Inc.","AMTM":"Amentum Holdings, Inc.","AMWL":"American Well Corporation","AN":"AutoNation, Inc.","ANF":"Abercrombie & Fitch Co.","ANGX":"Angel Studios, Inc.","ANVS":"Annovis Bio, Inc.","AOMR":"Angel Oak Mortgage REIT, Inc.","AORT":"Artivion, Inc.","AP":"Ampco-Pittsburgh Corp.","APAM":"ARTISAN PARTNERS ASSET MANAGEMENT INC.","APG":"APi Group Corporation","APLE":"Apple Hospitality REIT, Inc.","AQN":"Algonquin Power & Utilities Corp","AR":"ANTERO RESOURCES CORPORATION","ARCO":"ARCOS DORADOS HOLDINGS INC.","ARDT":"Ardent Health, Inc.","ARI":"APOLLO COMMERCIAL REAL ESTATE FINANCE, INC.","ARIS":"Aris Mining Corporation","ARLO":"Arlo Technologies, Inc.","ARMK":"ARAMARK","AROC":"Archrock Inc","ARR":"ARMOUR Residential REIT, Inc.","ARW":"Arrow Electronics, Inc.","ARX":"Accelerant Holdings","AS":"Amer Sports, Inc.","ASA":"ASA GOLD AND PRECIOUS METALS LIMITED","ASAN":"Asana, Inc. Class A","ASB":"Associated Banc-Corp","ASC":"ARDMORE SHIPPING CORPORATION","ASH":"Ashland Inc.","ASIX":"AdvanSix Inc.","ASPN":"Aspen Aerogels, Inc.","ASX":"ASE Technology Holding Co., Ltd.","ATEN":"A10 NETWORKS INC","ATI":"ATI Inc.","ATKR":"Atkore Inc.","ATMU":"Atmus Filtration Technologies Inc.","ATR":"AptarGroup, Inc.","AU":"AngloGold Ashanti plc","AUB":"Atlantic Union Bankshares Corporation","AUNA":"Auna S.A.","AVA":"Avista Corporation","AVD":"American Vanguard Corporation","AVNS":"Avanos Medical, Inc.","AVNT":"Avient Corporation","AVTR":"Avantor, Inc.","AWI":"Armstrong World Industries, Inc.","AWR":"American States Water Company","AX":"Axos Financial, Inc.","AXS":"Axis Capital Holders Limited","AXTA":"Axalta Coating Systems Ltd.","AYI":"Acuity Inc.","AZN":"AstraZeneca PLC","AZZ":"AZZ Inc.","B":"Barrick Mining Corporation","BAH":"Booz Allen Hamilton Holding Corporation","BALY":"Bally's Corporation","BAM":"Brookfield Asset Management Ltd.","BANC":"Banc of California, Inc.","BAP":"Credicorp LTD","BARK":"BARK, Inc.","BB":"BlackBerry Limited","BBAI":"BigBear.ai Holdings, Inc.","BBAR":"Banco BBVA Argentina S.A.","BBBY":"Bed Bath & Beyond, Inc.","BBDC":"Barings BDC, Inc.","BBUC":"Brookfield Business Corporation Class A Subordinate Voting Shares","BBVA":"Banco Bilbao Vizcaya Argentaria, S.A.","BBW":"Build-A-Bear Workshop, Inc.","BBWI":"Bath & Body Works, Inc.","BC":"Brunswick Corporation","BCC":"Boise Cascade Company","BCE":"BCE, Inc.","BCO":"The Brink's Company","BCS":"Barclays PLC","BCSF":"Bain Capital Specialty Finance, Inc.","BDC":"Belden Inc.","BDN":"Brandywine Realty Trust","BE":"Bloom Energy Corporation","BEPC":"Brookfield Renewable Corporation Class A Exchangeable Subordinate Voting Shares","BETA":"Beta Technologies, Inc.","BF.A":"Brown-Forman Corporation Class A","BF.B":"Brown-Forman Corporation Class B","BFAM":"BRIGHT HORIZONS FAMILY SOLUTIONS INC.","BFH":"Bread Financial Holdings, Inc.","BFLY":"Butterfly Network, Inc.","BFS":"Saul Centers, Inc.","BGS":"B&G Foods, Inc.","BGSF":"BGSF, Inc.","BGSI":"Boyd Group Services Inc.","BH":"Biglari Holdings Inc. Class B","BHC":"Bausch Health Companies Inc","BHE":"Benchmark Electronics","BHR":"Braemar Hotels & Resorts Inc.","BHVN":"Biohaven Ltd.","BILL":"BILL Holdings, Inc.","BIO":"Bio-Rad Laboratories, Inc.Class A","BIO.B":"Bio-Rad Laboratories, Inc. Class B","BIP":"Brookfield Infrastructure Partners L.P.","BIPC":"Brookfield Infrastructure Corporation Class A Exchangeable Subordinate Voting Shares","BIRK":"Birkenstock Holding plc","BJ":"BJs Wholesale Club Holdings, Inc.","BKD":"Brookdale Senior Living, Inc.","BKE":"The Buckle, Inc.","BKH":"Black Hills Corporation","BKKT":"Bakkt, Inc.","BKSY":"BlackSky Technology Inc.","BKU":"Bankunited, Inc.","BKV":"BKV Corporation","BLCO":"Bausch + Lomb Corporation","BLND":"Blend Labs, Inc.","BLSH":"Bullish","BLX":"Bladex, Inc.","BMA":"Banco Macro S.A.","BMI":"Badger Meter, Inc.","BMNR":"BitMine Immersion Technologies, Inc.","BMO":"Bank of Montreal","BN":"Brookfield Corporation","BNED":"Barnes & Noble Education, Inc","BNL":"Broadstone Net Lease, Inc.","BNS":"Bank of Nova Scotia","BNT":"Brookfield Wealth Solutions Ltd.","BOBS":"Bobs Discount Furniture, Inc.","BOC":"Boston Omaha Corporation","BOH":"Bank of Hawaii Corp.","BOOT":"Boot Barn Holdings, Inc.","BORR":"Borr Drilling Limited","BOW":"Bowhead Specialty Holdings Inc.","BOX":"BOX, INC.","BP":"BP p.l.c.","BRBR":"BellRing Brands, Inc.","BRC":"Brady Corporation","BRCC":"BRC Inc.","BRK.A":"Berkshire Hathaway Inc.","BROS":"Dutch Bros Inc.","BRSL":"Brightstar Lottery PLC","BRSP":"BrightSpire Capital, Inc.","BRT":"BRT Apartments Corp","BRX":"BRIXMOR PROPERTY GROUP INC.","BSAC":"Banco Santander-Chile","BSBR":"BANCO SANTANDER (BRASIL) SA","BTE":"Baytex Energy Corp.","BTU":"Peabody Energy Corporation","BUD":"Anheuser-Busch INBEV SA/NV","BUR":"Burford Capital Limited","BURL":"BURLINGTON STORES, INC.","BV":"BrightView Holdings, Inc.","BVN":"Compania de Minas Buenaventura S.A.","BW":"Babcock & Wilcox Enterprises, Inc.","BWA":"BorgWarner Inc.","BWLP":"BW LPG Limited","BWMX":"Betterware de Mexico, S.A.P.I. de C.V.","BWXT":"BWX Technologies, Inc.","BXC":"BlueLinx Holdings Inc.","BXMT":"Blackstone Mortgage Trust, Inc. (NEW)","BY":"Byline Bancorp, Inc.","BYD":"Boyd Gaming Corporation","BZH":"Beazer Homes USA, Inc.","CAAP":"Corporacion America Airports S.A.","CABO":"Cable One, Inc.","CAL":"Caleres Inc","CALX":"CALIX, INC.","CALY":"Callaway Golf Company","CANG":"Cango Inc.","CARS":"Cars.com Inc.","CATO":"CATO CORP","CAVA":"CAVA Group, Inc.","CBAN":"Colony Bankcorp Inc.","CBNA":"Chain Bridge Bancorp, Inc.","CBT":"Cabot Corporation","CBU":"Community Financial System, Inc.","CBZ":"CBIZ, Inc.","CC":"The Chemours Company","CCJ":"Cameco Corporation","CCK":"Crown Holdings Inc.","CCM":"Concord Medical Services Holding Limited","CCO":"Clear Channel Outdoor Holdings, Inc.","CCS":"CENTURY COMMUNITIES, INC.","CCU":"Compania Cervecerias Unidas S.A.","CDE":"Coeur Mining, Inc.","CDP":"COPT Defense Properties","CDRE":"Cadre Holdings, Inc.","CE":"Celanese Corporation","CFR":"Cullen/Frost Bankers Inc.","CGAU":"Centerra Gold Inc.","CHCT":"Community Healthcare Trust Incorporated","CHE":"Chemed Corporation","CHGG":"CHEGG, INC.","CHH":"Choice Hotels Intnl.","CHMI":"CHERRY HILL MORTGAGE INVESTMENT CORPORATION","CHPT":"ChargePoint Holdings, Inc.","CHWY":"Chewy, Inc.","CIA":"Citizens, Inc.","CIM":"Chimera Investment Corp.","CINT":"CI&T Inc","CION":"CION Investment Corporation","CLB":"Core Laboratories Inc.","CLDT":"CHATHAM LODGING TRUST","CLF":"Cleveland-Cliffs Inc.","CLH":"Clean Harbors, Inc","CLPR":"Clipper Realty Inc.","CLS":"Celestica, Inc.","CLVT":"Clarivate Plc","CLW":"Clearwater Paper Corporation","CM":"Canadian Imperial Bank of Commerce","CMC":"Commercial Metals Company","CMP":"Compass Minerals International, Inc.","CMRE":"Costamare Inc.","CMTG":"Claros Mortgage Trust, Inc.","CNA":"CNA Financial Corporation","CNC":"Centene Corporation","CNH":"CNH INDUSTRIAL N.V.","CNI":"Canadian National Railway","CNK":"Cinemark Holdings, Inc.","CNM":"Core & Main, Inc.","CNMD":"CONMED Corporation","CNNE":"Cannae Holdings, Inc.","CNO":"CNO Financial Group, Inc.","CNQ":"Canadian Natural Resources Limited","CNR":"Core Natural Resources, Inc.","CNS":"Cohen & Steers Inc.","CNX":"CNX Resources Corporation","CODI":"Compass Diversified","COLD":"Americold Realty Trust, Inc.","COMP":"Compass, Inc.","CON":"Concentra Group Holdings Parent, Inc.","COSO":"CoastalSouth Bancshares, Inc.","COTY":"COTY INC","COUR":"Coursera, Inc.","CP":"Canadian Pacific Kansas City Limited","CPA":"Copa Holdings, S.A.","CPF":"Central Pacific Financial Corporation","CPK":"Chesapeake Utilities","CPNG":"Coupang, Inc.","CPRI":"Capri Holdings Limited","CPS":"Cooper-Standard Automotive Inc.","CR":"Crane Company","CRBG":"Corebridge Financial, Inc.","CRC":"California Resources Corporation","CRCL":"Circle Internet Group, Inc.","CRD.A":"Crawford & Company Class A","CRD.B":"Crawford & Company Class B","CRGY":"Crescent Energy Company","CRI":"Carter's Inc.","CRK":"Comstock Resources, Inc.","CRS":"Carpenter Technology Corp","CSL":"Carlisle Companies, Inc.","CSR":"Centerspace","CSTM":"Constellium SE Class A Ordinary shares","CSV":"Carriage Services, Inc.","CSW":"CSW Industrials, Inc.","CTO":"CTO Realty Growth, Inc.","CTOS":"Custom Truck One Source, Inc.","CTRE":"CareTrust REIT, Inc","CTRI":"Centuri Holdings, Inc.","CTS":"CTS Corporation","CUBE":"CubeSmart","CUBI":"CUSTOMERS BANCORP INC","CURB":"Curbline Properties Corp.","CURV":"Torrid Holdings Inc.","CUZ":"Cousins Properties Inc.","CVE":"Cenovus Energy Inc.","CVEO":"Civeo Corporation","CVI":"CVR ENERGY, INC.","CVLG":"Covenant Logistics Group, Inc.","CW":"Curtiss-Wright Corp.","CWEN":"Clearway Energy, Inc. Class C","CWH":"Camping World Holdings, Inc.","CWK":"Cushman & Wakefield Ltd.","CWT":"California Water Service","CX":"Cemex S.A.B. de C.V.","CXM":"Sprinklr, Inc.","CXT":"Crane NXT, Co.","CXW":"CoreCivic, Inc.","CYD":"China Yuchai International Ltd.","CYH":"Community Health Systems, Inc.","DAC":"Danaos Corporation","DAN":"Dana Incorporated","DAR":"DARLING INGREDIENTS INC.","DB":"Deutsche Bank Aktiengesellschaft","DBD":"Diebold Nixdorf, Incorporated","DBI":"Designer Brands Inc.","DBRG":"DigitalBridge Group, Inc.","DCI":"Donaldson Company, Inc.","DCO":"Ducommun Incorporated","DD":"DuPont de Nemours, Inc.","DDD":"3D Systems Corporation","DDS":"Dillards Inc.","DEA":"Easterly Government Properties, Inc.","DEC":"Diversified Energy Company","DEI":"Douglas Emmett, Inc.","DEO":"Diageo plc","DFH":"Dream Finders Homes, Inc.","DFIN":"Donnelley Financial Solutions, Inc.","DHT":"DHT HOLDINGS, INC.","DHX":"DHI Group, Inc.","DIN":"Dine Brands Global, Inc.","DINO":"HF Sinclair Corporation","DK":"Delek US Holdings, Inc.","DKS":"Dick's Sporting Goods, Inc.","DLB":"Dolby Laboratories, Inc.Class A","DLX":"Deluxe Corporation","DMC":"Del Monte Corporation","DNA":"Ginkgo Bioworks Holdings, Inc.","DNOW":"DNOW Inc.","DOCN":"DigitalOcean Holdings, Inc.","DOCS":"Doximity, Inc.","DOLE":"Dole plc","DRD":"DRDGOLD Ltd.","DSX":"Diana Shipping, Inc.","DT":"Dynatrace, Inc.","DTM":"DT Midstream, Inc.","DV":"DoubleVerify Holdings, Inc.","DX":"Dynex Capital, Inc.","DXC":"DXC Technology Company","DXYZ":"Destiny Tech100 Inc.","DY":"Dycom Industries, Inc.","E":"ENI S.p.A.","EAF":"GrafTech International Ltd.","EARN":"Ellington Credit Company","EAT":"Brinker International, Inc.","EBF":"Ennis, Inc.","EBS":"Emergent Biosolutions, Inc.","EC":"Ecopetrol S.A","ECC":"Eagle Point Credit Company","ECG":"Everus Construction Group, Inc.","ECVT":"Ecovyst Inc.","EE":"Excelerate Energy, Inc.","EFC":"Ellington Financial Inc.","EGO":"Eldorado Gold Corporation","EGP":"EastGroup Properties Inc.","EGY":"Vaalco Energy, Inc.","EHC":"Encompass Health Corporation","EIC":"Eagle Point Income Company Inc.","EIG":"Employers Holdings, Inc.","ELAN":"Elanco Animal Health Incorporated","ELF":"e.l.f. Beauty, Inc.","ELME":"Elme Communities","ELS":"Equity Lifestyle Properties, Inc.","EMA":"Emera Incorporated","EMN":"Eastman Chemical Company","ENB":"Enbridge, Inc","ENOV":"Enovis Corporation","ENR":"Energizer Holdings, Inc","ENS":"EnerSys, Inc.","ENVA":"Enova International, Inc.","EPAC":"Enerpac Tool Group Corp.","EPC":"Edgewell Personal Care Company","EPR":"EPR Properties","EPRT":"Essential Properties Realty Trust, Inc.","EQBK":"Equity Bancshares, Inc.","EQH":"Equitable Holdings, Inc.","ERO":"Ero Copper Corp.","ESAB":"ESAB Corporation","ESE":"ESCO Technologies, Inc.","ESI":"Element Solutions Inc.","ESNT":"Essent Group LTD","ESRT":"EMPIRE STATE REALTY TRUST, INC.","ESTC":"Elastic N.V.","ET":"Energy Transfer LP","ETD":"Ethan Allen Interiors Inc","ETSY":"Etsy, Inc.","EVC":"Entravision Communication","EVEX":"Eve Holding, Inc.","EVH":"Evolent Health, Inc Class A","EVR":"Evercore Inc.","EVTC":"EVERTEC, INC.","EVTL":"Vertical Aerospace Ltd.","EXK":"Endeavour Silver Corp.","EXP":"Eagle Materials, Inc.","FAF":"First American Financial Corporation","FBIN":"Fortune Brands Innovations, Inc.","FBK":"FB Financial Corporation","FBP":"First BanCorp.","FBRT":"Franklin BSP Realty Trust, Inc.","FC":"Franklin Covey Company","FCF":"First Commonwealth Financial Corporation","FCN":"FTI Consulting, Inc.","FCPT":"Four Corners Property Trust, Inc.","FERG":"Ferguson Enterprises Inc.","FET":"Forum Energy Technologies, Inc.","FF":"Future Fuel Corporation","FG":"F&G Annuities & Life, Inc.","FHI":"Federated Hermes, Inc.","FHN":"First Horizon Corporation","FIG":"Figma, Inc.","FIGS":"FIGS, Inc.","FLG":"Flagstar Bank, National Association","FLO":"Flowers Foods, Inc.","FLR":"Fluor Corporation","FLS":"Flowserve Corporation","FLUT":"Flutter Entertainment plc","FMC":"FMC Corporation","FMS":"Fresenius Medical Care AG","FMX":"FOMENTO ECONOMICO MEXICANO, S.A.B. DE C.V.","FN":"Fabrinet","FNB":"F.N.B. Corp","FND":"Floor & Decor Holdings, Inc.","FNF":"Fidelity National Financial, Inc.","FNV":"Franco-Nevada Corporation","FOA":"Finance of America Companies Inc.","FOR":"Forestar Group Inc.","FOUR":"Shift4 Payments, Inc.","FPH":"Five Point Holdings, LLC Class A Common Shares","FPI":"Farmland Partners Inc.","FR":"First Industrial Realty Trust, Inc.","FRO":"Frontline Plc","FSCO":"FS Credit Opportunities Corp.","FSK":"FS KKR Capital Corp.","FSM":"Fortuna Mining Corp.","FSS":"Federal Signal Corp.","FTI":"TechnipFMC plc","FTK":"Flotek Industries, Inc.","FTS":"Fortis Inc. Common Shares","FUBO":"FuboTV Inc.","FUL":"H.B. Fuller Company","FUN":"Six Flags Entertainment Corporation","FVRR":"Fiverr International Ltd.","G":"GENPACT LIMITED","GAB":"The Gabelli Equity Trust Inc.","GAP":"The Gap, Inc.","GATX":"GATX Corporation","GBCI":"Glacier Bancorp Inc","GBTG":"Global Business Travel Group, Inc.","GBX":"The Greenbrier Companies, Inc.","GCO":"Genesco Inc.","GDOT":"Green Dot Corporation","GEF":"Greif, Inc.","GEF.B":"Greif, Inc. Class B","GENI":"Genius Sports Limited","GEO":"The GEO Group, Inc.","GETY":"Getty Images Holdings, Inc.","GFF":"Griffon Corp","GFI":"Gold Fields Ltd ADR","GFL":"GFL Environmental Inc. Subordinate Voting Shares","GFR":"Greenfire Resources Ltd.","GGB":"Gerdau S.A.","GGG":"Graco Inc","GHC":"GRAHAM HOLDINGS COMPANY","GHM":"Graham Corporation","GIB":"CGI Inc.","GIC":"Global Industrial Company","GIL":"Gildan Activewear Inc.","GKOS":"Glaukos Corporation","GLAS":"Glass House Brands Inc.","GLOB":"GLOBANT S.A.","GME":"GameStop Corp. Class A","GMED":"GLOBUS MEDICAL INC","GNE":"GENIE ENERGY LTD","GNK":"GENCO SHIPPING & TRADING LTD","GNL":"Global Net Lease, Inc.","GNW":"Genworth Financial, Inc.","GOLF":"Acushnet Holdings Corp.","GOOS":"Canada Goose Holdings Inc.","GPI":"Group 1 Automotive, Inc.","GPK":"Graphic Packaging Holding Company","GPMT":"Granite Point Mortgage Trust Inc.","GPOR":"Gulfport Energy Corporation","GPRK":"GEOPARK LIMITED","GRBK":"Green Brick Partners, Inc","GRC":"The Gorman-Rupp Company Common Shares","GRDN":"Guardian Pharmacy Services, Inc.","GRND":"Grindr Inc.","GRNT":"Granite Ridge Resources, Inc.","GROV":"Grove Collaborative Holdings, Inc.","GSBD":"Goldman Sachs BDC, Inc.","GSL":"Global Ship Lease, Inc.","GTES":"Gates Industrial Corporation Ltd.","GTN":"Gray Media, Inc.","GTY":"Getty Realty Corp.","GVA":"Granite Construction Inc.","GWH":"ESS Tech, Inc.","GWRE":"GUIDEWIRE SOFTWARE, INC.","GXO":"GXO Logistics, Inc.","H":"Hyatt Hotels Corporation","HAE":"Haemonetics Corporation","HAFN":"Hafnia Limited","HASI":"HA Sustainable Infrastructure Capital, Inc.","HAWK":"HawkEye 360, Inc.","HAYW":"Hayward Holdings, Inc.","HBB":"Hamilton Beach Brands Holding Company Class A","HBM":"Hudbay Minerals Inc.","HCC":"Warrior Met Coal, Inc.","HCI":"HCI Group, Inc.","HDB":"HDFC Bank Limited","HE":"Hawaiian Electric Industries, Inc.","HEI":"HEICO Corporation","HEI.A":"HEICO CORP CL A","HESM":"Hess Midstream LP Class A Share","HG":"Hamilton Insurance Group, Ltd. Class B Common Shares","HGTY":"Hagerty, Inc.","HGV":"Hilton Grand Vacations Inc.","HHH":"Howard Hughes Holdings Inc.","HIMS":"Hims & Hers Health, Inc.","HIPO":"Hippo Holdings Inc.","HIW":"Highwoods Properties Inc.","HL":"Hecla Mining Company","HLF":"Herbalife Ltd.","HLI":"Houlihan Lokey, Inc.","HLIO":"Helios Technologies, Inc.","HLLY":"Holley Inc.","HLX":"Helix Energy Solutions Group, Inc.","HMC":"Honda Motor Co., Ltd.","HMN":"Horace Mann Educators Corporation","HMY":"Harmony Gold Mining Company Limited","HNGE":"Hinge Health, Inc.","HNI":"HNI Corporation","HOG":"Harley-Davidson, Inc.","HOMB":"Home BancShares, Inc.","HOV":"Hovnanian Enterprises, Inc. Class A","HP":"Helmerich & Payne, Inc.","HPP":"Hudson Pacific Properties, Inc.","HQH":"abrdn Healthcare Investors","HQL":"abrdn Life Sciences Investors","HR":"Healthcare Realty Trust Incorporated","HRB":"H&R Block, Inc.","HRI":"Herc Holdings Inc.","HRTG":"HERITAGE INSURANCE HOLDINGS INC","HSBC":"HSBC Holdings PLC","HSHP":"Himalaya Shipping Ltd.","HTB":"HomeTrust Bancshares, Inc.","HTGC":"Hercules Capital, Inc.","HTH":"HILLTOP HOLDINGS INC.","HUBS":"HUBSPOT, INC.","HUN":"Huntsman Corporation","HUYA":"HUYA Inc.","HVT":"Haverty Furniture Companies, Inc.","HVT.A":"Haverty Furniture Companies, Inc. Class A","HXL":"Hexcel Corporation","HY":"Hyster-Yale, Inc.","HZO":"MarineMax, Inc.","IAG":"IAMGold Corporation","IBN":"ICICI Bank Limited","IBP":"INSTALLED BUILDING PRODUCTS, INC.","IBTA":"Ibotta, Inc.","ICL":"ICL Group Ltd.","IDA":"IDACORP, Inc.","IDT":"IDT Corporation Class B","IFS":"Intercorp Financial Services Inc.","IHG":"InterContinental Hotels Group Plc","IHS":"IHS Holding Limited","IIIN":"Insteel Industries, Inc.","IIPR":"Innovative Industrial Properties, Inc. Common stock","IMAX":"Imax Corp","INFQ":"Infleqtion, Inc.","INGM":"Ingram Micro Holding Corporation","INGR":"Ingredion Incorporated","INN":"Summit Hotel Properties, Inc.","INR":"Infinity Natural Resources, Inc.","INSP":"Inspire Medical Systems, Inc.","INSW":"International Seaways, Inc.","INVX":"Innovex International, Inc.","IONQ":"IonQ, Inc.","IOT":"Samsara Inc.","IPI":"Intrepid Potash, Inc","IRT":"Independence Realty Trust Inc.","ITGR":"Integer Holdings Corporation","ITT":"ITT Inc.","IVR":"Invesco Mortgage Capital Inc.","IVT":"InvenTrust Properties Corp.","JAN":"Janus Living, Inc.","JBGS":"JBG SMITH Properties Common Shares","JBI":"Janus International Group, Inc.","JBS":"JBS N.V.","JBTM":"JBT Marel Corporation","JEF":"Jefferies Financial Group Inc.","JELD":"JELD-WEN Holding, Inc.","JHX":"James Hardie Industries plc","JILL":"J.Jill, Inc.","JKS":"JINKOSOLAR HOLDINGS CO","JLL":"Jones Lang LaSalle, Inc.","JMIA":"Jumia Technologies AG","JOBY":"Joby Aviation, Inc.","JOE":"St. Joe Company","JXN":"Jackson Financial Inc.","KAI":"Kadant Inc.","KB":"KB Financial Group Inc","KBH":"KB Home","KBR":"KBR, Inc.","KD":"Kyndryl Holdings, Inc.","KEN":"KENON HOLDINGS LTD.","KEP":"Korea Electric Power Corp","KEX":"Kirby Corporation","KFRC":"Kforce Inc.","KFY":"Korn Ferry","KGC":"Kinross Gold Corporation","KGS":"Kodiak Gas Services, Inc.","KLAR":"Klarna Group plc","KLC":"KinderCare Learning Companies, Inc.","KMPR":"Kemper Corporation","KMT":"Kennametal Inc.","KMX":"CarMax Inc.","KN":"KNOWLES CORPORATION","KNF":"Knife River Corporation","KNSL":"Kinsale Capital Group, Inc.","KNTK":"Kinetik Holdings Inc.","KNX":"Knight-Swift Transportation Holdings Inc. Class A","KODK":"EASTMAN KODAK COMPANY","KOF":"Coca-Cola FEMSA, S.A.B DE C.V","KOP":"Koppers Holdings, Inc.","KOS":"Kosmos Energy Ltd.","KRC":"Kilroy Realty Corp.","KREF":"KKR Real Estate Finance Trust Inc.","KRG":"Kite Realty Group Trust","KRMN":"Karman Holdings Inc.","KRO":"Kronos Worldwide, Inc.","KSS":"Kohls Corporation","KT":"KT Corp.","KTB":"Kontoor Brands, Inc.","KVYO":"Klaviyo, Inc.","KWR":"Quaker Houghton","KWY":"Kingsway Corporation","LAC":"Lithium Americas Corp.","LAD":"Lithia Motors, Inc.","LADR":"LADDER CAPITAL CORP","LANV":"Lanvin Group Holdings Limited","LAR":"Lithium Argentina AG","LAW":"CS Disco, Inc.","LAZ":"Lazard, Inc.","LB":"LandBridge Company LLC","LBRT":"Liberty Energy Inc.","LCII":"LCI Industries","LCLN":"Lincoln International, Inc.","LEA":"Lear Corporation","LEN.B":"Lennar Corporation Class B","LEO":"BNY Mellon Strategic Municipals, Inc.","LEU":"Centrus Energy Corp.","LEVI":"Levi Strauss & Co. Class A","LFT":"Lument Finance Trust, Inc.","LION":"Lionsgate Studios Corp.","LMND":"Lemonade, Inc.","LNC":"Lincoln National Corp.","LNG":"Cheniere Energy Inc","LNN":"Lindsay Corporation","LOAR":"Loar Holdings Inc.","LOB":"Live Oak Bancshares, Inc.","LOCL":"Local Bounti Corporation","LPG":"DORIAN LPG LTD","LPL":"LG Display Co. Ltd.","LPX":"Louisiana-Pacific Corp.","LRN":"Stride, Inc.","LSPD":"Lightspeed Commerce Inc.","LTC":"LTC Properties, Inc.","LTH":"Life Time Group Holdings, Inc.","LUCK":"Lucky Strike Entertainment Corporation","LUMN":"Lumen Technologies, Inc.","LVWR":"LiveWire Group, Inc.","LW":"Lamb Weston Holdings, Inc.","LXFR":"Luxfer Holdings PLC","LXP":"LXP Industrial Trust","LXU":"LSB INDUSTRIES INC","LYG":"Lloyds Banking Group PLC","LZB":"La-Z-Boy Incorporated","LZM":"Lifezone Metals Limited","M":"Macy's Inc.","MAC":"The Macerich Company","MAGN":"Magnera Corporation","MAIN":"Main Street Capital Corporation","MAN":"ManpowerGroup","MANE":"Veradermics, Incorporated","MANU":"MANCHESTER UNITED PLC","MATV":"Mativ Holdings, Inc.","MATX":"Matsons, Inc.","MAX":"MediaAlpha, Inc.","MBC":"MasterBrand, Inc.","MBI":"MBIA Inc.","MC":"MOELIS & COMPANY","MCB":"Metropolitan Bank Holding Corp.","MCS":"The Marcus Corporation","MCY":"Mercury General Corp.","MD":"Pediatrix Medical Group, Inc.","MDU":"MDU Resources Group, Inc.","MDV":"Modiv Industrial, Inc.","MEC":"Mayville Engineering Company, Inc.","MED":"Medifast, Inc.","MEI":"Methode Electronics","MFA":"MFA Financial, Inc","MFAN":"MFA Financial Inc","MFC":"Manulife Financial Corp.","MG":"Mistras Group Inc.","MGA":"Magna International","MGY":"Magnolia Oil & Gas Corporation Class A","MHK":"Mohawk Industries, Inc.","MHLA":"Maiden Holdings, Ltd.","MHO":"M/I Homes, Inc.","MIR":"Mirion Technologies, Inc.","MITT":"TPG Mortgage Investment Trust, Inc.","MKC.V":"McCormick & Company, Incorporated Voting CS","MKL":"Markel Group Inc.","MLI":"Mueller Industries, Inc.","MLR":"Miller Industries, Inc.","MMS":"MAXIMUS, Inc.","MOD":"Modine Manufacturing Co","MOG.A":"Moog Inc.","MOG.B":"MOOG INC CL B","MOH":"Molina Healthcare, Inc.","MOV":"Movado Group, Inc.","MP":"MP Materials Corp.","MPT":"Medical Properties Trust, Inc.","MRP":"Millrose Properties, Inc.","MRSH":"Marsh","MSA":"Mine Safety Incorporated","MSGE":"Madison Square Garden Entertainment Corp.","MSGS":"Madison Square Garden Sports Corp.","MSM":"MSC Industrial Direct Co., Inc. Class A","MT":"ArcelorMittal","MTDR":"MATADOR RESOURCES COMPANY","MTG":"MGIC Investment Corp.","MTH":"Meritage Homes Corporation","MTN":"Vail Resorts, Inc.","MTRN":"Materion Corporation","MTUS":"Metallus Inc.","MTW":"The Manitowoc Company, Inc.","MTX":"Minerals Technologies Inc","MTZ":"MasTec, Inc.","MUFG":"Mitsubishi UFJ Financial Group, Inc.","MUR":"Murphy Oil Corp.","MUSA":"MURPHY USA INC.","MUX":"McEwen Inc.","MVO":"MV Oil Trust","MWA":"Mueller Water Products, Inc.","MX":"Magnachip Semiconductor Corp.","MYE":"Myers Industries, Inc.","NABL":"N-able, Inc.","NAT":"Nordic American Tanker","NATL":"NCR Atleos Corporation","NBHC":"NATIONAL BANK HOLDINGS CORP.","NBR":"Nabors Industries Ltd.","NC":"NACCO Industries, Inc.","NCDL":"Nuveen Churchill Direct Lending Corp","NE":"Noble Corporation plc","NET":"Cloudflare, Inc.","NEU":"NewMarket Corporation","NEXA":"Nexa Resources S.A. Common Shares","NFG":"National Fuel Gas Co.","NGG":"National Grid PLC","NGS":"Natural Gas Services Group, Inc.","NGVC":"NATURAL GROCERS BY VITAMIN COTTAGE, INC","NGVT":"Ingevity Corporation","NHI":"National Health Investors","NIC":"Nicolet Bankshares,Inc.","NJR":"New Jersey Resources Corp","NLOP":"Net Lease Office Properties","NLY":"Annaly Capital Management. Inc.","NMAX":"Newsmax, Inc.","NMG":"Nouveau Monde Graphite Inc.","NMR":"Nomura Holdings, Inc","NNI":"Nelnet, Inc. Class A","NNN":"NNN REIT, Inc.","NOA":"North American Construction Group Ltd.","NOG":"Northern Oil and Gas, Inc.","NOK":"Nokia Corporation","NOMD":"Nomad Foods Limited","NOV":"NOV Inc.","NP":"Neptune Insurance Holdings Inc.","NPB":"Northpointe Bancshares, Inc.","NPK":"National Presto Industries, Inc.","NPKI":"NPK International Inc.","NPO":"Enpro Inc.","NPWR":"NET Power Inc.","NRDY":"Nerdy Inc.","NREF":"NexPoint Real Estate Finance, Inc.","NRGV":"Energy Vault Holdings, Inc.","NSP":"Insperity, Inc","NTB":"The Bank of N.T. Butterfield & Son Limited","NTR":"Nutrien Ltd. Common Shares","NTST":"NetSTREIT Corp.","NTZ":"Natuzzi, S.p.A","NU":"Nu Holdings Ltd.","NUS":"NuSkin Enterprises, Inc.","NUVB":"Nuvation Bio Inc.","NVGS":"NAVIGATOR HOLDINGS LTD.","NVO":"Novo-Nordisk A/S","NVRI":"Enviri Corporation","NVS":"Novartis AG","NVST":"Envista Holdings Corporation","NVT":"nVent Electric plc","NWN":"Northwest Natural Holding Company","NX":"Quanex Building Products Corporation","NXDR":"Nextdoor Holdings, Inc.","NXE":"NexGen Energy Ltd.","NXRT":"NexPoint Residential Trust Inc","NYC":"American Strategic Investment Co.","NYT":"New York Times Co.","OBDC":"Blue Owl Capital Corporation","OBK":"Origin Bancorp, Inc.","OC":"Owens Corning","ODC":"Oil-Dri Corporation of America","OEC":"Orion S.A.","OFG":"OFG BANCORP","OGC":"OceanaGold Corporation","OGE":"OGE Energy Corp.","OGN":"Organon & Co.","OGS":"ONE GAS, INC.","OHI":"Omega Healthcare Investors Inc.","OI":"O-I Glass, Inc.","OII":"Oceaneering International Inc.","OIS":"OIL STATES INTERNATIONAL, INC.","OKLO":"Oklo Inc.","OLN":"Olin Corp.","OLP":"One Liberty Properties, Inc.","OMF":"OneMain Holdings, Inc.","ONIT":"Onity Group Inc.","ONL":"Orion Properties Inc.","ONON":"On Holding AG","ONTO":"Onto Innovation Inc.","OOMA":"Ooma, Inc.","OPAD":"Offerpad Solutions Inc.","OPFI":"OppFi Inc.","OPLN":"OPENLANE, Inc","OPY":"Oppenheimer Holdings, Inc.","OR":"OR Royalties Inc.","ORA":"Ormat Technologies, Inc.","ORC":"Orchid Island Capital, Inc.","ORI":"Old Republic International Corporation","ORN":"Orion Group Holdings, Inc","OSCR":"Oscar Health, Inc.","OSK":"Oshkosh Corp.","OUT":"OUTFRONT Media Inc.","OVV":"Ovintiv Inc.","OWL":"Blue Owl Capital Inc.","OWLT":"Owlet, Inc.","OXM":"Oxford Industries, Inc.","PAAS":"Pan American Silver Corp.","PAC":"Grupo Aeroportuario del Pacifico","PACK":"Ranpak Holdings Corp.","PACS":"PACS Group, Inc.","PAG":"Penske Automotive Group, Inc.","PAGS":"PagSeguro Digital Ltd.","PAM":"PAMPA ENERGIA S.A.","PAR":"PAR Technology Corp.","PARR":"Par Pacific Holdings, Inc.","PATH":"UiPath, Inc.","PAY":"Paymentus Holdings, Inc.","PAYC":"PAYCOM SOFTWARE, INC.","PB":"Prosperity Bancshares Inc","PBA":"PEMBINA PIPELINE CORPORATION","PBF":"PBF ENERGY INC.","PBH":"Prestige Consumer Healthcare Inc.","PBI":"Pitney Bowes Inc.","PBR":"PETROLEO BRASILEIRO S.A.-PETROBRAS","PBR.A":"Petroleo Brasileiro S.A.-Petrobras","PCOR":"Procore Technologies, Inc.","PD":"PagerDuty, Inc.","PDM":"Piedmont Realty Trust, Inc.","PEB":"Pebblebrook Hotel Trust","PEN":"Penumbra, Inc.","PERF":"Perfect Corp.","PFGC":"Performance Food Group Company","PFLT":"PennantPark Floating Rate Capital Ltd.","PFS":"Provident Financial Services, Inc.","PFSI":"PennyMac Financial Services, Inc.","PHG":"KONINKLIJKE PHILIPS  N.V.","PHI":"PLDT Inc.","PHIN":"PHINIA Inc.","PHR":"Phreesia, Inc.","PII":"Polaris Inc.","PINE":"Alpine Income Property Trust, Inc","PINS":"Pinterest, Inc. Class A","PIPR":"Piper Sandler Companies","PJT":"PJT Partners Inc.","PK":"Park Hotels & Resorts Inc.","PKE":"Park Aerospace Corp.","PL":"Planet Labs PBC","PLNT":"Planet Fitness, Inc.","PLOW":"DOUGLAS DYNAMICS, INC.","PMT":"PennyMac Mortgage Investment Trust","PNFP":"Pinnacle Financial Partners, Inc.","POR":"Portland General Electric Company","POST":"POST HOLDINGS, INC.","PR":"Permian Resources Corporation","PRG":"PROG Holdings, Inc.","PRGO":"PERRIGO COMPANY PLC","PRI":"PRIMERICA, INC.","PRIM":"Primoris Services Corporation","PRKS":"United Parks & Resorts Inc.","PRLB":"PROTO LABS, INC.","PRM":"Perimeter Solutions, Inc.","PRMB":"Primo Brands Corporation","PS":"Pershing Square Inc.","PSBD":"Palmer Square Capital BDC Inc.","PSFE":"Paysafe Limited","PSN":"Parsons Corporation","PSO":"Pearson plc","PSTL":"Postal Realty Trust, Inc","PSUS":"Pershing Square USA, Ltd.","PUK":"PRUDENTIAL PLC","PUMP":"ProPetro Holding Corp.","PVH":"PVH Corp.","QBTS":"D-Wave Quantum Inc.","QGEN":"QIAGEN N.V.","QSR":"Restaurant Brands International Inc.","QTWO":"Q2 Holdings Inc","QUAD":"QUAD/GRAPHICS, INC.","QXO":"QXO, Inc.","R":"Ryder System, Inc.","RACE":"Ferrari N.V.","RAL":"Ralliant Corporation","RAMP":"LiveRamp Holdings, Inc.","RBA":"RB Global, Inc.","RBC":"RBC Bearings Incorporated","RBLX":"Roblox Corporation","RBRK":"Rubrik, Inc.","RC":"Ready Capital Corporation","RCI":"Rogers Communications, Inc.","RCUS":"Arcus Biosciences, Inc.","RDDT":"Reddit, Inc.","RDN":"Radian Group Inc.","RDW":"Redwire Corporation","RELX":"RELX PLC","RES":"RPC, Inc.","REX":"REX American Resources Corp.","REXR":"REXFORD INDUSTRIAL REALTY, INC.","REZI":"Resideo Technologies, Inc.","RGA":"Reinsurance Group of America, Incorporated","RGR":"Sturm, Ruger & Company, Inc.","RH":"RH","RHI":"Robert Half Inc.","RHP":"Ryman Hospitality Properties, Inc","RIG":"Transocean LTD.","RIO":"Rio Tinto plc","RITM":"Rithm Capital Corp.","RKT":"Rocket Companies, Inc.","RLI":"RLI Corp.","RLJ":"RLJ Lodging Trust","RMAX":"RE/MAX HOLDINGS, INC.","RNG":"RINGCENTRAL, INC.","RNGR":"Ranger Energy Services, Inc.","RNR":"RenaissanceRe Holdings Ltd.","RNST":"Renasant Corporation","ROG":"Rogers Corporation","RPM":"RPM International, Inc.","RRC":"Range Resources Corp","RRX":"Regal Rexnord Corporation","RS":"Reliance, Inc.","RSI":"Rush Street Interactive, Inc.","RSKD":"Riskified Ltd.","RVLV":"Revolve Group, Inc.","RWT":"Redwood Trust, Inc.","RXO":"RXO, Inc.","RY":"Royal Bank of Canada","RYAM":"Rayonier Advanced Materials Inc.","RYAN":"Ryan Specialty Holdings, Inc.","RYN":"Rayonier Inc.","RYZ":"RYERSON HOLDING CORPORATION","S":"SentinelOne, Inc.","SA":"Seabridge Gold, Inc.","SAFE":"Safehold Inc.","SAH":"Sonic Automotive, Inc.","SAM":"Boston Beer Company","SAN":"Banco Santander S.A.","SAP":"SAP SE","SARO":"StandardAero, Inc.","SB":"Safe Bulkers, Inc.","SBH":"Sally Beauty Holdings, Inc.","SBS":"COMPANHIA DE SANEAMENTO BASICO","SBSI":"Southside Bancshares, Inc.","SCCO":"Southern Copper Corporation","SCI":"Service Corporation International","SCL":"Stepan Co.","SCM":"STELLUS CAPITAL INVESTMENT CORPORATION","SD":"SandRidge Energy, Inc.","SDHC":"Smith Douglas Homes Corp.","SDRL":"Seadrill Limited","SEG":"Seaport Entertainment Group Inc.","SEI":"Solaris Energy Infrastructure, Inc.","SES":"SES AI Corporation","SF":"Stifel Financial Corp.","SFBS":"ServisFirst Bancshares Inc.","SFL":"SFL Corporation Ltd.","SG":"Sweetgreen, Inc.","SGHC":"Super Group (SGHC) Limited","SGI":"Somnigroup International Inc.","SHG":"Shinhan Financial Group Co Ltd","SHO":"Sunstone Hotel Investors, Inc.","SI":"Shoulder Innovations, Inc.","SID":"Companhia Siderurgica Nacional S.A.","SIG":"Signet Jewelers Limited","SII":"Sprott Inc.","SITC":"SITE Centers Corp. Common Shares","SITE":"SiteOne Landscape Supply, Inc.","SKE":"Skeena Resources Limited","SKT":"Tanger Inc.","SKY":"Champion Homes, Inc.","SKYH":"Sky Harbour Group Corporation","SLF":"Sun Life Financial Inc.","SLG":"SL Green Realty Corp.","SLGN":"Silgan Holdings Inc","SLQT":"SelectQuote, Inc.","SLVM":"Sylvamo Corporation","SM":"SM Energy Company","SMA":"SmartStop Self Storage REIT, Inc.","SMBK":"SmartFinancial, Inc.","SMC":"Summit Midstream Corporation","SMG":"The Scotts Miracle-Gro Company","SMHI":"SEACOR Marine Holdings Inc.","SMP":"Standard Motor Products","SMR":"NuScale Power Corporation","SMRT":"SmartRent, Inc.","SMWB":"Similarweb Ltd.","SN":"SharkNinja, Inc.","SNAP":"Snap Inc.","SNDA":"Sonida Senior Living, Inc.","SNDR":"Schneider National, Inc.","SNN":"Smith & Nephew plc","SNOW":"Snowflake Inc.","SNX":"TD SYNNEX Corporation","SOBO":"South Bow Corporation","SOC":"Sable Offshore Corp.","SON":"Sonoco Products Company","SOR":"Source Capital","SPB":"Spectrum Brands Holdings, Inc.","SPCE":"Virgin Galactic Holdings, Inc.","SPHR":"Sphere Entertainment Co.","SPIR":"Spire Global, Inc.","SPMC":"Sound Point Meridian Capital, Inc.","SPNT":"SiriusPoint Ltd.","SPOT":"Spotify Technology S.A.","SPRU":"Spruce Power Holding Corporation","SPXC":"SPX Technologies, Inc.","SQM":"Sociedad Quimica y Minera de Chile SA","SR":"Spire Inc.","SRFM":"Surf Air Mobility Inc.","SRG":"Seritage Growth Properties","SRI":"Stoneridge, Inc","SRL":"Scully Royalty Ltd. Common Shares","SSB":"SouthState Bank Corporation","SSD":"Simpson Manufacturing Co., Inc.","SSL":"Sasol Limited","SST":"System1, Inc.","SSTK":"SHUTTERSTOCK, INC.","ST":"Sensata Technologies Holding plc","STAG":"STAG INDUSTRIAL, INC.","STC":"Stewart Information Services Corporation","STEM":"Stem, Inc.","STLA":"Stellantis N.V.","STM":"STMicroelectronics N.V.","STN":"Stantec, Inc.","STNG":"Scorpio Tankers Inc.","STUB":"StubHub Holdings, Inc.","STWD":"STARWOOD PROPERTY TRUST, INC.","SU":"Suncor Energy, Inc.","SUI":"Sun Communities, Inc","SUNB":"Sunbelt Rentals Holdings, Inc.","SUPV":"Grupo Supervielle S.A.","SVV":"Savers Value Village, Inc.","SWX":"Southwest Gas Holdings, Inc.","SXC":"SUNCOKE ENERGY INC","SXI":"Standex International Corporation","SXT":"Sensient Technology Corporation","TAC":"TransAlta Corporation","TAL":"TAL Education Group","TALO":"Talos Energy, Inc.","TAP.A":"Molson Coors Beverage Company Class A","TBBB":"BBB Foods Inc.","TBI":"Trueblue, Inc.","TCBX":"Third Coast Bancshares, Inc.","TCI":"Transcontinental Realty Investors, Inc.","TD":"Toronto Dominion Bank","TDAY":"USA TODAY Co., Inc.","TDC":"TERADATA CORPORATION","TDOC":"Teladoc Health, Inc.","TDS":"Telephone and Data Systems Inc.","TDW":"Tidewater, Inc.","TE":"T1 Energy Inc.","TECK":"Teck Resources Limited","TEN":"Tsakos Energy Navigation Ltd.","TEO":"Telecom Argentina S.A.","TEX":"Terex Corporation","TFII":"TFI International Inc.","TFIN":"Triumph Financial, Inc.","TFPM":"Triple Flag Precious Metals Corp.","TFX":"Teleflex Incorporated","TG":"Tredegar Corporation","TGLS":"Tecnoglass Inc.","TGS":"Transportadora de Gas del Sur S.A.","THC":"Tenet Healthcare Corporation","THG":"The Hanover Insurance Group, Inc.","THO":"Thor Industries, Inc.","TISI":"Team, Inc.","TK":"Teekay Corporation Ltd.","TKC":"TURKCELL ILETISIM HIZMETLERI A.S.","TKR":"The Timken Company","TLK":"PT Telekomunikasi Indonesia","TLYS":"Tilly's Inc.","TNC":"TENNANT COMPANY","TNET":"TRINET GROUP, INC.","TNK":"Teekay Tankers Ltd.","TNL":"Travel + Leisure Co.","TOL":"Toll Brothers, Inc.","TOST":"Toast, Inc.","TPB":"Turning Point Brands, Inc.","TPC":"Tutor Perini Corporation","TR":"Tootsie Roll Industries, Inc.","TRC":"Tejon Ranch Co.","TREX":"Trex Company, Inc.","TRLV":"Trulieve Cannabis Corp.","TRN":"Trinity Industries, Inc.","TRNO":"Terreno Realty Corporation","TROX":"TRONOX LIMITED","TRP":"TC Energy Corporation","TRTX":"TPG RE Finance Trust, Inc.","TRU":"TransUnion","TS":"Tenaris S. A.","TSLX":"Sixth Street Specialty Lending, Inc.","TSM":"Taiwan Semiconductor Manufacturing Company Ltd.","TTAM":"Titan America SA","TTC":"Toro Company (The)","TTE":"TotalEnergies SE","TTI":"TETRA Technologies, Inc.","TU":"Telus Corporation","TV":"Grupo Televisa S.A.","TWI":"Titan International, Inc.(Delaware)","TWLO":"Twilio Inc.","TWO":"Two Harbors Investment Corp.","TXNM":"TXNM Energy, Inc.","TYG":"Tortoise Energy Infrastructure Corp.","U":"Unity Software Inc.","UA":"Under Armour, Inc. Class C","UAA":"Under Armour, Inc.","UAMY":"United States Antimony Corporation","UBS":"UBS Group AG","UCB":"United Community Banks, Inc.","UE":"UBRAN EDGE PROPERTIES","UFI":"UNIFI, Inc.","UGI":"UGI Corporation","UGP":"Ultrapar Participacoes S.A.","UHAL":"U-Haul Holding Company","UI":"Ubiquiti Inc.","UIS":"Unisys Corporation","UL":"Unilever plc","ULS":"UL Solutions Inc.","UMC":"United Microelectronic Corp.","UMH":"UMH Properties, Inc.","UNF":"Unifirst Corp","UNFI":"United Natural Foods Inc","UNM":"Unum Group","UP":"Wheels Up Experience Inc.","USFD":"US Foods Holding Corp.","USNA":"USANA Health Sciences Inc","USPH":"US Physical Therapy Inc","UTI":"Universal Technical Institute, Inc.","UTL":"Unitil Corporation","UTZ":"Utz Brands, Inc.","UVE":"UNIVERSAL INSURANCE HLDG, INC.","UVV":"Universal Corporation","UWMC":"UWM Holdings Corporation","VAC":"MARRIOTT VACATIONS WORLDWIDE CORPORATION","VAL":"Valaris Limited","VALE":"VALE S.A.","VEL":"Velocity Financial, Inc.","VET":"VERMILION ENERGY INC.","VFC":"V.F. Corporation","VG":"Venture Global, Inc.","VHI":"Valhi, Inc.","VIA":"Via Transportation, Inc.","VIK":"Viking Holdings Ltd","VIPS":"Vipshop Holdings Limited","VIRT":"Virtu Financial, Inc. Class A","VIST":"Vista Energy S.A.B. de C.V.","VLN":"Valens Semiconductor Ltd.","VLRS":"CONTROLADORA VUELA","VMI":"Valmont Industries, Inc.","VNO":"Vornado Realty Trust","VNT":"Vontier Corporation","VOYA":"VOYA FINANCIAL, INC.","VOYG":"Voyager Technologies, Inc.","VPG":"Vishay Precision Group, Inc.","VRTS":"Virtus Investment Partners, Inc.","VSH":"Vishay Intertechnology, Inc.","VSTS":"Vestis Corporation","VTEX":"VTEX","VTOL":"Bristow Group Inc.","VTS":"Vitesse Energy, Inc..","VVV":"Valvoline Inc.","VVX":"V2X, Inc.","VYX":"NCR Voyix Corporation","W":"Wayfair Inc.","WAL":"Western Alliance Bancorporation","WBS":"Webster Financial Corporation Waterbury","WCC":"Wesco International Inc.","WCN":"Waste Connections, Inc.","WD":"Walker & Dunlop, Inc.","WEAV":"Weave Communications, Inc.","WEX":"WEX Inc.","WFG":"West Fraser Timber Co. Ltd","WGO":"Winnebago Industries, Inc.","WH":"Wyndham Hotels & Resorts, Inc.","WHD":"Cactus, Inc.","WHG":"WESTWOOD HOLDINGS GROUP, INC.","WHR":"Whirlpool Corp.","WIT":"Wipro Limited","WK":"Workiva Inc.","WKC":"World Kinect Corporation","WLK":"Westlake Corporation","WLY":"John Wiley & Sons, Inc. Class A","WLYB":"John Wiley & Sons, Inc. Class B","WMK":"Weis Markets, Inc.","WMS":"ADVANCED DRAINAGE SYSTEMS, INC.","WNC":"Wabash National Corp.","WOLF":"Wolfspeed, Inc.","WOR":"Worthington Enterprises, Inc.","WPC":"W.P. Carey Inc.","WPM":"Wheaton Precious Metals Corp.","WPP":"WPP PLC","WRBY":"Warby Parker Inc.","WS":"Worthington Steel, Inc.","WSO":"Watsco, Inc.","WSO.B":"Watsco, Inc. Class B","WT":"WisdomTree, Inc.","WTI":"W&T Offshore, Inc.","WTM":"White Mountains Insurance Group Ltd.","WTRG":"Essential Utilities, Inc.","WTS":"Watts Water Technologies, Inc. Class A","WTTR":"Select Water Solutions, Inc.","WU":"The Western Union Company","WWW":"Wolverine World Wide, Inc.","XHR":"Xenia Hotels & Resorts, Inc.","XPER":"Xperi Inc","XPO":"XPO, Inc.","XPOF":"Xponential Fitness, Inc.","XPRO":"Expro Ltd","YELP":"YELP INC.","YETI":"YETI Holdings, Inc.","YEXT":"Yext, Inc.","YOU":"Clear Secure, Inc.","YPF":"YPF Sociedad Anonima","YUMC":"Yum China Holdings, Inc.","ZETA":"Zeta Global Holdings Corp.","ZGN":"Ermenegildo Zegna N.V.","ZIM":"ZIM Integrated Shipping Services Ltd.","ZIP":"ZipRecruiter, Inc.","ZVIA":"Zevia PBC","ZWS":"Zurn Elkay Water Solutions Corporation"};

function getCompanyName(symbol) {
  return COMPANY_NAMES[symbol] || symbol;
}

// Reverse lookup + search: given partial text, finds matching tickers by
// EITHER ticker symbol OR company name (case-insensitive). Lets someone
// type "Apple" and find AAPL, not just the exact ticker symbol.
function searchTickers(query, maxResults = 8) {
  if (!query || query.length < 1) return [];
  const q = query.toUpperCase();
  const results = [];
  for (const symbol of Object.keys(SECTOR_MAP)) {
    const name = COMPANY_NAMES[symbol] || '';
    const symbolMatch = symbol.toUpperCase().startsWith(q);
    const nameMatch = name.toUpperCase().includes(q);
    if (symbolMatch || nameMatch) {
      results.push({ symbol, name, symbolMatch }); // prioritize symbol-prefix matches
    }
  }
  results.sort((a, b) => (b.symbolMatch - a.symbolMatch));
  return results.slice(0, maxResults);
}

// Per-sector: the price window with the highest historical win rate, from
// a 5,339-cycle backtest across 6 years of history (n>=100 per bucket).
const SECTOR_TOP_WINDOW = {"Industrials":{"bucket":"250to500","low":250,"high":500,"winRate":65.5,"avgReturn":1.48,"n":226},"Health Care":{"bucket":"250to500","low":250,"high":500,"winRate":54.1,"avgReturn":0.25,"n":146},"Information Technology":{"bucket":"50to100","low":50,"high":100,"winRate":62.2,"avgReturn":0.96,"n":156},"Financials":{"bucket":"50to100","low":50,"high":100,"winRate":58.1,"avgReturn":0.81,"n":260},"Consumer Discretionary":{"bucket":"100to250","low":100,"high":250,"winRate":50.9,"avgReturn":-0.07,"n":222},"Real Estate":{"bucket":"100to250","low":100,"high":250,"winRate":43.6,"avgReturn":-0.42,"n":117},"Utilities":{"bucket":"50to100","low":50,"high":100,"winRate":52.3,"avgReturn":0.09,"n":149},"Consumer Staples":{"bucket":"50to100","low":50,"high":100,"winRate":47.7,"avgReturn":-0.34,"n":111},"Energy":{"bucket":"100to250","low":100,"high":250,"winRate":55.9,"avgReturn":0.12,"n":118}};

function isInTopWinRateWindow(sector, price) {
  const window = SECTOR_TOP_WINDOW[sector];
  if (!window) return false;
  return price >= window.low && price < window.high;
}

// Sub-industry classification, from the paper trading averaging-down
// research (5,339-cycle backtest, tested across 4 historical windows).
const SUB_INDUSTRIES = {"CVNA": "Retail/E-commerce", "DLTR": "Retail/E-commerce", "ULTA": "Retail/E-commerce", "DG": "Retail/E-commerce", "HD": "Retail/E-commerce", "EBAY": "Retail/E-commerce", "AMZN": "Retail/E-commerce", "ROST": "Retail/E-commerce", "POOL": "Retail/E-commerce", "DECK": "Retail/E-commerce", "TJX": "Retail/E-commerce", "LOW": "Retail/E-commerce", "ORLY": "Retail/E-commerce", "AZO": "Retail/E-commerce", "BBY": "Retail/E-commerce", "TSCO": "Retail/E-commerce", "LULU": "Retail/E-commerce", "WSM": "Retail/E-commerce", "GPC": "Retail/E-commerce", "EXPE": "Travel/Leisure/Lodging", "MAR": "Travel/Leisure/Lodging", "WYNN": "Travel/Leisure/Lodging", "BKNG": "Travel/Leisure/Lodging", "LVS": "Travel/Leisure/Lodging", "RCL": "Travel/Leisure/Lodging", "MGM": "Travel/Leisure/Lodging", "ABNB": "Travel/Leisure/Lodging", "HLT": "Travel/Leisure/Lodging", "NCLH": "Travel/Leisure/Lodging", "CCL": "Travel/Leisure/Lodging", "DASH": "Travel/Leisure/Lodging", "F": "Auto", "GM": "Auto", "APTV": "Auto", "DRI": "Restaurants", "YUM": "Restaurants", "DPZ": "Restaurants", "MCD": "Restaurants", "SBUX": "Restaurants", "CMG": "Restaurants", "NVR": "Homebuilders", "DHI": "Homebuilders", "LEN": "Homebuilders", "PHM": "Homebuilders", "NKE": "Apparel/Consumer Products", "RL": "Apparel/Consumer Products", "HAS": "Apparel/Consumer Products", "GRMN": "Apparel/Consumer Products", "JPM": "Banks", "BAC": "Banks", "WFC": "Banks", "C": "Banks", "USB": "Banks", "PNC": "Banks", "TFC": "Banks", "FITB": "Banks", "HBAN": "Banks", "RF": "Banks", "CFG": "Banks", "KEY": "Banks", "MTB": "Banks", "NTRS": "Banks", "STT": "Banks", "BK": "Banks", "BNY": "Banks", "ZION": "Banks", "AIG": "Insurance", "ALL": "Insurance", "TRV": "Insurance", "PGR": "Insurance", "CB": "Insurance", "MET": "Insurance", "PRU": "Insurance", "AFL": "Insurance", "HIG": "Insurance", "CINF": "Insurance", "L": "Insurance", "GL": "Insurance", "WRB": "Insurance", "ERIE": "Insurance", "ACGL": "Insurance", "AIZ": "Insurance", "RJF": "Insurance", "GS": "Asset Mgmt/Capital Markets", "MS": "Asset Mgmt/Capital Markets", "SCHW": "Asset Mgmt/Capital Markets", "BLK": "Asset Mgmt/Capital Markets", "ICE": "Asset Mgmt/Capital Markets", "CME": "Asset Mgmt/Capital Markets", "SPGI": "Asset Mgmt/Capital Markets", "MCO": "Asset Mgmt/Capital Markets", "TROW": "Asset Mgmt/Capital Markets", "AMP": "Asset Mgmt/Capital Markets", "IVZ": "Asset Mgmt/Capital Markets", "BX": "Asset Mgmt/Capital Markets", "KKR": "Asset Mgmt/Capital Markets", "APO": "Asset Mgmt/Capital Markets", "ARES": "Asset Mgmt/Capital Markets", "CBOE": "Asset Mgmt/Capital Markets", "NDAQ": "Asset Mgmt/Capital Markets", "IBKR": "Asset Mgmt/Capital Markets", "HOOD": "Asset Mgmt/Capital Markets", "COIN": "Asset Mgmt/Capital Markets", "V": "Payments/Fintech", "MA": "Payments/Fintech", "PYPL": "Payments/Fintech", "GPN": "Payments/Fintech", "CPAY": "Payments/Fintech", "XYZ": "Payments/Fintech", "FIS": "Payments/Fintech", "JNJ": "Pharma", "PFE": "Pharma", "MRK": "Pharma", "ABBV": "Pharma", "LLY": "Pharma", "BMY": "Pharma", "GILD": "Pharma", "AMGN": "Pharma", "VRTX": "Pharma", "ZTS": "Pharma", "MRNA": "Pharma", "REGN": "Pharma", "BIIB": "Pharma", "INCY": "Pharma", "ISRG": "Medical Devices", "SYK": "Medical Devices", "MDT": "Medical Devices", "BSX": "Medical Devices", "BDX": "Medical Devices", "BAX": "Medical Devices", "EW": "Medical Devices", "ALGN": "Medical Devices", "PODD": "Medical Devices", "RMD": "Medical Devices", "UNH": "Health Services/Managed Care", "CI": "Health Services/Managed Care", "ELV": "Health Services/Managed Care", "HUM": "Health Services/Managed Care", "CVS": "Health Services/Managed Care", "HCA": "Health Services/Managed Care", "MCK": "Health Services/Managed Care", "COR": "Health Services/Managed Care", "CAH": "Health Services/Managed Care", "DGX": "Life Sciences Tools", "TMO": "Life Sciences Tools", "DHR": "Life Sciences Tools", "A": "Life Sciences Tools", "IQV": "Life Sciences Tools", "MTD": "Life Sciences Tools", "WAT": "Life Sciences Tools", "CRL": "Life Sciences Tools", "TECH": "Life Sciences Tools", "RVTY": "Life Sciences Tools", "VEEV": "Life Sciences Tools", "MSFT": "Software", "ORCL": "Software", "CRM": "Software", "ADBE": "Software", "INTU": "Software", "NOW": "Software", "PANW": "Software", "FTNT": "Software", "CRWD": "Software", "SNPS": "Software", "CDNS": "Software", "WDAY": "Software", "ADSK": "Software", "PTC": "Software", "GEN": "Software", "PLTR": "Software", "APP": "Software", "DDOG": "Software", "NVDA": "Semiconductors", "AVGO": "Semiconductors", "AMD": "Semiconductors", "QCOM": "Semiconductors", "TXN": "Semiconductors", "INTC": "Semiconductors", "MU": "Semiconductors", "AMAT": "Semiconductors", "LRCX": "Semiconductors", "ADI": "Semiconductors", "NXPI": "Semiconductors", "MCHP": "Semiconductors", "ON": "Semiconductors", "MPWR": "Semiconductors", "SMCI": "Semiconductors", "AAPL": "Hardware", "DELL": "Hardware", "HPQ": "Hardware", "HPE": "Hardware", "WDC": "Hardware", "STX": "Hardware", "ANET": "Hardware", "ACN": "IT Services", "IBM": "IT Services", "CSCO": "IT Services", "ADP": "IT Services", "FI": "IT Services", "XOM": "Integrated/Refining", "CVX": "Integrated/Refining", "PSX": "Integrated/Refining", "VLO": "Integrated/Refining", "MPC": "Integrated/Refining", "COP": "Oil & Gas E&P", "EOG": "Oil & Gas E&P", "OXY": "Oil & Gas E&P", "DVN": "Oil & Gas E&P", "FANG": "Oil & Gas E&P", "APA": "Oil & Gas E&P", "EXE": "Oil & Gas E&P", "SLB": "Oil & Gas Services", "HAL": "Oil & Gas Services", "BKR": "Oil & Gas Services", "KMI": "Midstream/Pipelines", "WMB": "Midstream/Pipelines", "OKE": "Midstream/Pipelines", "TRGP": "Midstream/Pipelines", "PG": "Household Products", "CL": "Household Products", "KMB": "Household Products", "CLX": "Household Products", "CHD": "Household Products", "KO": "Food/Beverage", "PEP": "Food/Beverage", "MDLZ": "Food/Beverage", "MNST": "Food/Beverage", "STZ": "Food/Beverage", "KDP": "Food/Beverage", "GIS": "Food/Beverage", "HSY": "Food/Beverage", "KHC": "Food/Beverage", "HRL": "Food/Beverage", "TSN": "Food/Beverage", "TAP": "Food/Beverage", "CAG": "Food/Beverage", "MKC": "Food/Beverage", "SJM": "Food/Beverage", "CPB": "Food/Beverage", "ADM": "Food/Beverage", "BG": "Food/Beverage", "WMT": "Staples Retail", "COST": "Staples Retail", "KR": "Staples Retail", "KVUE": "Staples Retail", "PM": "Staples Retail", "MO": "Staples Retail"};

// Sub-industries where averaging down (a second buy at a lower price into
// an already-held position) was found to underperform the simple
// one-position baseline, even with a 3-day minimum gap between buys and
// a blended-cost exit structure tested as a fix. Confirmed via direct
// baseline-vs-scaling comparison, not just observed correlation.
const AVERAGING_DOWN_EXCLUDED_SUBINDUSTRIES = new Set([
  'Hardware', 'Software', 'Staples Retail', 'Integrated/Refining',
  'Travel/Leisure/Lodging', 'Pharma', 'Auto', 'Insurance', 'Apparel/Consumer Products',
]);

function isAveragingDownExcluded(symbol) {
  const sub = SUB_INDUSTRIES[symbol];
  return sub ? AVERAGING_DOWN_EXCLUDED_SUBINDUSTRIES.has(sub) : false;
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

  const tracked = report.trackedPositions?.find(item => item.symbol === ticker);
  if (tracked?.exitStatus?.closed) {
    const gainPct = ((tracked.exitStatus.exitPrice - tracked.entryPrice) / tracked.entryPrice) * 100;
    const reasonLabels = {
      profit_target: "profit target hit", trailing_stop: "trailing stop",
      atr_spike: "volatility spike", score_reversal: "score reversed", ma50_breakdown: "below 50-day avg",
    };
    return {
      status: "SELL_TRIGGER", label: "Active Sell Trigger", color: "#6366f1",
      detail: `${reasonLabels[tracked.exitStatus.exitReason] || tracked.exitStatus.exitReason} · ${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(2)}% since entry`,
      entryDate: tracked.entryDate, entryPrice: tracked.entryPrice,
      historicalStrength: tracked.historicalStrength,
      asOfDate: report.asOfDate,
    };
  }
  if (tracked && !tracked.exitStatus?.closed) {
    const gainPct = ((tracked.lastClose - tracked.entryPrice) / tracked.entryPrice) * 100;
    return {
      status: "SELL_WATCH", label: "Sell Watch", color: "#f97316",
      detail: `Open position, no exit condition met yet · ${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(2)}% since entry`,
      entryDate: tracked.entryDate, entryPrice: tracked.entryPrice,
      historicalStrength: tracked.historicalStrength,
      asOfDate: report.asOfDate,
    };
  }

  return {
    status: "NONE", label: "No Active Signal", color: "#64748b",
    detail: "Not currently meeting buy criteria, no open position being tracked",
    asOfDate: report.asOfDate,
  };
}

function fmtVol(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return n.toLocaleString();
}

// Converts a raw UTC intraday timestamp (e.g. "2026-07-23T19:05") into
// Eastern Time for display -- US markets operate on Eastern hours, and
// the raw API timestamps are UTC, so a naive string slice would show the
// wrong hour. Handles EST/EDT automatically via the America/New_York
// timezone rather than a fixed offset (which would be wrong half the year).
function fmtEasternTime(rawTimestamp) {
  const d = new Date(rawTimestamp.endsWith('Z') ? rawTimestamp : rawTimestamp + 'Z');
  return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
}

// Converts raw technical error messages (like "Upstream data provider
// error (404)") into clear, human-readable ones. Falls back to the
// original message if nothing matches, rather than hiding real errors.
function humanizeError(rawError, ticker) {
  if (/404/.test(rawError)) {
    return `"${ticker}" doesn't look like a valid ticker symbol. Double check the spelling, or use the search suggestions to find the right one.`;
  }
  if (/429/.test(rawError) || /rate limit/i.test(rawError)) {
    return `Too many requests right now -- wait a few seconds and try again.`;
  }
  if (/500|502|503/.test(rawError)) {
    return `The data source is temporarily having trouble. Try again in a moment.`;
  }
  if (/network|fetch failed/i.test(rawError)) {
    return `Couldn't connect -- check your internet connection and try again.`;
  }
  return rawError; // unknown error, show as-is rather than hide it
}

const PriceTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  // Intraday timestamps contain "T" (e.g. "2026-07-23T19:05"); daily dates
  // don't (e.g. "2026-07-23"). Only convert the intraday case to Eastern.
  const displayLabel = label && label.includes('T')
    ? `${label.slice(0, 10)} ${fmtEasternTime(label)} ET`
    : label;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{displayLabel}</p>
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
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [watchListsExpanded, setWatchListsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState("price");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [bars, setBars] = useState([]);
  const [intradayBars, setIntradayBars] = useState([]);
  const [intradayError, setIntradayError] = useState(null);
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
    let t = (symbolOverride || input).trim().toUpperCase();
    if (!t) return;

    // If this isn't already a known ticker, try resolving it as a company
    // name instead (e.g. typing "Apple" should resolve to "AAPL").
    if (!SECTOR_MAP[t]) {
      const matches = searchTickers(t, 1);
      if (matches.length > 0 && matches[0].name.toUpperCase() === t) {
        t = matches[0].symbol;
      }
    }

    setInput(t);
    setShowSuggestions(false);

    setLoading(true);
    setError(null);
    setQuote(null);
    setBars([]);
    setIntradayBars([]);
    setIntradayError(null);
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

      if (quoteData.error) throw new Error(humanizeError(quoteData.error, t));
      if (barsData.error) throw new Error(humanizeError(barsData.error, t));
      if (!quoteData.price) throw new Error(`Couldn't find "${t}" -- double check the ticker symbol, or try searching by company name instead.`);

      setQuote(quoteData);
      setBars(barsData.bars || []);
      setTicker(t);

      // Today's intraday bars -- best-effort, separate from the main fetch.
      // Fires immediately alongside everything else -- alpaca-proxy's
      // rate-limit cooldown key now includes the full query string, so
      // this genuinely different request (different timeframe/date range
      // than the daily bars call above) can never collide with it,
      // regardless of timing. No artificial delay needed.
      const todayStr = new Date().toISOString().slice(0, 10);

      const fetchBars = (url) =>
        fetch(url).then(r => {
          if (r.status === 429) throw new Error('rate_limited');
          return r.json();
        }).then(data => {
          if (data.error) throw new Error(data.error);
          return data.bars || [];
        });

      // Step 1: try today's exact date specifically.
      fetchBars(`${WORKER_URL}/bars?symbol=${t}&timeframe=5Min&start=${todayStr}&end=${todayStr}`)
        .then(bars => {
          if (bars.length > 0) {
            setIntradayBars(bars);
            setIntradayError(null);
            return;
          }
          // Step 2: today's date came back empty (market not open yet
          // today, or already closed with no bars written) -- fall back
          // to the most recent available session instead. This is a
          // genuinely different query (no date range vs. explicit dates)
          // so it also can't collide with step 1's cooldown key.
          fetchBars(`${WORKER_URL}/bars?symbol=${t}&timeframe=5Min&limit=100`)
            .then(bars => {
              setIntradayBars(bars);
              setIntradayError(null);
            })
            .catch(err => {
              setIntradayBars([]);
              setIntradayError(err.message === 'rate_limited' ? 'Rate limited -- try looking this ticker up again' : err.message);
            });
        })
        .catch(err => {
          setIntradayBars([]);
          setIntradayError(err.message === 'rate_limited' ? 'Rate limited -- try looking this ticker up again' : err.message);
        });

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

  function renderRecommendationCategories(categoryKeysToShow) {
              const reasonSeverity = { trailing_stop: 1, ma50_breakdown: 2, score_reversal: 3, atr_spike: 4, profit_target: 5 };
              const trackedPositions = allRecommendations.trackedPositions || [];

              const sellTriggers = trackedPositions
                .filter(item => item.exitStatus && item.exitStatus.closed)
                .sort((a, b) => (reasonSeverity[a.exitStatus.exitReason] || 3) - (reasonSeverity[b.exitStatus.exitReason] || 3));

              const sellWatch = trackedPositions
                .filter(item => item.exitStatus && !item.exitStatus.closed)
                .sort((a, b) => {
                  const gainA = Math.abs((a.lastClose - a.entryPrice) / a.entryPrice);
                  const gainB = Math.abs((b.lastClose - b.entryPrice) / b.entryPrice);
                  return gainB - gainA;
                });

              const categories = {
                long: allRecommendations.long,
                sellTriggers,
                longWatch: allRecommendations.longWatch,
                sellWatch,
              };

              // Second-buy candidate detection, from the paper trading
              // research: a currently-held stock (in the persistent
              // portfolio) that's showing as an active buy signal again,
              // at a price below its held average cost -- the exact rule
              // found to improve returns in most sub-industries tested.
              const heldBySymbol = {};
              for (const h of (allRecommendations.paperPortfolio?.holdings || [])) {
                heldBySymbol[h.symbol] = h;
              }
              function isSecondBuyCandidate(item) {
                const held = heldBySymbol[item.symbol];
                if (!held) return false;
                if (isAveragingDownExcluded(item.symbol)) return false;
                return item.entryPrice < held.entryPrice;
              }
              function isExcludedSecondBuy(item) {
                const held = heldBySymbol[item.symbol];
                if (!held) return false;
                if (!isAveragingDownExcluded(item.symbol)) return false;
                return item.entryPrice < held.entryPrice;
              }

              return [
                { key: "long", label: "Active Buy Signals", color: "#3b82f6" },
                { key: "sellTriggers", label: "Sell Triggers", color: "#6366f1" },
                { key: "longWatch", label: "Buy Watch List", color: "#84cc16" },
                { key: "sellWatch", label: "Sell Watch", color: "#f97316" },
              ].filter(c => categoryKeysToShow.includes(c.key)).map(({ key, label, color }) => {
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
                        const isSecondBuy = key === "long" && isSecondBuyCandidate(item);
                        const isExcludedBuy = key === "long" && isExcludedSecondBuy(item);
                        return (
                          <button
                            key={item.symbol}
                            onClick={() => handleLookup(item.symbol)}
                            disabled={cooldown > 0 || loading}
                            title={
                              isSecondBuy ? "Second-buy candidate: price is below your held average cost" :
                              isExcludedBuy ? "Would be a second-buy candidate, but this sub-industry underperformed averaging down in research" :
                              undefined
                            }
                            style={{
                              background: `${itemColor}1a`, border: `1px solid ${itemColor}66`,
                              borderRadius: isSecondBuy ? 0 : isExcludedBuy ? "50%" : 8,
                              clipPath: isSecondBuy ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : "none",
                              padding: isSecondBuy ? "14px 20px" : isExcludedBuy ? "8px 22px" : "6px 12px",
                              color: itemColor,
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
  }

  const tabs = ["price", "volume", "rsi", "recommendation"];

  return (
    <div style={{
      minHeight: "100vh", background: "#060c18", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 16px",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => {
                const val = e.target.value.toUpperCase();
                setInput(val);
                setError(null);
                setSuggestions(searchTickers(val));
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={e => e.key === "Enter" && handleLookup()}
              placeholder="Ticker or company name"
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
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
              zIndex: 10, maxHeight: 240, overflowY: "auto",
            }}>
              {suggestions.map(s => (
                <div
                  key={s.symbol}
                  onMouseDown={() => { setInput(s.symbol); setShowSuggestions(false); handleLookup(s.symbol); }}
                  style={{
                    padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1e293b",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#3b82f6" }}>{s.symbol}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: 11, color: "#475569", textAlign: "center", marginBottom: 16 }}>
          For informational purposes only. Not financial advice.
        </p>
        <p style={{ textAlign: "center", marginBottom: 16 }}>
          <a href="/color-guide.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}>
            📖 Color Guide
          </a>
        </p>

        {!recsLoading && allRecommendations && (
          <div style={{ marginBottom: 24 }}>
            {allRecommendations.asOfDate && (
              <p style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Recommendations as of {allRecommendations.asOfDate}</p>
            )}
            {renderRecommendationCategories(["long", "sellTriggers"])}
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
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
                      {intradayBars.length > 0 && intradayBars[0].date.slice(0, 10) !== new Date().toISOString().slice(0, 10)
                        ? "Latest Session"
                        : "Today's Price"}
                    </span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>
                      5-min intervals{intradayBars.length > 0 ? ` · ${intradayBars[0].date.slice(0, 10)}` : ""}
                    </span>
                  </div>
                  {intradayBars.length === 0 ? (
                    <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: 13 }}>
                      {loading ? "Loading..." : intradayError ? `Error: ${intradayError}` : "No intraday data available"}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={intradayBars} margin={{ left: 8, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false}
                          tickFormatter={d => fmtEasternTime(d)} interval="preserveStartEnd" />
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
                      {recommendation.status === "SELL_TRIGGER" && (
                        <p style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
                          This position was originally bought as a signal and just triggered one of the 5 exit conditions -- independent of whether it still qualifies as a fresh buy today.
                        </p>
                      )}
                      {recommendation.status === "SELL_WATCH" && (
                        <p style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
                          This position was originally bought as a signal and is still open -- no exit condition has fired yet, but it's being actively tracked.
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

        {!recsLoading && allRecommendations && (allRecommendations.longWatch?.length > 0 || (allRecommendations.trackedPositions || []).some(p => p.exitStatus && !p.exitStatus.closed)) && (
          <div style={{ marginTop: 40 }}>
            <hr style={{ border: "none", borderTop: "1px solid #1e293b", marginBottom: 24 }} />
            <button
              onClick={() => setWatchListsExpanded(v => !v)}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, marginBottom: watchListsExpanded ? 16 : 0,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>Watch Lists</span>
              <span style={{ fontSize: 11, color: "#475569", transform: watchListsExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
            </button>
            {watchListsExpanded && renderRecommendationCategories(["longWatch", "sellWatch"])}
          </div>
        )}
      </div>
    </div>
  );
}
