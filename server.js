/**
 * ============================================================================
 * RENATA PLC (NOAKHALI DEPOT) — WHATSAPP GROUP CRP ORDER TRACKER (v6.0 PRO)
 * DYNAMIC JSON MASTER DATABASE + SELF-LEARNING AI BOT + NEO-BRUTALISM UI
 * ============================================================================
 * What's New in v6.0:
 * 1. Fixed "⚠️ Cloud state backup warning: Your input contains more than the
 *    maximum of 50000 characters in a single cell":
 *    - Every value in _Bot_State (BOT_CONFIG, MASTER_DB_GZIP, WA_AUTH_GZIP) is
 *      now automatically split into strict 30,000-character chunks (well below
 *      Google Sheets' 50,000-character cell limit) and reassembled on restore!
 *    - Excludes bulky full-text messageLogs from MASTER_DB_GZIP (since all
 *      message logs are already saved in the All_Message_Logs worksheet tab
 *      and local master_db.json) and prunes stale Baileys pre-keys/sender-keys.
 *    - Universal safeSheetCell() guard caps every cell written across all tabs
 *      to <= 45,000 characters so Google Sheets NEVER rejects any cell write.
 * 2. Fixed PSO Code Parsing Bug ("Pso t-23", "PSO: E-71", "P.S.O - M-12"):
 *    - Recognizes hyphenated/spaced PSO codes as Territory/PSO codes (T23, E71)
 *      and NEVER treats them as unknown products.
 * 3. Full Message & Sender Number in Pending Questions + Web Edit & Submit:
 *    - Shows full message text and sender phone number whenever a new ID/Name
 *      or unknown product is requested, plus a 1-click "✏️ মেসেজ এডিট ও সাবমিট"
 *      editor modal on Pending Questions, All Message Logs, and Live Orders.
 * 4. All_Message_Logs Tab + Live Auto-Updating Google Sheet Row Numbers:
 *    - Shows ✅ (Saved) or ❌ (Not Saved) and exact Live_Orders Row Numbers
 *      (Row X, Y), which automatically update whenever any row is deleted from
 *      Google Sheets!
 * 5. Baileys 20s Keep-Alive + Persistent Target Group + Last 5 Message IDs:
 *    - Prevents 4-5s code 428/503 disconnects, locks Target Group in
 *      master_db.json, and auto-recovers missed group orders on reconnect.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pino = require('pino');
const { google } = require('googleapis');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  BufferJSON,
  Browsers,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');

// ============================================================================
// 1. CONFIGURATION & ENVIRONMENT VARIABLES
// ============================================================================
const PORT = process.env.PORT || 3000;
const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || '1lvZG2PWV0HjjbVBZjrV14brxYDizfmGm4yYj2mUYkF0').trim();
const RENDER_EXTERNAL_URL = (process.env.RENDER_EXTERNAL_URL || '').trim();
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const LOCAL_CONFIG_PATH = path.join(__dirname, 'bot_config.json');
const MASTER_DB_PATH = path.join(__dirname, 'master_db.json');

const DEFAULT_ADMIN_ALERT_PHONES = ['8801793362829'];
const DEFAULT_AUTHORIZED_IMAGE_PHONES = ['8801732273944', '8801793362829'];

const DEFAULT_AUTHORIZED_LIDS = [
  '259794032148540', // +8801732273944
  '51243288424651',  // +8801793362829
  '188738965659721'  // Connected Bot Account (Moajjem)
];

const SHEET_TABS = {
  LIVE_ORDERS: 'Live_Orders',
  MESSAGE_LOGS: 'All_Message_Logs',
  DA_SUMMARY: 'DA_Wise_Summary',
  PRODUCT_SUMMARY: 'Product_Wise_Summary',
  DELETED_LOG: 'Deleted_Unsent_Log',
  BOT_STATE: '_Bot_State'
};

// Strict cell-size limits to prevent Google Sheets "maximum of 50000 characters in a single cell" error
const MAX_STATE_CHUNK_CHARS = 30000;
const MAX_SHEET_CELL_CHARS = 45000;

function safeSheetCell(val, maxLen = MAX_SHEET_CELL_CHARS) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

const DEFAULT_CRP_PRODUCTS = [
  {
    "code": "919",
    "name": "TOTIFEN SYRUP 100ML",
    "unit": "Bottle (100ml)",
    "price": 47.23,
    "family": "TOTIFEN",
    "aliases": [
      "totifen",
      "totipen",
      "totifin",
      "totefen",
      "totifan",
      "totifen syp",
      "totifen syr",
      "totifen sry",
      "totifen 100ml",
      "totifen syrh",
      "totifan syp",
      "totifen sy",
      "totifan 100  ml sy",
      "totifan 100 ml",
      "totifan 100 ml sy",
      "totifen 100 ml",
      "totifen sy  100ml",
      "totifen sy 100ml",
      "totifen syrup",
      "totifen.",
      "totifen100ml",
      "totifin syp"
    ]
  },
  {
    "code": "81",
    "name": "DOXICAP 100MG CAP 100'S",
    "unit": "Box (100's)",
    "price": 165.0,
    "family": "DOXICAP",
    "aliases": [
      "doxicap",
      "doxicup",
      "doxycap",
      "doxy cap",
      "doxicap 100mg",
      "doxicap cap",
      "doxecap",
      "doxcicap",
      "doxicap100cap"
    ]
  },
  {
    "code": "990",
    "name": "DOMIREN SUSPENSION 100ML 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 28.49,
    "family": "DOMIREN",
    "aliases": [
      "domiren 100ml",
      "domiren syp",
      "domiren syr",
      "domiren sry",
      "domeren 100ml",
      "domiren 100",
      "domiren susp",
      "domiren100ml"
    ]
  },
  {
    "code": "286",
    "name": "DOMIREN SUSPENSION 60ML 1'S",
    "unit": "Bottle (60ml)",
    "price": 26.24,
    "family": "DOMIREN",
    "aliases": [
      "domiren 60ml",
      "domeren 60ml",
      "domiren 60",
      "sy domira 60"
    ]
  },
  {
    "code": "60",
    "name": "DOMIREN FC TAB 10MG 100'S",
    "unit": "Box (100's)",
    "price": 151.0,
    "family": "DOMIREN",
    "aliases": [
      "domiren tab",
      "domeren tab",
      "domiren fc tab",
      "domiren 10mg",
      "domiren tablet",
      "domiren tb",
      "domniren tab"
    ]
  },
  {
    "code": "636",
    "name": "DELTASONE ORAL SOLUTION 50ML 1X1'S",
    "unit": "Bottle (50ml)",
    "price": 44.98,
    "family": "DELTASONE",
    "aliases": [
      "deltasone 50ml",
      "deltason 50ml",
      "daltasone 50ml",
      "daltason 50ml",
      "delta sone 50ml",
      "delta som",
      "dellthesun",
      "deltasone syp",
      "deltason syr",
      "deltason sry",
      "delterson 50ml",
      "deltarson 50ml",
      "deltasone 50 ml",
      "deltason 50 ml",
      "deltason5 17/30 box",
      "deltason50 syp ml",
      "deltasone 50 ml sy",
      "deltasone 50 ml syp",
      "deltasone 50 ml syr",
      "deltasone 50ml syr",
      "deltasone syp 50ml"
    ]
  },
  {
    "code": "637",
    "name": "DELTASONE ORAL SOLUTION 100ML 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 71.21,
    "family": "DELTASONE",
    "aliases": [
      "deltasone 100ml",
      "deltason 100ml",
      "daltasone 100ml",
      "daltason 100ml",
      "delta sone 100ml",
      "deltasone 100"
    ]
  },
  {
    "code": "CS7",
    "name": "DELTASONE 5MG TAB 17X30'S",
    "unit": "Box (17x30's)",
    "price": 657.9,
    "family": "DELTASONE",
    "aliases": [
      "deltasone tab",
      "deltason tab",
      "daltasone tap",
      "deltasone 5mg",
      "deltason 5mg",
      "deltasonne tab",
      "deltasone 17x30",
      "deltason tab 17/30"
    ]
  },
  {
    "code": "922",
    "name": "PRAZOLE 20MG CAP 6X10'S",
    "unit": "Box (6x10's)",
    "price": 225.0,
    "family": "PRAZOLE",
    "aliases": [
      "prazole",
      "prazol",
      "parzol",
      "prajol",
      "frazol",
      "pazal",
      "prazole 20mg",
      "prazol cap",
      "parzole 20cap",
      "prazal 20 cap",
      "prazzole",
      "prazole 20 cap",
      "prazole 20 mg",
      "prazole 20 mg cap",
      "prazole 20cap",
      "prazole20 mg",
      "prazole20cap"
    ]
  },
  {
    "code": "271",
    "name": "ZITHRIN DRY SYRUP 35ML",
    "unit": "Bottle (35ml)",
    "price": 104.95,
    "family": "ZITHRIN",
    "aliases": [
      "zithrin 35ml",
      "zitrin 35ml",
      "zithrin 35",
      "zitrin 35",
      "zitthrin",
      "zithren",
      "zithrin dry syrup",
      "zithrin syp",
      "zithrin syr",
      "zithren 35ml",
      "zithrin 35 ml",
      "zithrin 35 ml syp",
      "zithrin 35 ml syr",
      "zithrin 35ml syp",
      "zithrin 35ml syr",
      "zithrin.   35ml",
      "zitrhin 35 ml",
      "zitrtin 35 ml",
      "zitrtin 35 sryp",
      "zitrtin 35 syrp",
      "zrithrin 35 ml"
    ]
  },
  {
    "code": "290",
    "name": "ZITHRIN DRY SYRUP 50ML",
    "unit": "Bottle (50ml)",
    "price": 149.93,
    "family": "ZITHRIN",
    "aliases": [
      "zithrin 50ml",
      "zitrin 50ml",
      "zithrin 50",
      "zitrin 50",
      "zrithrin 50ml",
      "zithrin 50 ml",
      "zithrin 50 ml syp",
      "zithrin 50ml :",
      "zithrin.   50ml"
    ]
  },
  {
    "code": "270",
    "name": "ZITHRIN DRY SYRUP 20ML",
    "unit": "Bottle (20ml)",
    "price": 74.96,
    "family": "ZITHRIN",
    "aliases": [
      "zithrin 20ml",
      "zitrin 20ml",
      "zithirin 20ml",
      "zithrin 20",
      "zithrin 20 ml",
      "zithrin 20ml syr",
      "zithrin 35ml",
      "zitrin 35 ml"
    ]
  },
  {
    "code": "173",
    "name": "ZITHRIN DRY SYRUP 15ML",
    "unit": "Bottle (15ml)",
    "price": 71.21,
    "family": "ZITHRIN",
    "aliases": [
      "zithrin 15ml",
      "ziyhrin 15ml",
      "zithrin 15"
    ]
  },
  {
    "code": "834",
    "name": "ZITHRIN 30ML SUSPENSION 1'S",
    "unit": "Bottle (30ml)",
    "price": 103.45,
    "family": "ZITHRIN",
    "aliases": [
      "zithrin 30ml",
      "zitrin 30ml",
      "zithrin 30"
    ]
  },
  {
    "code": "278",
    "name": "XAMIC 500MG CAP (2X10'S)",
    "unit": "Box (2x10's)",
    "price": 329.8,
    "family": "XAMIC",
    "aliases": [
      "xamic",
      "xamic cap",
      "xamic 500mg",
      "xamic capsule",
      "xmaic",
      "examic"
    ]
  },
  {
    "code": "635",
    "name": "RECOF 100ML SYRUP 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 29.99,
    "family": "RECOF",
    "aliases": [
      "recof",
      "recop",
      "recof syp",
      "recof syr",
      "recof sry",
      "recof 100ml",
      "recof syraf",
      "recofe 100 ml",
      "recof  syp",
      "recof 100 ml",
      "recof sy",
      "recof syrp",
      "recof. sy",
      "rocof"
    ]
  },
  {
    "code": "299",
    "name": "TRULAX SYRUP 1MG/5ML 100ML 1'S",
    "unit": "Bottle (100ml)",
    "price": 33.73,
    "family": "TRULAX",
    "aliases": [
      "trulax",
      "tulax",
      "trulex",
      "trulax syr",
      "trulax syp",
      "trulax sry",
      "trulax 100ml",
      "trulux syp",
      "trulax sy",
      "trulax100ml",
      "tulax syrup"
    ]
  },
  {
    "code": "112",
    "name": "LUCAN-R SUSP. 35ML",
    "unit": "Bottle (35ml)",
    "price": 58.7,
    "family": "LUCAN-R",
    "aliases": [
      "lucan r 35ml",
      "lucan-r 35ml",
      "locan r sry",
      "lucan r syp",
      "lucan r syr",
      "lukan r syp",
      "luknar syraf",
      "lokanar",
      "lucon r syp",
      "lucanar syp",
      "lucar sry",
      "luna r",
      "lucanr syp",
      "luknar sy",
      "lunch -r 35ml syp",
      "lucan r",
      "lucan r 35 ml",
      "lucan r 35 ml sy",
      "lucan r 35 sy",
      "lucan r 35ml syp",
      "lucan r sry",
      "lucan r syrp",
      "lucan- r 35ml syp",
      "lucan-r sup",
      "lucan-r syp",
      "lunch -r sup"
    ]
  },
  {
    "code": "876",
    "name": "LUCAN-R 50MG CAP 4x10'S",
    "unit": "Box (4x10's)",
    "price": 240.8,
    "family": "LUCAN-R",
    "aliases": [
      "lucan r 50mg",
      "locan r 50mg",
      "lucan-r 50mg",
      "lukan r 50",
      "lacan r 50mg",
      "lucan r 50",
      "lucan r50",
      "lucan",
      "lucan r",
      "lucan r 50 cap",
      "lucan r 50 mg",
      "lucan r50mg",
      "lucan-r",
      "lucanr"
    ]
  },
  {
    "code": "605",
    "name": "LUCAN-R 150MG CAPS 2X6",
    "unit": "Box (2x6's)",
    "price": 198.6,
    "family": "LUCAN-R",
    "aliases": [
      "lucan r 150mg",
      "locan r 150mg",
      "lucan-r 150mg",
      "lucan r 150",
      "locan r 150",
      "luknar 150",
      "lucon r 150",
      "lunch 150",
      "luconar 150 mg",
      "luknar150",
      "lucan",
      "lucan r",
      "lucan r 150 mg",
      "lucan r150 mg cap",
      "lucan r150mg",
      "lucan-r",
      "lucanar",
      "lucanr",
      "lukan r 150mg",
      "luknar"
    ]
  },
  {
    "code": "621",
    "name": "LUCAN-R 200MG CAPS 2X6",
    "unit": "Box (2x6's)",
    "price": 224.88,
    "family": "LUCAN-R",
    "aliases": [
      "lucan r 200mg",
      "locan r 200mg",
      "lucan-r 200mg",
      "lucan r 200",
      "locan r 200",
      "lucanar 200",
      "luknar 200tb",
      "lucan r",
      "lucan r 200 mg",
      "lucan-r"
    ]
  },
  {
    "code": "96",
    "name": "FLONTIN 500MG TAB 3X10'S",
    "unit": "Box (3x10's)",
    "price": 337.2,
    "family": "FLONTIN",
    "aliases": [
      "flontin 500",
      "flontin tab",
      "flontin 500mg",
      "flotin 500",
      "foltin 500",
      "foltin tab",
      "flonten 500 mg cap",
      "flontin",
      "flontin 500 tab",
      "flontin500",
      "flontine",
      "flotin",
      "flotin 500 tab",
      "foltin"
    ]
  },
  {
    "code": "226",
    "name": "FLONTIN SUSPENSION 60ML 1'S",
    "unit": "Bottle (60ml)",
    "price": 74.96,
    "family": "FLONTIN",
    "aliases": [
      "flontin 60ml",
      "flontin syp",
      "flontin syr",
      "flontin susp",
      "flotin syp"
    ]
  },
  {
    "code": "179",
    "name": "NORMANAL 500MG FC TAB (3X10'S)",
    "unit": "Box (3x10's)",
    "price": 202.5,
    "family": "NORMANAL",
    "aliases": [
      "normanal",
      "normanal 500",
      "normanal tab",
      "normanol 500 tab",
      "normal 500",
      "narmonal",
      "normal",
      "normanal 500 mg",
      "normanal 500 mg cap"
    ]
  },
  {
    "code": "102",
    "name": "FUROCEF FC SUSPENSION 70ML 1X1'S",
    "unit": "Bottle (70ml)",
    "price": 168.67,
    "family": "FUROCEF",
    "aliases": [
      "furocef 70ml",
      "furocef 70 ml",
      "furocef syp",
      "furocef susp",
      "fourocef 70 ml",
      "furochef 70ml",
      "furosef 70ml",
      "furcif sy",
      "fucocef 70ml",
      "furocef 70 ml syp",
      "furocef 70ml syp",
      "furocef d's",
      "furucef 70 ml syp",
      "spr: furocef 70 ml"
    ]
  },
  {
    "code": "S72",
    "name": "FUROCEF DS SUSPENSION 50ML 1X1'S",
    "unit": "Bottle (50ml)",
    "price": 187.41,
    "family": "FUROCEF",
    "aliases": [
      "furocef ds",
      "furocef 50ml",
      "furocef ds 50ml",
      "furocef ds 50 ml"
    ]
  },
  {
    "code": "S16",
    "name": "VITA D3 40000 IU CAP 2X5'S",
    "unit": "Box (2x5's)",
    "price": 262.4,
    "family": "VITA",
    "aliases": [
      "vita d3 40000",
      "vita d3 40000 iu",
      "vita d3",
      "vita 40000 cap",
      "vitad3 40000",
      "vita d",
      "vita d3 40;000",
      "vita d340000",
      "vitad"
    ]
  },
  {
    "code": "S15",
    "name": "VITA D3 20000 IU CAP 2X5'S",
    "unit": "Box (2x5's)",
    "price": 149.9,
    "family": "VITA",
    "aliases": [
      "vita d3 20000",
      "vita d3 20000 iu",
      "vita d3 20000 cap",
      "vitad-20000",
      "vitad3 20000 cap",
      "vita d3"
    ]
  },
  {
    "code": "SA4",
    "name": "NEXDEX 30MG CAP 6X10'S",
    "unit": "Box (6x10's)",
    "price": 450.0,
    "family": "NEXDEX",
    "aliases": [
      "nexdex 30",
      "nexdex 30mg",
      "nexdex",
      "nexdex 30 mg",
      "nexdex 30 cao"
    ]
  },
  {
    "code": "SA1",
    "name": "NEXDEX 60MG CAP 5X6'S",
    "unit": "Box (5x6's)",
    "price": 404.7,
    "family": "NEXDEX",
    "aliases": [
      "nexdex 60",
      "nexdex 60mg",
      "nexdex 60 mg"
    ]
  },
  {
    "code": "C2Z",
    "name": "PCAB FC 20MG TAB 3X10'S",
    "unit": "Box (3x10's)",
    "price": 225.0,
    "family": "PCAB",
    "aliases": [
      "pcab 20",
      "pcab 20mg",
      "pcab",
      "p cab 20"
    ]
  },
  {
    "code": "C2Y",
    "name": "PCAB FC 10MG TAB 3X10'S",
    "unit": "Box (3x10's)",
    "price": 157.5,
    "family": "PCAB",
    "aliases": [
      "pcab 10",
      "pcab 10mg",
      "p cab 10"
    ]
  },
  {
    "code": "C25",
    "name": "FERIX-V CAP 6X10'S",
    "unit": "Box (6x10's)",
    "price": 202.2,
    "family": "FERIX-V",
    "aliases": [
      "ferix v",
      "ferix-v",
      "ferix v cap",
      "frix v"
    ]
  },
  {
    "code": "959",
    "name": "DESOLON TAB 1X21'S",
    "unit": "Pack (1x21's)",
    "price": 90.51,
    "family": "DESOLON",
    "aliases": [
      "desolon",
      "desolon tab",
      "desalon",
      "deslon",
      "dasalon"
    ]
  },
  {
    "code": "633",
    "name": "EMCON-1 1X1'S",
    "unit": "Pack (1x1's)",
    "price": 60.34,
    "family": "EMCON-1",
    "aliases": [
      "emcon",
      "emcon 1",
      "emcon-1",
      "em con"
    ]
  },
  {
    "code": "67",
    "name": "CONASYD CREAM 10MG",
    "unit": "Tube (10g)",
    "price": 47.23,
    "family": "CONASYD",
    "aliases": [
      "conasyd",
      "conasyd cream",
      "conased",
      "conased cream",
      "conasid creem",
      "conased crime",
      "conasyd."
    ]
  },
  {
    "code": "SA3",
    "name": "REDUCOF 100ML SYRP 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 74.96,
    "family": "REDUCOF",
    "aliases": [
      "reducof",
      "reducof syp",
      "reducof syr",
      "reducof 100ml",
      "redocof sy",
      "riducofe 100 ml",
      "reducof sry",
      "reducof.syp",
      "reducof:100mi"
    ]
  },
  {
    "code": "961",
    "name": "GESTRENOL TAB 5MG 3X10'S",
    "unit": "Box (3x10's)",
    "price": 180.6,
    "family": "GESTRENOL",
    "aliases": [
      "gestrenol",
      "gestrenol tab",
      "gestonal",
      "gestanol"
    ]
  },
  {
    "code": "SM1",
    "name": "EXICOF 100ML SYRUP 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 59.97,
    "family": "EXICOF",
    "aliases": [
      "exicof",
      "exicof syp",
      "exicof syr",
      "exicof 100ml",
      "exicof sry",
      "exicof  100 ml sy",
      "exicof 100 ml",
      "exicof:100mi"
    ]
  },
  {
    "code": "SY1",
    "name": "RENASONE 10G CREAM 1X1'S",
    "unit": "Tube (10g)",
    "price": 38.98,
    "family": "RENASONE",
    "aliases": [
      "renasone",
      "renasone cream",
      "renason cream",
      "renasone crem",
      "reason cream",
      "reasone",
      "renason",
      "renason creem",
      "renasone cream.",
      "renasone crim"
    ]
  },
  {
    "code": "34",
    "name": "BECONEX SYRUP 200ML 1'S",
    "unit": "Bottle (200ml)",
    "price": 46.48,
    "family": "BECONEX",
    "aliases": [
      "beconex 200ml",
      "beconex 200 ml",
      "beconex 200",
      "biconex 200 ml",
      "beconex 200ml syp",
      "beconex zi",
      "beconex200ml"
    ]
  },
  {
    "code": "33",
    "name": "BECONEX SYRUP 100ML 1'S",
    "unit": "Bottle (100ml)",
    "price": 26.24,
    "family": "BECONEX",
    "aliases": [
      "beconex 100ml",
      "beconex 100 ml",
      "beconex 100",
      "beconex syp",
      "beconix 100 ml sy",
      "beconex.100ml"
    ]
  },
  {
    "code": "233",
    "name": "BECONEX ZI SYRUP 100ML",
    "unit": "Bottle (100ml)",
    "price": 43.48,
    "family": "BECONEX",
    "aliases": [
      "beconex zi",
      "beconex zi 100ml",
      "beconex zi syp"
    ]
  },
  {
    "code": "C82",
    "name": "STARK 60ML ORAL SOLUTION 1X1'S",
    "unit": "Bottle (60ml)",
    "price": 56.22,
    "family": "STARK",
    "aliases": [
      "stark",
      "stark 60ml",
      "stark syp",
      "stark syr",
      "strak sy",
      "stack 60ml",
      "stack 60ml syr",
      "stark 60 ml",
      "stark 60 ml sy",
      "stark srp",
      "stark sy"
    ]
  },
  {
    "code": "267",
    "name": "PROTONIL EC 40MG TAB 3X10'S",
    "unit": "Box (3x10's)",
    "price": 202.5,
    "family": "PROTONIL",
    "aliases": [
      "protonil 40",
      "protonil 40mg",
      "potonil 40"
    ]
  },
  {
    "code": "266",
    "name": "PROTONIL EC 20MG TAB 5X10'S",
    "unit": "Box (5x10's)",
    "price": 225.0,
    "family": "PROTONIL",
    "aliases": [
      "protonil 20",
      "protonil 20mg",
      "protonil",
      "potonil 20"
    ]
  },
  {
    "code": "138",
    "name": "POLYCEF SYRUP 100ML",
    "unit": "Bottle (100ml)",
    "price": 67.47,
    "family": "POLYCEF",
    "aliases": [
      "polycef",
      "polycef 100ml",
      "polycef syp"
    ]
  },
  {
    "code": "875",
    "name": "BREDICON TAB 28'S",
    "unit": "Pack (28's)",
    "price": 52.08,
    "family": "BREDICON",
    "aliases": [
      "bredicon",
      "bredicon tab",
      "bedicon",
      "badecon tab"
    ]
  },
  {
    "code": "S34",
    "name": "PANGESIC TAB 5X6'S",
    "unit": "Box (5x6's)",
    "price": 180.0,
    "family": "PANGESIC",
    "aliases": [
      "pangesic",
      "pangesic tab"
    ]
  },
  {
    "code": "934",
    "name": "CALCIN-D TAB 6X10'S",
    "unit": "Box (6x10's)",
    "price": 360.0,
    "family": "CALCIN-D",
    "aliases": [
      "calcin d",
      "calcin-d",
      "calcin d tab",
      "calcin d 60mg"
    ]
  },
  {
    "code": "607",
    "name": "FLUSTAR 500MG CAP 7X4'S",
    "unit": "Box (7x4's)",
    "price": 210.0,
    "family": "FLUSTAR",
    "aliases": [
      "flustar 500",
      "flustar cap",
      "flustar 500mg",
      "flustar"
    ]
  },
  {
    "code": "N33",
    "name": "FLUSTAR 100ML DRY SYS 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 44.98,
    "family": "FLUSTAR",
    "aliases": [
      "flustar 100ml",
      "flustar syp",
      "flustar dry syp"
    ]
  },
  {
    "code": "282",
    "name": "NORRY 3MG TAB 5X10'S",
    "unit": "Box (5x10's)",
    "price": 262.5,
    "family": "NORRY",
    "aliases": [
      "norry",
      "norry 3mg",
      "norry tab"
    ]
  },
  {
    "code": "CO6",
    "name": "ZODEF 60ML SUSP 1X1'S",
    "unit": "Bottle (60ml)",
    "price": 149.93,
    "family": "ZODEF",
    "aliases": [
      "zodef",
      "zodef 60ml",
      "zodef syp",
      "jodef"
    ]
  },
  {
    "code": "902",
    "name": "SALINE-R 20'S",
    "unit": "Box (20's)",
    "price": 90.0,
    "family": "SALINE-R",
    "aliases": [
      "saline r",
      "saline-r",
      "salin r"
    ]
  },
  {
    "code": "232",
    "name": "HONYCOL LINCTUS 100ML",
    "unit": "Bottle (100ml)",
    "price": 29.99,
    "family": "HONYCOL",
    "aliases": [
      "honycol",
      "honycol 100ml",
      "honycol syp"
    ]
  },
  {
    "code": "955",
    "name": "THYROX 50MCG 3X30'S",
    "unit": "Box (3x30's)",
    "price": 148.5,
    "family": "THYROX",
    "aliases": [
      "thyrox",
      "thyrox 50",
      "thyrox 50mcg"
    ]
  },
  {
    "code": "T28",
    "name": "NUTRILINA 500MG VEG CAP 5X6'S",
    "unit": "Box (5x6's)",
    "price": 310.35,
    "family": "NUTRILINA",
    "aliases": [
      "nutrilina",
      "nutrilina 500",
      "nutrilina cap"
    ]
  },
  {
    "code": "N49",
    "name": "RECOX FC 120MG TAB 2X10'S",
    "unit": "Box (2x10's)",
    "price": 209.8,
    "family": "RECOX",
    "aliases": [
      "recox 120",
      "recox 120mg",
      "recox"
    ]
  },
  {
    "code": "N47",
    "name": "RECOX FC 90MG TAB 2X10'S",
    "unit": "Box (2x10's)",
    "price": 180.0,
    "family": "RECOX",
    "aliases": [
      "recox 90",
      "recox 90mg"
    ]
  },
  {
    "code": "SZ5",
    "name": "COPNAT N OINTMENT 15GM 1'S",
    "unit": "Tube (15g)",
    "price": 52.47,
    "family": "COPNAT",
    "aliases": [
      "copnat n ointment",
      "copnat ointment",
      "copnat oint"
    ]
  },
  {
    "code": "SZ4",
    "name": "COPNAT N CREAM 15GM 1'S",
    "unit": "Tube (15g)",
    "price": 52.47,
    "family": "COPNAT",
    "aliases": [
      "copnat n cream",
      "copnat cream",
      "copnat"
    ]
  },
  {
    "code": "SI1",
    "name": "FUROCLAV 70ML DRY PWD SUSP 1X1'S",
    "unit": "Bottle (70ml)",
    "price": 198.65,
    "family": "FUROCLAV",
    "aliases": [
      "furoclav",
      "furoclav 70ml",
      "furoclav syp"
    ]
  },
  {
    "code": "H39",
    "name": "MOODS ALL-NIGHT",
    "unit": "Pack (3's)",
    "price": 50.0,
    "family": "MOODS",
    "aliases": [
      "moods all night",
      "moods all-night"
    ]
  },
  {
    "code": "H37",
    "name": "MOODS DOTTED",
    "unit": "Pack (3's)",
    "price": 50.0,
    "family": "MOODS",
    "aliases": [
      "moods dotted",
      "moods"
    ]
  },
  {
    "code": "H89",
    "name": "MOODS GOLD 1500 DOTS 3'S",
    "unit": "Pack (3's)",
    "price": 65.0,
    "family": "MOODS",
    "aliases": [
      "moods gold 1500",
      "moods 1500 dots",
      "moods gold"
    ]
  },
  {
    "code": "H88",
    "name": "MOODS GOLD ELECTRIFY 3'S",
    "unit": "Pack (3's)",
    "price": 65.0,
    "family": "MOODS",
    "aliases": [
      "moods electrify",
      "moods gold electrify"
    ]
  },
  {
    "code": "H34",
    "name": "MOODS ULTA-THIN",
    "unit": "Pack (3's)",
    "price": 50.0,
    "family": "MOODS",
    "aliases": [
      "moods ultra thin",
      "moods ulta-thin"
    ]
  },
  {
    "code": "CY7",
    "name": "HYDROGEST DS 2ML (500MG/2ML) INJ 1X1'S",
    "unit": "Ampoule (1x1's)",
    "price": 487.26,
    "family": "HYDROGEST",
    "aliases": [
      "hydrogest",
      "hydrogest ds",
      "hydrogest inj"
    ]
  },
  {
    "code": "73",
    "name": "DELENTIN SUSPENSION 10ML 1'S",
    "unit": "Bottle (10ml)",
    "price": 12.03,
    "family": "DELENTIN",
    "aliases": [
      "delentin",
      "delentin 10ml",
      "delentine"
    ]
  },
  {
    "code": "933",
    "name": "FENADIN SUSPENSION 50ML",
    "unit": "Bottle (50ml)",
    "price": 41.23,
    "family": "FENADIN",
    "aliases": [
      "fenadin 50ml",
      "fenadin syp",
      "fenadin 50"
    ]
  },
  {
    "code": "69",
    "name": "FENADIN 30ML SUSPENSION 1'S",
    "unit": "Bottle (30ml)",
    "price": 26.24,
    "family": "FENADIN",
    "aliases": [
      "fenadin 30ml",
      "fenadin 30"
    ]
  },
  {
    "code": "N45",
    "name": "NOVELON LITE FC TAB 1X24'S",
    "unit": "Pack (1x24's)",
    "price": 366.38,
    "family": "NOVELON",
    "aliases": [
      "novelon",
      "novelon lite",
      "novelon tab"
    ]
  },
  {
    "code": "840",
    "name": "EMEREN 50ML SYRP 1X1'S",
    "unit": "Bottle (50ml)",
    "price": 22.49,
    "family": "EMEREN",
    "aliases": [
      "emeren",
      "emeren 50ml",
      "emeren syp"
    ]
  },
  {
    "code": "989",
    "name": "ALGIN SYRP 100ML 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 67.47,
    "family": "ALGIN",
    "aliases": [
      "algin 100ml",
      "algin syp",
      "algin 100"
    ]
  },
  {
    "code": "C62",
    "name": "ALGIN 50ML SYRP 1X1'S",
    "unit": "Bottle (50ml)",
    "price": 41.23,
    "family": "ALGIN",
    "aliases": [
      "algin 50ml",
      "algin 50"
    ]
  },
  {
    "code": "16",
    "name": "MAZIC JR 100ML 4.05MG/5ML SYRP 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 28.49,
    "family": "MAZIC",
    "aliases": [
      "mazic jr",
      "mazic jr 100ml",
      "mazic jr sy"
    ]
  },
  {
    "code": "18",
    "name": "MAZIC 10MG/5ML 100ML 1X1'S",
    "unit": "Bottle (100ml)",
    "price": 26.24,
    "family": "MAZIC",
    "aliases": [
      "mazic 100ml",
      "mazic syp",
      "mazic"
    ]
  },
  {
    "code": "DF4",
    "name": "ALLUREN 100G PWD",
    "unit": "Pack (100g)",
    "price": 262.37,
    "family": "ALLUREN",
    "aliases": [
      "alluren",
      "alluren 100g",
      "alluren pwd"
    ]
  }
];

const DEFAULT_DA_MASTER = [
  {
    "daId": "CF9054",
    "altId": "",
    "name": "Md Rakib Hossain",
    "phones": [
      "8801602791043"
    ],
    "aliases": [
      "md rakib hossain",
      "cf9054"
    ]
  },
  {
    "daId": "RF20363",
    "altId": "",
    "name": "Ikbal Hossain (Sharif)",
    "phones": [
      "8801839551851"
    ],
    "aliases": [
      "ikbal hossain (sharif)",
      "rf20363"
    ]
  },
  {
    "daId": "CF10593",
    "altId": "C122227",
    "name": "Abdul Alim",
    "phones": [],
    "aliases": [
      "abdul alim",
      "cf10593",
      "c122227",
      "abdul alim da"
    ]
  },
  {
    "daId": "RF20360",
    "altId": "",
    "name": "Dawdul Islam Sobuj",
    "phones": [
      "8801805481935",
      "8801838675803"
    ],
    "aliases": [
      "dawdul islam sobuj",
      "rf20360"
    ]
  },
  {
    "daId": "CF8970",
    "altId": "",
    "name": "Abdullah Al Mamun",
    "phones": [
      "8801878160083"
    ],
    "aliases": [
      "abdullah al mamun",
      "cf8970"
    ]
  },
  {
    "daId": "CF9012",
    "altId": "",
    "name": "Abdur Rahim Saikat",
    "phones": [],
    "aliases": [
      "abdur rahim saikat",
      "cf9012",
      "_saikat_khan_"
    ]
  },
  {
    "daId": "C122210",
    "altId": "",
    "name": "Jahid Mondol",
    "phones": [
      "8801854272016",
      "8801804892343"
    ],
    "aliases": [
      "jahid mondol",
      "c122210"
    ]
  },
  {
    "daId": "C210015",
    "altId": "",
    "name": "Daud Ul Islam",
    "phones": [],
    "aliases": [
      "daud ul islam",
      "c210015",
      "daudmahmud5829"
    ]
  },
  {
    "daId": "CF8971",
    "altId": "",
    "name": "Mehedi Hassan",
    "phones": [
      "8801805481946",
      "8801617729981"
    ],
    "aliases": [
      "mehedi hassan",
      "cf8971"
    ]
  },
  {
    "daId": "CF4526",
    "altId": "",
    "name": "Seraj",
    "phones": [
      "8801864482005"
    ],
    "aliases": [
      "seraj",
      "cf4526"
    ]
  },
  {
    "daId": "C210012",
    "altId": "",
    "name": "Arfin Rasel (Rasel Hossain 2)",
    "phones": [],
    "aliases": [
      "arfin rasel (rasel hossain 2)",
      "c210012",
      "arfin rasel da nk"
    ]
  },
  {
    "daId": "CF9011",
    "altId": "",
    "name": "Robiul Hossain (Robiul 1)",
    "phones": [
      "8801845540077"
    ],
    "aliases": [
      "robiul hossain (robiul 1)",
      "cf9011"
    ]
  },
  {
    "daId": "C210006",
    "altId": "",
    "name": "Md Sajib Uddin (Hatiya)",
    "phones": [],
    "aliases": [
      "md sajib uddin (hatiya)",
      "c210006",
      "sojib nk depot hatiya"
    ]
  },
  {
    "daId": "C122184",
    "altId": "",
    "name": "Rezaul Haque",
    "phones": [
      "8801856006064",
      "8801782563961"
    ],
    "aliases": [
      "rezaul haque",
      "c122184"
    ]
  },
  {
    "daId": "CF10592",
    "altId": "C122225",
    "name": "Md Robiul",
    "phones": [
      "8801805481962",
      "8801650287369"
    ],
    "aliases": [
      "md robiul",
      "cf10592",
      "c122225"
    ]
  },
  {
    "daId": "CF9067",
    "altId": "",
    "name": "Md Ajgor Hossen",
    "phones": [
      "8801815499442"
    ],
    "aliases": [
      "md ajgor hossen",
      "cf9067"
    ]
  },
  {
    "daId": "C122229",
    "altId": "",
    "name": "Md Abubakkar",
    "phones": [
      "8801615197377"
    ],
    "aliases": [
      "md abubakkar",
      "c122229"
    ]
  },
  {
    "daId": "C210004",
    "altId": "",
    "name": "Sahadat Hossain",
    "phones": [
      "8801850323315"
    ],
    "aliases": [
      "sahadat hossain",
      "c210004"
    ]
  },
  {
    "daId": "CF10589",
    "altId": "C122197",
    "name": "DA ID CF10589 / C122197",
    "phones": [
      "8801641195494"
    ],
    "aliases": [
      "da id cf10589 / c122197",
      "cf10589",
      "c122197"
    ]
  },
  {
    "daId": "CF4706",
    "altId": "",
    "name": "Md Sumon Miah",
    "phones": [
      "8801805481944"
    ],
    "aliases": [
      "md sumon miah",
      "cf4706"
    ]
  },
  {
    "daId": "C122231",
    "altId": "",
    "name": "Md Rakib Molla",
    "phones": [
      "8801805481966",
      "8801637011890"
    ],
    "aliases": [
      "md rakib molla",
      "c122231"
    ]
  },
  {
    "daId": "C210021",
    "altId": "",
    "name": "Md Mahbubul Haque",
    "phones": [],
    "aliases": [
      "md mahbubul haque",
      "c210021",
      "mdmahbubulhaque765"
    ]
  },
  {
    "daId": "C210025",
    "altId": "",
    "name": "Mosharef Hossin",
    "phones": [
      "8801865472523"
    ],
    "aliases": [
      "mosharef hossin",
      "c210025"
    ]
  },
  {
    "daId": "RF20359",
    "altId": "",
    "name": "Mamunur Rashid",
    "phones": [
      "8801805481934",
      "8801852118166"
    ],
    "aliases": [
      "mamunur rashid",
      "rf20359"
    ]
  },
  {
    "daId": "CF10588",
    "altId": "C122185",
    "name": "Md Mamun Hossain",
    "phones": [],
    "aliases": [
      "md mamun hossain",
      "cf10588",
      "c122185",
      "mamun da nk depot ren"
    ]
  },
  {
    "daId": "CF10590",
    "altId": "C122211",
    "name": "Md Rasel Hossen",
    "phones": [
      "8801311821108"
    ],
    "aliases": [
      "md rasel hossen",
      "cf10590",
      "c122211"
    ]
  },
  {
    "daId": "C210017",
    "altId": "",
    "name": "Md Jihad",
    "phones": [
      "8801887762770",
      "8801805481940"
    ],
    "aliases": [
      "md jihad",
      "c210017"
    ]
  },
  {
    "daId": "CF10587",
    "altId": "C122187",
    "name": "Tajul Islam (Sheikh Apon)",
    "phones": [
      "8801999660289"
    ],
    "aliases": [
      "tajul islam (sheikh apon)",
      "cf10587",
      "c122187"
    ]
  },
  {
    "daId": "CF3881",
    "altId": "",
    "name": "Sorowar Hossain",
    "phones": [
      "8801805481941",
      "8801837203147"
    ],
    "aliases": [
      "sorowar hossain",
      "cf3881"
    ]
  },
  {
    "daId": "C122199",
    "altId": "",
    "name": "Sojib (C122199)",
    "phones": [
      "8801872496540"
    ],
    "aliases": [
      "sojib (c122199)",
      "c122199"
    ]
  },
  {
    "daId": "C210022",
    "altId": "",
    "name": "Rofiqul Islam",
    "phones": [
      "8801823263485"
    ],
    "aliases": [
      "rofiqul islam",
      "c210022"
    ]
  },
  {
    "daId": "CF8987",
    "altId": "",
    "name": "Md Saiful Islam",
    "phones": [
      "8801890681777"
    ],
    "aliases": [
      "md saiful islam",
      "cf8987"
    ]
  },
  {
    "daId": "CF10591",
    "altId": "C122223",
    "name": "Amran Hossain",
    "phones": [
      "8801805481961",
      "8801310735205"
    ],
    "aliases": [
      "amran hossain",
      "cf10591",
      "c122223"
    ]
  },
  {
    "daId": "CF9041",
    "altId": "",
    "name": "Md Zihad",
    "phones": [],
    "aliases": [
      "md zihad",
      "cf9041",
      "md zihad nk depot ren"
    ]
  },
  {
    "daId": "C055167",
    "altId": "",
    "name": "Rakib 2",
    "phones": [
      "8801805481953"
    ],
    "aliases": [
      "rakib 2",
      "c055167"
    ]
  },
  {
    "daId": "C210016",
    "altId": "",
    "name": "Md Roki Uddin",
    "phones": [
      "8801805481973"
    ],
    "aliases": [
      "md roki uddin",
      "c210016"
    ]
  },
  {
    "daId": "RF5709",
    "altId": "",
    "name": "Shimul Dey",
    "phones": [],
    "aliases": [
      "shimul dey",
      "rf5709",
      "shimul dey renata nk depot"
    ]
  },
  {
    "daId": "CF4525",
    "altId": "",
    "name": "Neymot Ullah",
    "phones": [
      "8801841693411"
    ],
    "aliases": [
      "neymot ullah",
      "cf4525"
    ]
  },
  {
    "daId": "C210011",
    "altId": "",
    "name": "DA ID C210011",
    "phones": [
      "8801915403253"
    ],
    "aliases": [
      "da id c210011",
      "c210011"
    ]
  },
  {
    "daId": "CF1568",
    "altId": "",
    "name": "Mizanur Rahaman",
    "phones": [],
    "aliases": [
      "mizanur rahaman",
      "cf1568",
      "mizanur rahaman da nk"
    ]
  },
  {
    "daId": "C210018",
    "altId": "",
    "name": "Safayat Hossen",
    "phones": [
      "8801636190755"
    ],
    "aliases": [
      "safayat hossen",
      "c210018"
    ]
  },
  {
    "daId": "CF1603",
    "altId": "",
    "name": "Ruhul Amin",
    "phones": [
      "8801916682332"
    ],
    "aliases": [
      "ruhul amin",
      "cf1603"
    ]
  },
  {
    "daId": "C210024",
    "altId": "",
    "name": "Ilias Hossain",
    "phones": [
      "8801621668496"
    ],
    "aliases": [
      "ilias hossain",
      "c210024"
    ]
  },
  {
    "daId": "C210028",
    "altId": "",
    "name": "Abdur Rahman",
    "phones": [],
    "aliases": [
      "abdur rahman",
      "c210028",
      "abdur rahman nk depot ren"
    ]
  },
  {
    "daId": "C122230",
    "altId": "",
    "name": "DA ID C122230",
    "phones": [
      "8801777824386"
    ],
    "aliases": [
      "da id c122230",
      "c122230"
    ]
  },
  {
    "daId": "CF10145",
    "altId": "",
    "name": "Moajjem",
    "phones": [],
    "aliases": [
      "moajjem",
      "cf10145"
    ]
  }
];

const DA_MASTER = DEFAULT_DA_MASTER;

function extractCommonBrandStem(rawText) {
  if (!rawText) return '';
  const cleaned = String(rawText)
    .toLowerCase()
    .replace(/([a-z])(\d)/gi, '$1 $2')
    .replace(/(\d)([a-z])/gi, '$1 $2')
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .replace(/\b(syp|syr|sry|srp|syrup|syrap|syraf|sy|susp|suspension|tab|tap|tb|tablet|cap|caps|capsule|cream|crem|creem|crm|ointment|oint|pwd|powder|inj|oral|solution|linctus|veg|fc|ec|ds|jr|lite|gold|dotted|all|night|electrify|ulta|ultra|thin|dots|iu|mg|ml|mcg|gm|g|ta|tah|ti|pes|pcs|pc|pic|pis|box|bx|bot|bottle|pack|pkt)\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return '';
  if (words.length >= 2 && words[1].length <= 2) {
    return `${words[0]} ${words[1]}`.trim();
  }
  return words[0];
}

function buildDefaultProductGroups(productsArray) {
  const groupsMap = new Map();
  for (const p of productsArray || []) {
    const gName = String(p.family || String(p.name || '').split(/\s+/)[0] || 'GENERAL').trim().toUpperCase();
    if (!groupsMap.has(gName)) {
      groupsMap.set(gName, new Set([
        gName.toLowerCase(),
        gName.toLowerCase().replace(/\-/g, ' '),
        gName.toLowerCase().replace(/\-/g, '')
      ]));
    }
    const kwSet = groupsMap.get(gName);
    for (const al of p.aliases || []) {
      const stem = extractCommonBrandStem(al);
      if (stem && stem.length >= 3) {
        kwSet.add(stem);
        const compact = stem.replace(/[\s\-]+/g, '');
        if (compact.length >= 4) kwSet.add(compact);
      }
    }
  }
  return Array.from(groupsMap.entries()).map(([groupName, kwSet]) => ({
    groupName,
    keywords: Array.from(kwSet).filter(Boolean)
  }));
}

let masterDb = {
  das: JSON.parse(JSON.stringify(DEFAULT_DA_MASTER)),
  products: JSON.parse(JSON.stringify(DEFAULT_CRP_PRODUCTS)),
  productGroups: buildDefaultProductGroups(DEFAULT_CRP_PRODUCTS),
  adminAlertPhones: [...DEFAULT_ADMIN_ALERT_PHONES],
  authorizedImagePhones: [...DEFAULT_AUTHORIZED_IMAGE_PHONES],
  targetGroup: {
    targetGroupId: (process.env.TARGET_GROUP_ID || '').trim(),
    targetGroupName: (process.env.TARGET_GROUP_NAME || 'CRP sales NK Depot').trim(),
    autoReactOnOrder: true,
    updatedAt: new Date().toISOString()
  },
  lastProcessedMsgIds: [],
  recentProcessedMsgIds: [],
  lastProcessedMsgTimestamp: 0,
  messageLogs: [],
  updatedAt: new Date().toISOString()
};

let activeProducts = masterDb.products;
let activeDAs = masterDb.das;
let activeProductGroups = masterDb.productGroups;
let TRADE_PRICE_MAP = new Map(activeProducts.map((p) => [String(p.code), Number(p.price)]));

function rebuildMasterLookupCaches() {
  activeProducts = masterDb.products || [];
  activeDAs = masterDb.das || [];
  if (!Array.isArray(masterDb.productGroups) || masterDb.productGroups.length === 0) {
    masterDb.productGroups = buildDefaultProductGroups(activeProducts);
  }
  activeProductGroups = masterDb.productGroups;
  TRADE_PRICE_MAP = new Map(activeProducts.map((p) => [String(p.code), Number(p.price)]));
}

function isAccidentalPsoAlias(aliasStr) {
  if (!aliasStr) return true;
  const s = String(aliasStr).trim().toLowerCase();
  if (/^p\.?s\.?o\b/i.test(s)) return true;
  if (/^[a-z]{1,2}\s*[\-:=]\s*\d{1,3}$/i.test(s)) return true;
  return false;
}

function syncProductWithBrandGroup(prod, newAliasText = '') {
  if (!prod) return null;
  if (!Array.isArray(masterDb.productGroups)) {
    masterDb.productGroups = buildDefaultProductGroups(masterDb.products);
  }

  let familyCandidate = String(prod.family || String(prod.name || '').split(/\s+/)[0] || 'GENERAL')
    .trim()
    .toUpperCase();

  let group = masterDb.productGroups.find(
    (g) =>
      g.groupName.toUpperCase() === familyCandidate ||
      g.groupName.toUpperCase().replace(/\-/g, '') === familyCandidate.replace(/\-/g, '')
  );

  if (!group) {
    const firstWordStem = extractCommonBrandStem(prod.name);
    if (firstWordStem) {
      group = masterDb.productGroups.find((g) =>
        (g.keywords || []).some((k) => k.toLowerCase() === firstWordStem.toLowerCase())
      );
    }
  }

  if (!group) {
    group = {
      groupName: familyCandidate,
      keywords: [...new Set([
        familyCandidate.toLowerCase(),
        familyCandidate.toLowerCase().replace(/\-/g, ' '),
        familyCandidate.toLowerCase().replace(/\-/g, '')
      ].filter(Boolean))]
    };
    masterDb.productGroups.push(group);
  } else {
    prod.family = group.groupName;
  }

  const candidateAliases = [
    ...(prod.aliases || []),
    ...(newAliasText ? [newAliasText] : [])
  ];

  for (const al of candidateAliases) {
    if (isAccidentalPsoAlias(al)) continue;
    const stem = extractCommonBrandStem(al);
    if (stem && stem.length >= 3 && !isAccidentalPsoAlias(stem)) {
      if (!group.keywords.includes(stem)) {
        group.keywords.push(stem);
      }
      const compactStem = stem.replace(/[\s\-]+/g, '');
      if (compactStem.length >= 4 && !group.keywords.includes(compactStem)) {
        group.keywords.push(compactStem);
      }
    }
  }

  return group;
}

function getAuthorizedImagePhones() {
  const list = masterDb.authorizedImagePhones && masterDb.authorizedImagePhones.length > 0
    ? masterDb.authorizedImagePhones
    : DEFAULT_AUTHORIZED_IMAGE_PHONES;
  return Array.from(new Set(list.map((p) => normalizeBdPhone(p)).filter(Boolean)));
}

function getAdminAlertPhones() {
  const list = masterDb.adminAlertPhones && masterDb.adminAlertPhones.length > 0
    ? masterDb.adminAlertPhones
    : DEFAULT_ADMIN_ALERT_PHONES;
  return Array.from(new Set(list.map((p) => normalizeBdPhone(p)).filter(Boolean)));
}

function saveLocalMasterDb() {
  try {
    masterDb.updatedAt = new Date().toISOString();
    fs.writeFileSync(MASTER_DB_PATH, JSON.stringify(masterDb, null, 2), 'utf8');
  } catch (e) {}
}

function loadLocalMasterDb() {
  try {
    if (fs.existsSync(MASTER_DB_PATH)) {
      const raw = JSON.parse(fs.readFileSync(MASTER_DB_PATH, 'utf8'));
      applyMasterDbObject(raw, false);
    }
  } catch (e) {}
}

function applyMasterDbObject(raw, shouldSaveLocal = true) {
  if (!raw || typeof raw !== 'object') return;
  if (Array.isArray(raw.das)) {
    masterDb.das = raw.das.map((d) => ({
      daId: String(d.daId || '').trim().toUpperCase(),
      altId: String(d.altId || '').trim().toUpperCase(),
      name: String(d.name || '').trim(),
      phones: Array.isArray(d.phones) ? d.phones.map((p) => normalizeBdPhone(p)).filter(Boolean) : [],
      aliases: Array.isArray(d.aliases) ? d.aliases.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean) : []
    })).filter((d) => d.daId || d.name);
  }
  if (Array.isArray(raw.products)) {
    masterDb.products = raw.products.map((p) => ({
      code: String(p.code || '').trim().toUpperCase(),
      name: String(p.name || '').trim().toUpperCase(),
      unit: String(p.unit || 'Box/Bottle').trim(),
      price: Number(parseFloat(p.price) || 0),
      family: String(p.family || String(p.name || '').split(/\s+/)[0] || '').trim().toUpperCase(),
      aliases: Array.isArray(p.aliases)
        ? Array.from(new Set(p.aliases.map((a) => String(a || '').trim().toLowerCase()).filter((a) => a && !isAccidentalPsoAlias(a))))
        : []
    })).filter((p) => p.code && p.name);
  }
  if (Array.isArray(raw.productGroups) && raw.productGroups.length > 0) {
    masterDb.productGroups = raw.productGroups.map((g) => ({
      groupName: String(g.groupName || '').trim().toUpperCase(),
      keywords: Array.isArray(g.keywords)
        ? Array.from(new Set(g.keywords.map((k) => String(k || '').trim().toLowerCase()).filter((k) => k && !isAccidentalPsoAlias(k))))
        : []
    })).filter((g) => g.groupName);
  } else {
    masterDb.productGroups = buildDefaultProductGroups(masterDb.products);
  }
  for (const p of masterDb.products) {
    syncProductWithBrandGroup(p);
  }
  if (Array.isArray(raw.adminAlertPhones) && raw.adminAlertPhones.length > 0) {
    masterDb.adminAlertPhones = Array.from(new Set(raw.adminAlertPhones.map((p) => normalizeBdPhone(p)).filter(Boolean)));
  }
  if (Array.isArray(raw.authorizedImagePhones) && raw.authorizedImagePhones.length > 0) {
    masterDb.authorizedImagePhones = Array.from(new Set(raw.authorizedImagePhones.map((p) => normalizeBdPhone(p)).filter(Boolean)));
  }
  if (raw.targetGroup && typeof raw.targetGroup === 'object') {
    const tgId = String(raw.targetGroup.targetGroupId || '').trim();
    const tgName = String(raw.targetGroup.targetGroupName || '').trim();
    if (tgId || tgName) {
      masterDb.targetGroup = {
        targetGroupId: tgId,
        targetGroupName: tgName || (tgId === 'ALL' ? 'All Joined Groups (সব গ্রুপ)' : 'CRP sales NK Depot'),
        autoReactOnOrder: typeof raw.targetGroup.autoReactOnOrder === 'boolean' ? raw.targetGroup.autoReactOnOrder : true,
        updatedAt: raw.targetGroup.updatedAt || new Date().toISOString()
      };
    }
  }
  if (Array.isArray(raw.lastProcessedMsgIds)) {
    masterDb.lastProcessedMsgIds = Array.from(
      new Set(raw.lastProcessedMsgIds.map((id) => String(id || '').trim()).filter(Boolean))
    ).slice(0, 5);
  }
  if (Array.isArray(raw.recentProcessedMsgIds)) {
    masterDb.recentProcessedMsgIds = Array.from(
      new Set([
        ...(masterDb.lastProcessedMsgIds || []),
        ...raw.recentProcessedMsgIds.map((id) => String(id || '').trim()).filter(Boolean)
      ])
    ).slice(0, 150);
  } else if (Array.isArray(masterDb.lastProcessedMsgIds) && masterDb.lastProcessedMsgIds.length > 0) {
    masterDb.recentProcessedMsgIds = Array.from(
      new Set([...(masterDb.lastProcessedMsgIds || []), ...(masterDb.recentProcessedMsgIds || [])])
    ).slice(0, 150);
  }
  if (typeof raw.lastProcessedMsgTimestamp === 'number' && raw.lastProcessedMsgTimestamp > 0) {
    masterDb.lastProcessedMsgTimestamp = raw.lastProcessedMsgTimestamp;
  }
  if (Array.isArray(raw.messageLogs) && raw.messageLogs.length > 0) {
    const mergedLogs = [...raw.messageLogs, ...(masterDb.messageLogs || [])];
    const uniqueById = new Map();
    for (const l of mergedLogs) {
      if (l && l.whatsappMsgId && !uniqueById.has(l.whatsappMsgId)) {
        uniqueById.set(l.whatsappMsgId, l);
      }
    }
    masterDb.messageLogs = Array.from(uniqueById.values()).slice(0, 250);
  }
  masterDb.updatedAt = raw.updatedAt || new Date().toISOString();
  rebuildMasterLookupCaches();
  if (typeof syncTargetGroupFromMasterDbToBotConfig === 'function') {
    syncTargetGroupFromMasterDbToBotConfig();
  }
  if (shouldSaveLocal) {
    saveLocalMasterDb();
  }
}

function mergeMasterDbObject(raw, shouldSaveLocal = true) {
  if (!raw || typeof raw !== 'object') return;
  const incomingDas = Array.isArray(raw.das) ? raw.das : (Array.isArray(raw) && raw[0]?.daId ? raw : []);
  const incomingProds = Array.isArray(raw.products) ? raw.products : (Array.isArray(raw) && raw[0]?.code ? raw : []);
  const incomingGroups = Array.isArray(raw.productGroups) ? raw.productGroups : [];

  for (const d of incomingDas) {
    const cleanId = String(d.daId || '').trim().toUpperCase();
    const cleanAlt = String(d.altId || '').trim().toUpperCase();
    const cleanName = String(d.name || '').trim();
    if (!cleanId && !cleanName) continue;

    const cleanPhones = Array.isArray(d.phones)
      ? d.phones.map((p) => normalizeBdPhone(p)).filter(Boolean)
      : [];
    const cleanAliases = Array.isArray(d.aliases)
      ? d.aliases.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean)
      : [];

    const existing = masterDb.das.find(
      (x) => (cleanId && x.daId.toUpperCase() === cleanId) || (cleanAlt && x.altId && x.altId.toUpperCase() === cleanAlt)
    );
    if (existing) {
      if (cleanName && (!existing.name || existing.name === 'Unknown DA')) existing.name = cleanName;
      if (cleanAlt && !existing.altId) existing.altId = cleanAlt;
      existing.phones = Array.from(new Set([...(existing.phones || []), ...cleanPhones]));
      existing.aliases = Array.from(new Set([...(existing.aliases || []), ...cleanAliases]));
    } else {
      masterDb.das.push({
        daId: cleanId || `DA_${Date.now()}`,
        altId: cleanAlt,
        name: cleanName || cleanId,
        phones: cleanPhones,
        aliases: Array.from(new Set([cleanName.toLowerCase(), cleanId.toLowerCase(), ...cleanAliases].filter(Boolean)))
      });
    }
  }

  for (const p of incomingProds) {
    const cleanCode = String(p.code || '').trim().toUpperCase();
    const cleanName = String(p.name || '').trim().toUpperCase();
    if (!cleanCode || !cleanName) continue;

    const cleanAliases = Array.isArray(p.aliases)
      ? p.aliases.map((a) => String(a || '').trim().toLowerCase()).filter((a) => a && !isAccidentalPsoAlias(a))
      : [];
    const existingProd = masterDb.products.find((x) => String(x.code).toUpperCase() === cleanCode);
    if (existingProd) {
      if (p.price && Number(p.price) > 0) existingProd.price = Number(parseFloat(p.price));
      if (p.unit) existingProd.unit = String(p.unit).trim();
      if (p.family) existingProd.family = String(p.family).trim().toUpperCase();
      existingProd.aliases = Array.from(new Set([...(existingProd.aliases || []), ...cleanAliases]));
      syncProductWithBrandGroup(existingProd);
    } else {
      const newProd = {
        code: cleanCode,
        name: cleanName,
        unit: String(p.unit || 'Box/Bottle').trim(),
        price: Number(parseFloat(p.price) || 0),
        family: String(p.family || cleanName.split(/\s+/)[0] || '').trim().toUpperCase(),
        aliases: Array.from(new Set([cleanName.toLowerCase(), ...cleanAliases]))
      };
      masterDb.products.push(newProd);
      syncProductWithBrandGroup(newProd);
    }
  }

  if (!Array.isArray(masterDb.productGroups) || masterDb.productGroups.length === 0) {
    masterDb.productGroups = buildDefaultProductGroups(masterDb.products);
  }
  for (const g of incomingGroups) {
    const gName = String(g.groupName || '').trim().toUpperCase();
    if (!gName) continue;
    const gKws = Array.isArray(g.keywords)
      ? g.keywords.map((k) => String(k || '').trim().toLowerCase()).filter((k) => k && !isAccidentalPsoAlias(k))
      : [];
    const existingGrp = masterDb.productGroups.find((x) => x.groupName.toUpperCase() === gName);
    if (existingGrp) {
      existingGrp.keywords = Array.from(new Set([...(existingGrp.keywords || []), ...gKws]));
    } else {
      masterDb.productGroups.push({ groupName: gName, keywords: Array.from(new Set([gName.toLowerCase(), ...gKws])) });
    }
  }

  if (Array.isArray(raw.adminAlertPhones) && raw.adminAlertPhones.length > 0) {
    masterDb.adminAlertPhones = Array.from(
      new Set([...(masterDb.adminAlertPhones || []), ...raw.adminAlertPhones.map((p) => normalizeBdPhone(p)).filter(Boolean)])
    );
  }
  if (Array.isArray(raw.authorizedImagePhones) && raw.authorizedImagePhones.length > 0) {
    masterDb.authorizedImagePhones = Array.from(
      new Set([...(masterDb.authorizedImagePhones || []), ...raw.authorizedImagePhones.map((p) => normalizeBdPhone(p)).filter(Boolean)])
    );
  }
  if (raw.targetGroup && typeof raw.targetGroup === 'object') {
    const tgId = String(raw.targetGroup.targetGroupId || '').trim();
    const tgName = String(raw.targetGroup.targetGroupName || '').trim();
    if (tgId || tgName) {
      masterDb.targetGroup = {
        targetGroupId: tgId,
        targetGroupName: tgName || (tgId === 'ALL' ? 'All Joined Groups (সব গ্রুপ)' : 'CRP sales NK Depot'),
        autoReactOnOrder: typeof raw.targetGroup.autoReactOnOrder === 'boolean' ? raw.targetGroup.autoReactOnOrder : true,
        updatedAt: new Date().toISOString()
      };
    }
  }
  if (Array.isArray(raw.lastProcessedMsgIds) && raw.lastProcessedMsgIds.length > 0) {
    masterDb.lastProcessedMsgIds = Array.from(
      new Set([
        ...raw.lastProcessedMsgIds.map((id) => String(id || '').trim()).filter(Boolean),
        ...(masterDb.lastProcessedMsgIds || [])
      ])
    ).slice(0, 5);
  }
  if (Array.isArray(raw.recentProcessedMsgIds) && raw.recentProcessedMsgIds.length > 0) {
    masterDb.recentProcessedMsgIds = Array.from(
      new Set([
        ...(masterDb.lastProcessedMsgIds || []),
        ...raw.recentProcessedMsgIds.map((id) => String(id || '').trim()).filter(Boolean),
        ...(masterDb.recentProcessedMsgIds || [])
      ])
    ).slice(0, 150);
  }
  masterDb.updatedAt = new Date().toISOString();
  rebuildMasterLookupCaches();
  if (typeof syncTargetGroupFromMasterDbToBotConfig === 'function') {
    syncTargetGroupFromMasterDbToBotConfig();
  }
  if (shouldSaveLocal) {
    saveLocalMasterDb();
  }
}

// ============================================================================
// 4. FUZZY PRODUCT & BRAND GROUP VARIANT MATCHING ENGINE
// ============================================================================
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return (maxLen - levenshteinDistance(a, b)) / maxLen;
}

function findProductByCode(code) {
  return activeProducts.find((p) => String(p.code).toUpperCase() === String(code).toUpperCase()) || null;
}

function resolveBrandFamilyVariant(family, normLine) {
  const f = String(family || '').toUpperCase().trim();
  const s = ` ${String(normLine || '').toLowerCase()} `;
  const hasSypWord = /\b(syp|syr|sry|srp|syrup|syrap|syraf|sy|susp|suspension|oral|sol|drop|bottle|bot|ml)\b/i.test(s);
  const hasTabCapWord = /\b(tab|tap|tb|tablet|cap|caps|capsule)\b/i.test(s);

  switch (f) {
    case 'DOMIREN':
      if (/\b60\b/.test(s)) return findProductByCode('286');
      if (/\b100\b/.test(s) || hasSypWord) return findProductByCode('990');
      if (/\b10\s*mg\b/.test(s) || hasTabCapWord) return findProductByCode('60');
      return findProductByCode('990');

    case 'DELTASONE':
      if (/\b100\b/.test(s) && (hasSypWord || /100\s*ml/.test(s))) return findProductByCode('637');
      if (/\b(17\s*[x*\/]\s*30|5\s*mg)\b/.test(s) || hasTabCapWord) return findProductByCode('CS7');
      if (/\b100\s*ml\b/.test(s)) return findProductByCode('637');
      return findProductByCode('636');

    case 'ZITHRIN':
      if (/\b50\b/.test(s)) return findProductByCode('290');
      if (/\b20\b/.test(s)) return findProductByCode('270');
      if (/\b15\b/.test(s)) return findProductByCode('173');
      if (/\b30\b/.test(s)) return findProductByCode('834');
      return findProductByCode('271');

    case 'LUCAN-R':
    case 'LUCAN':
      if (/\b200\b/.test(s)) return findProductByCode('621');
      if (/\b150\b/.test(s)) return findProductByCode('605');
      if (/\b50\b/.test(s)) return findProductByCode('876');
      if (/\b35\b/.test(s) || hasSypWord) return findProductByCode('112');
      return findProductByCode('605');

    case 'FLONTIN':
      if (/\b60\b/.test(s) || hasSypWord) return findProductByCode('226');
      return findProductByCode('96');

    case 'FUROCEF':
      if (/\b(ds|50)\b/.test(s)) return findProductByCode('S72');
      return findProductByCode('102');

    case 'VITA':
    case 'VITA D3':
      if (/\b(20000|20\s*k)\b/.test(s)) return findProductByCode('S15');
      return findProductByCode('S16');

    case 'NEXDEX':
      if (/\b60\b/.test(s)) return findProductByCode('SA1');
      return findProductByCode('SA4');

    case 'PCAB':
      if (/\b10\b/.test(s) && /\b10\s*mg\b/.test(s)) return findProductByCode('C2Y');
      if (/\bpcab\s*10\b/.test(s)) return findProductByCode('C2Y');
      return findProductByCode('C2Z');

    case 'BECONEX':
      if (/\bzi\b/.test(s)) return findProductByCode('233');
      if (/\b200\b/.test(s)) return findProductByCode('34');
      return findProductByCode('33');

    case 'PROTONIL':
      if (/\b40\b/.test(s)) return findProductByCode('267');
      return findProductByCode('266');

    case 'FLUSTAR':
      if (/\b100\b/.test(s) || hasSypWord) return findProductByCode('N33');
      return findProductByCode('607');

    case 'RECOX':
      if (/\b90\b/.test(s)) return findProductByCode('N47');
      return findProductByCode('N49');

    case 'COPNAT':
      if (/\b(oint|ointment)\b/.test(s)) return findProductByCode('SZ5');
      return findProductByCode('SZ4');

    case 'MOODS':
      if (/\b(1500|gold\s*1500)\b/.test(s)) return findProductByCode('H89');
      if (/\b(electrify)\b/.test(s)) return findProductByCode('H88');
      if (/\b(all\s*night)\b/.test(s)) return findProductByCode('H39');
      if (/\b(ultra|ulta|thin)\b/.test(s)) return findProductByCode('H34');
      return findProductByCode('H37');

    case 'FENADIN':
      if (/\b30\b/.test(s)) return findProductByCode('69');
      return findProductByCode('933');

    case 'ALGIN':
      if (/\b50\b/.test(s)) return findProductByCode('C62');
      return findProductByCode('989');

    case 'MAZIC':
      if (/\bjr\b/.test(s)) return findProductByCode('16');
      return findProductByCode('18');

    default: {
      const famMembers = activeProducts.filter(
        (p) => String(p.family || '').toUpperCase() === f || p.name.toUpperCase().startsWith(f)
      );
      if (famMembers.length === 1) return famMembers[0];
      if (famMembers.length > 1) {
        for (const m of famMembers) {
          const numMatch = m.name.match(/\b(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10)\s*(MG|ML|MCG|GM|G)\b/i);
          if (numMatch && new RegExp(`\\b${numMatch[1]}\\b`).test(s)) {
            return m;
          }
        }
        return famMembers[0];
      }
      return null;
    }
  }
}

const BRAND_FAMILY_PATTERNS = [
  { family: 'TOTIFEN', regex: /\b(tot[iey]?[fp][ea]n|totifin)\b/i },
  { family: 'DOXICAP', regex: /\b(dox[iy]?c?[cu]p|dox[iye]c?ap)\b/i },
  { family: 'DOMIREN', regex: /\b(dom[iey]?r[ea]n|domniren|domira)\b/i },
  { family: 'DELTASONE', regex: /\b(d[ea]lt[ae]r?s[oa]n[ne]?|delta\s*s[oa]m|dellthesun)\b/i },
  { family: 'PRAZOLE', regex: /\b(p[ar]?a[zj]z?[oa]l[le]?|frazol|pazal)\b/i },
  { family: 'ZITHRIN', regex: /\b(z[ri]?i?t+h?i?r[ie]n)\b/i },
  { family: 'XAMIC', regex: /\b(e?x[am]{2}ic)\b/i },
  { family: 'RECOF', regex: /\b(rec[oa][fp]e?)\b/i },
  { family: 'TRULAX', regex: /\b(tr?ul[aeu]x)\b/i },
  { family: 'LUCAN-R', regex: /\b(l[ou]c?[ak]a?n\s*[\-_]?r?|luncan\s*[\-_]?r?|luen\s*[\-_]?r?|luknar|lokanar|lucar|luna\s*r|lunch\s*(?:[\-_]?r|150))\b/i },
  { family: 'FLONTIN', regex: /\b(fl?ont[ie]ne?|foltin|flotin|falntin)\b/i },
  { family: 'NORMANAL', regex: /\b(norm[ao]n[ao]l|narmonal|nomanal|normal\s*500|normal(?=\s*[\-:=]?\s*\d))\b/i },
  { family: 'FUROCEF', regex: /\b(fe?ou?r[ou]c?h?[ce]fe?|furosef|furcif|reocef)\b/i },
  { family: 'VITA', regex: /\b([vb]ita\s*d\s*3?|[vb]ita\s*(40000|20000))\b/i },
  { family: 'NEXDEX', regex: /\b(nexdex|nex\s*dex)\b/i },
  { family: 'PCAB', regex: /\b(p[\s\-_]?ca[bp]|pacb|picap)\b/i },
  { family: 'FERIX-V', regex: /\b(f[ea]rix\s*[\-_]?v|frix\s*v)\b/i },
  { family: 'DESOLON', regex: /\b(d[ea]s[eo]l[oa]ne?|dasalon|deslon|deslor)\b/i },
  { family: 'EMCON-1', regex: /\b(em\s*con(\s*[\-_]?\s*1)?|incone|emon(?=\s*[\-:=]?\s*\d))\b/i },
  { family: 'CONASYD', regex: /\b(conas[yi]d|conased|conacid)\b/i },
  { family: 'REDUCOF', regex: /\b(r[ei]d[uoi]c[oa][fp]e?|rducof)\b/i },
  { family: 'GESTRENOL', regex: /\b(g[ea]st[re]*n[oa]l|gestonal|gestanol|gestnol)\b/i },
  { family: 'EXICOF', regex: /\b(exic[oa][fp])\b/i },
  { family: 'RENASONE', regex: /\b(r[ea]n?as[oa][nl]e?)\b/i },
  { family: 'BECONEX', regex: /\b(b[ei]c?ox?n[ei][xz]|be\s*conex)\b/i },
  { family: 'STARK', regex: /\b(stark|strak|stack(?=\s*60))\b/i },
  { family: 'PROTONIL', regex: /\b(pr?oton[ie]l)\b/i },
  { family: 'POLYCEF', regex: /\b(pol[yi]cef)\b/i },
  { family: 'BREDICON', regex: /\b(b[ar]?[ea]?d[ei]con|badicon)\b/i },
  { family: 'PANGESIC', regex: /\b(p[ae]ng[eia][sc]i?ce?)\b/i },
  { family: 'CALCIN-D', regex: /\b(calcin\s*[\-_]?d)\b/i },
  { family: 'FLUSTAR', regex: /\b(f[ul]+u?st[ae]r)\b/i },
  { family: 'NORRY', regex: /\b(norr?y)\b/i },
  { family: 'ZODEF', regex: /\b(zodef|jodef)\b/i },
  { family: 'SALINE-R', regex: /\b(s[ae]l[ai]?i?ne?\s*[\-_]?r|slain\s*r)\b/i },
  { family: 'HONYCOL', regex: /\b(h[oa]n[ey]?[yi]?c[oa][ln])\b/i },
  { family: 'THYROX', regex: /\b(thyrox|thirox)\b/i },
  { family: 'NUTRILINA', regex: /\b(n[eu]u?t[ri]*l[in]+a)\b/i },
  { family: 'RECOX', regex: /\b(recox)\b/i },
  { family: 'COPNAT', regex: /\b(cop[hn]?[nm][ae]te?\s*[\-_]?n)\b/i },
  { family: 'FUROCLAV', regex: /\b(fe?uroclav)\b/i },
  { family: 'MOODS', regex: /\b(moods?)\b/i },
  { family: 'HYDROGEST', regex: /\b(hydroge?n?st)\b/i },
  { family: 'DELENTIN', regex: /\b(d[ei]lentine?)\b/i },
  { family: 'FENADIN', regex: /\b(fenadin)\b/i },
  { family: 'NOVELON', regex: /\b(novelon)\b/i },
  { family: 'EMEREN', regex: /\b(em[ei]ren)\b/i },
  { family: 'ALGIN', regex: /\b(algin)\b/i },
  { family: 'MAZIC', regex: /\b(ma[zj]ic)\b/i },
  { family: 'ALLUREN', regex: /\b(all?uren)\b/i }
];

function matchCRPProduct(rawLine) {
  if (!rawLine || typeof rawLine !== 'string') return null;
  const normalized = rawLine
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase();

  if (/\b(mrp|koto\s*tk|kina\s*porbe|list\s*te\s*ache|sell\s*koris|video|thanks|welcome|joined|added)\b/i.test(normalized)) {
    return null;
  }

  // Never match a standalone PSO / Territory line as a product
  if (/^\s*p\.?s\.?o\.?\b/i.test(rawLine.trim()) && extractPSOCode(rawLine)) {
    return null;
  }

  const cleanNormSpace = ` ${normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;

  // 1. Check Custom / Learned Aliases in activeProducts first
  let bestAliasProd = null;
  let bestAliasLen = 0;

  for (const prod of activeProducts) {
    for (const rawAlias of prod.aliases || []) {
      if (isAccidentalPsoAlias(rawAlias)) continue;
      const cleanAlias = String(rawAlias || '')
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-zA-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanAlias.length < 3) continue;
      if (cleanNormSpace.includes(` ${cleanAlias} `)) {
        if (cleanAlias.length > bestAliasLen) {
          bestAliasLen = cleanAlias.length;
          bestAliasProd = prod;
        }
      }
    }
  }

  if (bestAliasProd) {
    const resolved = resolveBrandFamilyVariant(bestAliasProd.family, normalized) || bestAliasProd;
    return { product: resolved, matchType: 'Alias/Learned', confidence: 0.99 };
  }

  // 2. Check Product Brand Groups (masterDb.productGroups) Shared Keywords!
  let bestGroup = null;
  let bestGroupKwLen = 0;
  for (const grp of activeProductGroups || []) {
    for (const kw of grp.keywords || []) {
      if (isAccidentalPsoAlias(kw)) continue;
      const cleanKw = String(kw || '')
        .replace(/([a-zA-Z])(\d)/g, '$1 $2')
        .replace(/(\d)([a-zA-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanKw.length < 3) continue;
      if (cleanNormSpace.includes(` ${cleanKw} `)) {
        if (cleanKw.length > bestGroupKwLen) {
          bestGroupKwLen = cleanKw.length;
          bestGroup = grp;
        }
      }
    }
  }

  if (bestGroup) {
    const resolvedFromGroup = resolveBrandFamilyVariant(bestGroup.groupName, normalized);
    if (resolvedFromGroup) {
      return { product: resolvedFromGroup, matchType: `Group (${bestGroup.groupName})`, confidence: 0.98 };
    }
  }

  // 3. Check Brand Family Regex Patterns
  for (const item of BRAND_FAMILY_PATTERNS) {
    if (item.regex.test(normalized)) {
      const product = resolveBrandFamilyVariant(item.family, normalized);
      if (product) {
        return { product, matchType: 'Pattern/Alias', confidence: 0.98 };
      }
    }
  }

  // 4. Check Direct Product Name Prefix
  for (const prod of activeProducts) {
    const cleanProdName = prod.name.toLowerCase().split(/\s+/)[0];
    if (cleanProdName.length >= 4 && normalized.includes(cleanProdName)) {
      const resolved = resolveBrandFamilyVariant(prod.family || cleanProdName.toUpperCase(), normalized) || prod;
      return { product: resolved, matchType: 'Direct', confidence: 0.95 };
    }
  }

  // 5. Fuzzy Token Similarity across all Product Groups, Product Names & Aliases
  const STOP_WORDS = new Set([
    'syp', 'syr', 'sry', 'srp', 'syrup', 'syrap', 'syraf', 'sy', 'susp', 'tab', 'tap', 'tb', 'tablet',
    'cap', 'caps', 'capsule', 'cream', 'crem', 'creem', 'crm', 'ointment', 'ta', 'tah', 'pes', 'pcs',
    'pc', 'pic', 'box', 'bx', 'bc', 'bot', 'bottle', 'pack', 'er', 'ar', 'ml', 'mg', 'gm', 'iu', 'fc',
    'ec', 'ds', 'jr', 'pso', 'code', 'pharmacy', 'pharmechy', 'pharmecy', 'phy', 'pharma', 'medical',
    'medecal', 'hall', 'hal', 'mh', 'bazar', 'bazer', 'bz', 'market', 'road', 'hat', 'new', 'al', 'ma',
    'maa', 'jannat', 'janani', 'popular', 'model', 'unique', 'laxmipur', 'ramgonj', 'raipur', 'hatiya',
    'chowmuhani', 'noakhali', 'mandari', 'hasnabad', 'chatkhil', 'sonapur', 'kabirhat', 'company', 'dr',
    'cus', 'name', 'customer', 'party', 'pharmey', 'address'
  ]);

  const tokens = normalized
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));

  if (!tokens.length) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const token of tokens) {
    for (const grp of activeProductGroups || []) {
      for (const kw of grp.keywords || []) {
        const kwWord = kw.split(/\s+/)[0].toLowerCase();
        if (kwWord.length < 4) continue;
        const sim = stringSimilarity(token, kwWord);
        if (sim > bestScore) {
          const candProd = resolveBrandFamilyVariant(grp.groupName, normalized);
          if (candProd) {
            bestScore = sim;
            bestMatch = candProd;
          }
        }
      }
    }

    for (const prod of activeProducts) {
      const candidateAliases = [
        prod.name.split(/\s+/)[0].toLowerCase(),
        ...(prod.aliases || []).map((a) => a.split(/\s+/)[0].toLowerCase())
      ];
      for (const aliasWord of candidateAliases) {
        if (aliasWord.length < 3) continue;
        const sim = stringSimilarity(token, aliasWord);
        if (sim > bestScore) {
          bestScore = sim;
          bestMatch = prod;
        }
      }
    }
  }

  if (bestMatch && bestScore >= 0.72) {
    const resolved = resolveBrandFamilyVariant(bestMatch.family, normalized) || bestMatch;
    return {
      product: resolved,
      matchType: `Fuzzy (${Math.round(bestScore * 100)}%)`,
      confidence: Number(bestScore.toFixed(2))
    };
  }

  return null;
}

// ============================================================================
// 5. QUANTITY EXTRACTOR, OCR PRE-NORMALIZER & UNRECOGNIZED PRODUCT DETECTOR
// ============================================================================
function fixOcrDigitLookalikes(str) {
  if (!str) return '';
  return str
    .replace(/(\d)[Oo](\b|\s|ta|pes|pcs|pc|box|bx)/gi, '$10$2')
    .replace(/(\d)[Oo][Oo](\b|\s|ta|pes|pcs|pc|box|bx)/gi, '$100$2')
    .replace(/([\s\-:=])[lI|](\d\b)/g, '$11$2')
    .replace(/([\s\-:=])[lI|][Oo](\b|\s|ta|pes|pcs|pc|box|bx)/g, '$110$2')
    .replace(/([\s\-:=])S[0Oo](\b|\s|ta|pes|pcs|pc|box|bx)/g, '$150$2');
}

function extractOrderQuantity(rawLine, matchedProduct) {
  let s = fixOcrDigitLookalikes(rawLine);
  s = s.replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2');

  s = s.replace(/^\s*\d+\s*[\/)\.]\s*/, ' ');
  s = s.replace(/\b(cf|rf|c)\s*[\-_]?\s*\d{4,6}\b/gi, ' ');
  s = s.replace(/\bp\.?s\.?o\.?\s*(?:code|id|no)?\s*[\-:=_.]*\s*[a-z]{0,3}\s*[\-:=_.]*\s*\d{1,4}\b/gi, ' ');
  s = s.replace(/\b(40000|20000|1500)\s*(iu|dots)?\b/gi, ' ');
  s = s.replace(/\b\d+\s*[\*x]\s*\d+\b/gi, ' ');
  s = s.replace(/\bd\s*3\b/gi, ' ');
  s = s.replace(/\bemcon\s*[\-_]?\s*1\b/gi, 'emcon ');
  s = s.replace(/\b(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5|3)\s*(ml|mg|mcg|gm|g)\b/gi, ' ');

  s = s.replace(/\b([a-z]{3,}(?:\s+[a-z]{1,4})?)\s*(?:syp|syr|sry|srp|sarape|tab|tap|cap|caps|susp)?\s*[\-_:=.]*\s*(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5)\b(?=.*?\b\d+)/gi, '$1 ');

  const plusMatch = s.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    return parseFloat(plusMatch[1]) + parseFloat(plusMatch[2]);
  }

  const numMatches = [...s.matchAll(/(\d+(?:\.\d+)?)/g)];
  if (numMatches.length > 0) {
    const lastNum = parseFloat(numMatches[numMatches.length - 1][1]);
    if (lastNum > 0 && lastNum <= 50000) return lastNum;
  }

  return null;
}

function detectUnrecognizedProductLine(seg, isImageOrder = false) {
  if (!seg || typeof seg !== 'string') return null;
  const trimmed = fixOcrDigitLookalikes(seg.trim());
  if (trimmed.length < 4 || trimmed.length > 90) return null;

  if (/\b(cf|rf|c)\s*[\-_.]?\s*\d{4,6}\b/i.test(trimmed)) return null;
  if (/\b(2100\d{2}|122\d{3}|055167)\b/.test(trimmed)) return null;
  if (extractPSOCode(trimmed)) return null;
  if (/\bp\.?s\.?o\b/i.test(trimmed)) return null;
  if (/^(?:p\.?s\.?o|territory|ter\b|route|beat|market|code\b|id\b|da\b|cus\b|customer|party|address)/i.test(trimmed)) return null;
  if (/^[a-z]{1,2}\s*[\-:=]\s*\d{1,3}$/i.test(trimmed)) return null;
  if (isPharmacyCandidateLine(trimmed)) return null;
  if (/\b01[3-9]\d{8}\b/.test(trimmed)) return null;
  if (/\b\d{1,2}\s*[\/\-\.]\s*\d{1,2}(?:\s*[\/\-\.]\s*\d{2,4})?\b/.test(trimmed)) return null;
  if (/^(assalamu|salam|walekum|hi\b|hello|ok\b|okay|hmm|thanks|thank\s+you|welcome|alhamdulillah|inshallah|good\s+morning|good\s+night|date\b|da\s+name|da\s+id|order\b|total\b|sub\s*total|grand\s*total|sl\b|serial|page\b|mob|phone|cell|dr\b|doctor|sign|signature|tk\b|taka\b|amount|price|rate|discount|vat|net\b|due\b|paid\b|cash\b|memo\b|invoice|bill\b|code\b|id\b|name\b|cus\b|customer|party|market|bazar|road|depot|noakhali|renata)/i.test(trimmed)) {
    return null;
  }
  if (/\b(total|taka|amount|invoice|memo|signature|mobile|depot|noakhali|chowmuhani|laxmipur|feni|maijdee)\b/i.test(trimmed)) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  for (const da of activeDAs) {
    if (da.name && lower.includes(da.name.toLowerCase())) return null;
    for (const al of da.aliases || []) {
      if (al.length >= 4 && lower.includes(al.toLowerCase())) return null;
    }
  }

  const UNIT_PAT = '(?:ta|tah|ti|t|pes|pcs|pc|ps|pic|pis|p|box|bx|b|bot|bt|pack|pkt|s)';
  const hasExplicitSepOrUnit =
    new RegExp(`([a-zA-Z]{3,}.*?[\\-:=]+\\s*\\d+\\s*${UNIT_PAT}?\\.?$)`, 'i').test(trimmed) ||
    new RegExp(`([a-zA-Z]{3,}.*?\\s+\\d+\\s*${UNIT_PAT}\\.?$)`, 'i').test(trimmed);

  const hasBareNumberOrderShape =
    !isImageOrder && /^[*\d\/.)\s]*([a-zA-Z][a-zA-Z0-9\-\s.]{2,40}?)\s+(\d{1,4})\s*$/i.test(trimmed);

  if (!hasExplicitSepOrUnit && !hasBareNumberOrderShape) return null;

  const qty = extractOrderQuantity(trimmed, null);
  if (qty === null || qty <= 0 || qty > 5000) return null;

  let unknownName = trimmed.replace(/^[*\d\/.)\-\s]+/, '');
  const sepQtyRegex = new RegExp(`[\\-:=]+\\s*\\d+(?:\\+\\d+)?\\s*${UNIT_PAT}?\\.?\\s*$`, 'i');
  const spaceQtyRegex = new RegExp(`\\s+\\d+(?:\\+\\d+)?\\s*${UNIT_PAT}?\\.?\\s*$`, 'i');
  if (sepQtyRegex.test(unknownName)) {
    unknownName = unknownName.replace(sepQtyRegex, '');
  } else {
    unknownName = unknownName.replace(spaceQtyRegex, '');
  }
  unknownName = unknownName.replace(/[*_~]+/g, '').trim();

  if (!unknownName || unknownName.length < 3 || /^\d+$/.test(unknownName)) return null;
  if (!/[a-zA-Z]{3,}/.test(unknownName)) return null;
  if (isAccidentalPsoAlias(unknownName)) return null;

  return {
    rawLine: trimmed,
    unknownProductText: unknownName,
    orderedQty: qty
  };
}

function normalizeOcrOrderText(rawText) {
  if (!rawText) return '';
  let text = fixOcrDigitLookalikes(rawText.replace(/\r\n/g, '\n'));

  const rawLines = text.split('\n');
  const expandedLines = [];

  for (const line of rawLines) {
    if (!line.includes('\t')) {
      expandedLines.push(line.trim());
      continue;
    }
    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    let buffer = '';
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (buffer && matchCRPProduct(buffer) && extractOrderQuantity(buffer) === null && /^[\-=:]*\s*\d+\s*(ta|pes|pcs|pc|box|bx)?$/i.test(cell)) {
        expandedLines.push(`${buffer} ${cell}`);
        buffer = '';
      } else {
        if (buffer) expandedLines.push(buffer);
        buffer = cell;
      }
    }
    if (buffer) expandedLines.push(buffer);
  }

  const mergedLines = [];
  for (let i = 0; i < expandedLines.length; i++) {
    const cur = expandedLines[i];
    if (!cur) continue;
    const next = i + 1 < expandedLines.length ? expandedLines[i + 1] : '';

    if (
      next &&
      matchCRPProduct(cur) !== null &&
      extractOrderQuantity(cur) === null &&
      matchCRPProduct(next) === null &&
      /^[\-=:*#]*\s*\d+(?:\+\d+)?\s*(ta|tah|pes|pcs|pc|pic|box|bx|bot|pack)?\.?$/i.test(next)
    ) {
      mergedLines.push(`${cur} ${next}`);
      i++;
    } else {
      mergedLines.push(cur);
    }
  }

  return mergedLines.join('\n');
}

function expandLineSegments(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const multiSizeMatch = trimmed.match(/^(.*?\b(?:deltas[oa]ne?|dom[iey]?r[ea]n|zith?r[ie]n|beconex|biconex)\b)\s*(\d+\s*ml\s*[\-:=]?\s*\d+\s*(?:ta|pes|pcs|pc|box)?)\s+(\d+\s*ml\s*[\-:=]?\s*\d+.*)$/i);
  if (multiSizeMatch) {
    const brandPrefix = multiSizeMatch[1];
    return [
      `${brandPrefix} ${multiSizeMatch[2]}`,
      `${brandPrefix} ${multiSizeMatch[3]}`
    ];
  }

  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    const matchedParts = parts.filter((p) => matchCRPProduct(p) !== null);
    if (matchedParts.length >= 2) {
      return parts;
    }
  }

  const dotParts = trimmed.split(/\.\s+/).map((p) => p.trim()).filter(Boolean);
  if (dotParts.length >= 2) {
    const matchedDots = dotParts.filter((p) => matchCRPProduct(p) !== null);
    if (matchedDots.length >= 2) {
      return dotParts;
    }
  }

  return [trimmed];
}

// ============================================================================
// 6. DA (DELIVERY ASSISTANT), PHONE/LID, PSO CODE & PHARMACY RESOLVER
// ============================================================================
const senderContextCache = new Map();
const lidToPhoneMap = new Map([
  ['259794032148540', '8801732273944'],
  ['51243288424651', '8801793362829'],
  ['188738965659721', '8801795058467']
]);

function normalizeBdPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('01')) {
    return '88' + digits;
  }
  if (digits.length === 13 && digits.startsWith('8801')) {
    return digits;
  }
  if (digits.length === 10 && digits.startsWith('1')) {
    return '880' + digits;
  }
  return digits;
}

function resolveRealSenderPhone(msg) {
  if (!msg) return '';
  const candidatos = [
    msg.key?.participantPn,
    msg.participantPn,
    msg.key?.participant,
    msg.participant,
    msg.key?.remoteJidAlt,
    !msg.key?.remoteJid?.endsWith('@g.us') ? msg.key?.remoteJid : ''
  ];

  if (msg.key?.fromMe && connectedUser?.id) {
    candidatos.unshift(connectedUser.id);
  }

  for (const c of candidatos) {
    if (!c) continue;
    const rawId = String(c).split('@')[0].split(':')[0];
    if (lidToPhoneMap.has(rawId)) {
      return lidToPhoneMap.get(rawId);
    }
    const norm = normalizeBdPhone(rawId);
    if (norm.length === 13 && norm.startsWith('8801')) {
      const pJid = msg.key?.participant || '';
      if (pJid.endsWith('@lid')) {
        lidToPhoneMap.set(pJid.split('@')[0].split(':')[0], norm);
      }
      return norm;
    }
  }

  const fallbackRaw = (msg.key?.participant || msg.key?.remoteJid || '').split('@')[0].split(':')[0];
  if (lidToPhoneMap.has(fallbackRaw)) {
    return lidToPhoneMap.get(fallbackRaw);
  }
  return normalizeBdPhone(fallbackRaw);
}

function isAuthorizedForImageOrder(msg, resolvedPhone) {
  const allowedPhones = getAuthorizedImagePhones();
  const norm = normalizeBdPhone(resolvedPhone);
  for (const authPhone of allowedPhones) {
    if (norm === authPhone || (norm.length >= 10 && norm.endsWith(authPhone.slice(-10)))) {
      return true;
    }
  }

  const rawCandidates = [
    msg?.key?.participant,
    msg?.participant,
    msg?.key?.participantPn,
    msg?.participantPn,
    !msg?.key?.remoteJid?.endsWith('@g.us') ? msg?.key?.remoteJid : ''
  ]
    .filter(Boolean)
    .map((x) => String(x).split('@')[0].split(':')[0]);

  const allAllowedLids = new Set([
    ...DEFAULT_AUTHORIZED_LIDS,
    ...(botConfig.authorizedImageLids || [])
  ]);

  for (const rawId of rawCandidates) {
    if (allAllowedLids.has(rawId)) return true;
    const mapped = lidToPhoneMap.get(rawId);
    if (mapped && allowedPhones.includes(mapped)) return true;
    const normCand = normalizeBdPhone(rawId);
    if (allowedPhones.includes(normCand)) return true;
  }

  return false;
}

function isAdminAlertSender(msg, resolvedPhone) {
  const adminPhones = getAdminAlertPhones();
  const imagePhones = getAuthorizedImagePhones();
  const allAdmins = Array.from(new Set([...adminPhones, ...imagePhones]));
  const norm = normalizeBdPhone(resolvedPhone);

  for (const ap of allAdmins) {
    if (norm === ap || (norm.length >= 10 && norm.endsWith(ap.slice(-10)))) {
      return true;
    }
  }

  const rawCandidates = [
    msg?.key?.participant,
    msg?.participant,
    msg?.key?.participantPn,
    msg?.participantPn,
    !msg?.key?.remoteJid?.endsWith('@g.us') ? msg?.key?.remoteJid : ''
  ]
    .filter(Boolean)
    .map((x) => String(x).split('@')[0].split(':')[0]);

  const allAllowedLids = new Set([
    ...DEFAULT_AUTHORIZED_LIDS,
    ...(botConfig.authorizedImageLids || [])
  ]);

  for (const rawId of rawCandidates) {
    if (allAllowedLids.has(rawId)) return true;
    const mapped = lidToPhoneMap.get(rawId);
    if (mapped && allAdmins.includes(mapped)) return true;
  }
  return false;
}

function extractInlineNameNextToDaId(fullText, candidateId) {
  if (!fullText || !candidateId) return '';
  const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (matchCRPProduct(line) !== null || isPharmacyCandidateLine(line) || extractPSOCode(line)) continue;
    const regex = new RegExp(`\\b(?:CF|RF|C)\\s*[\\-_.]?\\s*${candidateId.replace(/^(CF|RF|C)/i, '')}\\b[\\s\\-:=,]*([A-Za-z][A-Za-z.\\s()]{2,30})$`, 'i');
    const m = line.match(regex);
    if (m && m[1]) {
      const candidateName = m[1].trim();
      if (!/^(pso|cus|customer|party|pharmacy|pharma|medical|hall|date|order|crp)\b/i.test(candidateName)) {
        return candidateName;
      }
    }
  }
  return '';
}

function resolveDAFromMessageAndSender(fullText, senderPhone, senderPushName, senderJid, options = {}) {
  const { isImageOrder = false } = options;
  const cleanText = (fullText || '').toUpperCase();
  const cleanPhone = normalizeBdPhone(senderPhone);
  const cleanPush = (senderPushName || '').toLowerCase().trim();
  const isSenderAdmin = getAuthorizedImagePhones().includes(cleanPhone) || getAdminAlertPhones().includes(cleanPhone);

  const explicitMatch = cleanText.match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b/);
  if (explicitMatch) {
    const candidateId = `${explicitMatch[1]}${explicitMatch[2]}`;
    const foundByCode = activeDAs.find(
      (d) => d.daId.toUpperCase() === candidateId || (d.altId && d.altId.toUpperCase() === candidateId)
    );
    if (foundByCode) {
      if (senderJid && !isImageOrder && !isSenderAdmin) {
        senderContextCache.set(senderJid, { ...foundByCode });
      }
      return { ...foundByCode, isKnownDA: true, resolutionState: 'KNOWN' };
    }

    const inlineName = extractInlineNameNextToDaId(fullText, candidateId);
    if (inlineName) {
      const autoCreatedDA = {
        daId: candidateId,
        altId: '',
        name: inlineName,
        phones: (!isImageOrder && !isSenderAdmin && cleanPhone.startsWith('8801')) ? [cleanPhone] : [],
        aliases: [inlineName.toLowerCase(), candidateId.toLowerCase()]
      };
      masterDb.das.push(autoCreatedDA);
      saveLocalMasterDb();
      scheduleCloudStateBackup(2000);
      return {
        ...autoCreatedDA,
        isKnownDA: true,
        autoAddedNewDA: true,
        resolutionState: 'AUTO_ADDED_WITH_NAME'
      };
    }

    return {
      daId: candidateId,
      altId: '',
      name: `Unknown (${candidateId})`,
      phones: [],
      isKnownDA: false,
      detectedDaId: candidateId,
      resolutionState: 'NEEDS_NAME_FOR_ID'
    };
  }

  const bareMatch = cleanText.match(/\b(2100\d{2}|122\d{3}|055167)\b/);
  if (bareMatch) {
    const candidateId = `C${bareMatch[1]}`;
    const foundBare = activeDAs.find(
      (d) => d.daId.toUpperCase() === candidateId || (d.altId && d.altId.toUpperCase() === candidateId)
    );
    if (foundBare) {
      if (senderJid && !isImageOrder && !isSenderAdmin) {
        senderContextCache.set(senderJid, { ...foundBare });
      }
      return { ...foundBare, isKnownDA: true, resolutionState: 'KNOWN' };
    }
    return {
      daId: candidateId,
      altId: '',
      name: `Unknown (${candidateId})`,
      phones: [],
      isKnownDA: false,
      detectedDaId: candidateId,
      resolutionState: 'NEEDS_NAME_FOR_ID'
    };
  }

  const textLower = (fullText || '').toLowerCase();
  for (const da of activeDAs) {
    const nameCandidate = (da.name || '').toLowerCase().split('(')[0].trim();
    if (nameCandidate.length >= 4 && textLower.includes(nameCandidate)) {
      return { ...da, isKnownDA: true, resolutionState: 'KNOWN' };
    }
    for (const alias of da.aliases || []) {
      if (alias.length >= 4 && textLower.includes(alias.toLowerCase())) {
        return { ...da, isKnownDA: true, resolutionState: 'KNOWN' };
      }
    }
  }

  if (isImageOrder || isSenderAdmin) {
    return {
      daId: 'UNRESOLVED',
      altId: '',
      name: 'Unknown DA',
      phones: [],
      isKnownDA: false,
      detectedDaId: null,
      resolutionState: 'NEEDS_ID_AND_NAME'
    };
  }

  if (cleanPhone.length >= 10) {
    const last10 = cleanPhone.slice(-10);
    const foundByPhone = activeDAs.find(
      (d) => d.phones && d.phones.some((p) => p.endsWith(last10))
    );
    if (foundByPhone) {
      if (senderJid) senderContextCache.set(senderJid, { ...foundByPhone });
      return { ...foundByPhone, isKnownDA: true, resolutionState: 'KNOWN' };
    }
  }

  for (const da of activeDAs) {
    for (const alias of da.aliases || []) {
      if (alias.length >= 4 && cleanPush.includes(alias.toLowerCase())) {
        if (senderJid) senderContextCache.set(senderJid, { ...da });
        return { ...da, isKnownDA: true, resolutionState: 'KNOWN' };
      }
    }
  }

  if (senderJid && senderContextCache.has(senderJid)) {
    return { ...senderContextCache.get(senderJid), isKnownDA: true, resolutionState: 'KNOWN' };
  }

  return {
    daId: cleanPhone ? `WA-${cleanPhone.slice(-6)}` : 'UNRESOLVED',
    altId: '',
    name: senderPushName || (cleanPhone ? `+${cleanPhone}` : 'Unknown Sender'),
    phones: cleanPhone ? [cleanPhone] : [],
    isKnownDA: false,
    detectedDaId: null,
    resolutionState: 'NEEDS_ID_AND_NAME'
  };
}

function extractPSOCode(line) {
  if (!line) return null;
  const psoExplicit = line.match(
    /\bp\.?s\.?o\.?\s*(?:code|id|no)?\s*[\-:=_.]*\s*([A-Z]{1,2}\s*[\-:=_.]*\s*\d{1,4}|\d{2,4})\b/i
  );
  if (psoExplicit) {
    return psoExplicit[1].replace(/[\s\-:=_.]+/g, '').toUpperCase();
  }
  const slashOrParen = line.match(
    /(?:\/|\(|,\s*\-|\s\-)\s*([A-TV-Z]\s*[\-_]?\s*\d{2,3}|345|44\d|45\d|46\d|47\d)\b/i
  );
  if (slashOrParen) {
    const code = slashOrParen[1].replace(/[\s\-_]+/g, '').toUpperCase();
    if (!['S16', 'S15', 'S34', 'S72', 'C25', 'C62', 'C82', 'N33', 'N45', 'N47', 'N49', 'T28', 'H34', 'H37', 'H39', 'H88', 'H89'].includes(code)) {
      return code;
    }
  }
  const standalone = line.trim().match(/^([A-Z]\s*[\-_]?\s*\d{2,3}|345|44\d|45\d|46\d|47\d)$/i);
  if (standalone) {
    return standalone[1].replace(/[\s\-_]+/g, '').toUpperCase();
  }
  return null;
}

function isPharmacyCandidateLine(line) {
  const clean = line.trim();
  if (!clean || clean.length < 3) return false;
  if (/^(p\.?s\.?o|cf|rf|c[\-_]?\d|assalamu|salam|hi|hello|crp\b)/i.test(clean)) return false;
  if (/^(cus|customer|party)\s*(?:name)?\s*[\-:=]/i.test(clean)) return true;
  if (/^(md\s+|ikbal\s+hossain|robiul\s+hossain|dawdul\s+islam|jahid\s+mondol|rezaul\s+haque|rejaul\s+hoque|mizan\b|sharif\b|rakib\b)/i.test(clean) && !/\b(pharmacy|pharmey|pharma|phy|p\/h|medical|med|hall|mh|m\.h|drug|clinic|hospital|store|corner|center|centre)\b/i.test(clean)) {
    return false;
  }
  if (/\b(pharmacy|pharmechy|pharmecy|pharmicy|pharmey|pharma|phy|p\/h|medical|medecal|med\s+hall|hall|hal|m\.?h\b|drug|clinic|hospital|medicine|medicen|corner|cornar|center|centre|store|point|paint|nikaton|ph\b|pmy\b)/i.test(clean)) {
    return true;
  }
  return false;
}

function cleanPharmacyName(raw) {
  return raw
    .replace(/^\s*\d+\s*[\)\/.]\s*\.*/, '')
    .replace(/^(?:cus|customer|party)\s*(?:name)?\s*[\-:=]+\s*/i, '')
    .replace(/\bp\.?s\.?o\.?\s*(?:code|id|no)?\s*[\-:=_.]*\s*[A-Z]{0,2}\s*[\-:=_.]*\s*\d{1,4}\b/gi, '')
    .trim();
}

function parseWhatsAppOrderMessage({
  messageText,
  messageId = `MSG_${Date.now()}`,
  timestamp = new Date(),
  senderPhone = '',
  senderPushName = '',
  senderJid = '',
  isImageOrder = false
}) {
  if (!messageText || typeof messageText !== 'string') {
    return { isOrder: false, orders: [], unrecognizedItems: [], daInfo: null, followUpPatch: null };
  }

  const normalizedBlock = normalizeOcrOrderText(messageText);
  const rawLines = normalizedBlock
    .split('\n')
    .map((l) => l.replace(/<This message was edited>/gi, '').trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { isOrder: false, orders: [], unrecognizedItems: [], daInfo: null, followUpPatch: null };
  }

  const daInfo = resolveDAFromMessageAndSender(
    normalizedBlock,
    senderPhone,
    senderPushName,
    senderJid,
    { isImageOrder }
  );

  let globalPso = null;
  let defaultPharmacy = '';
  for (const l of rawLines) {
    if (!globalPso) {
      const p = extractPSOCode(l);
      if (p) globalPso = p;
    }
    if (!defaultPharmacy && isPharmacyCandidateLine(l) && matchCRPProduct(l) === null) {
      defaultPharmacy = cleanPharmacyName(l);
    }
  }

  let currentPharmacy = '';
  let currentPso = '';
  let potentialPartyHeader = '';
  const parsedItems = [];
  const unrecognizedItems = [];

  for (const rawLine of rawLines) {
    const psoInLine = extractPSOCode(rawLine);
    if (psoInLine) currentPso = psoInLine;

    const segments = expandLineSegments(rawLine);

    for (const seg of segments) {
      const segPso = extractPSOCode(seg);
      if (segPso) currentPso = segPso;

      const matchResult = matchCRPProduct(seg);
      if (matchResult && matchResult.product) {
        const qty = extractOrderQuantity(seg, matchResult.product);
        if (qty !== null && qty > 0) {
          const prod = matchResult.product;
          const totalAmount = Number((qty * prod.price).toFixed(2));
          parsedItems.push({
            rawLine: seg.trim(),
            pharmacyName: currentPharmacy || defaultPharmacy || potentialPartyHeader || 'General Party',
            psoCode: currentPso || globalPso || '-',
            crpCode: prod.code,
            productName: prod.name,
            packUnit: prod.unit,
            orderedQty: qty,
            unitPrice: prod.price,
            totalAmount,
            matchType: matchResult.matchType
          });
          continue;
        }
      }

      if (isPharmacyCandidateLine(seg)) {
        currentPharmacy = cleanPharmacyName(seg);
        continue;
      }

      const unknownCandidate = detectUnrecognizedProductLine(seg, isImageOrder);
      if (unknownCandidate) {
        unrecognizedItems.push({
          ...unknownCandidate,
          pharmacyName: currentPharmacy || defaultPharmacy || potentialPartyHeader || 'General Party',
          psoCode: currentPso || globalPso || '-'
        });
        continue;
      }

      if (
        !potentialPartyHeader &&
        seg.length >= 3 &&
        seg.length <= 45 &&
        !/^(cf|rf|c[\-_]?\d|p\.?s\.?o\b|\d+$)/i.test(seg) &&
        !/[=:]\s*\d+/i.test(seg) &&
        !/\b\d+\s*(?:ta|tah|t|pes|pcs|pc|ps|pic|p|box|bx|bot|pack)\b/i.test(seg)
      ) {
        potentialPartyHeader = cleanPharmacyName(seg);
      }
    }
  }

  if (parsedItems.length === 0 && unrecognizedItems.length === 0 && rawLines.length <= 2 && normalizedBlock.length <= 35) {
    const onlyDaMatch = normalizedBlock.toUpperCase().match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b|\b(2100\d{2}|122\d{3})\b/);
    const onlyPsoMatch = extractPSOCode(normalizedBlock);
    if (onlyDaMatch || onlyPsoMatch) {
      return {
        isOrder: false,
        orders: [],
        unrecognizedItems: [],
        daInfo,
        followUpPatch: {
          senderJid,
          senderPhone,
          daInfo: onlyDaMatch ? daInfo : null,
          psoCode: onlyPsoMatch || null
        }
      };
    }
    return { isOrder: false, orders: [], unrecognizedItems: [], daInfo, followUpPatch: null };
  }

  const dt = new Date(timestamp);
  const dateStr = dt.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' });
  const timeStr = dt.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  let displayPhone = normalizeBdPhone(senderPhone);
  if (daInfo.phones && daInfo.phones.length > 0 && (isImageOrder || !displayPhone.startsWith('8801'))) {
    displayPhone = daInfo.phones[0];
  }

  const finalOrders = parsedItems.map((item, idx) => ({
    orderLineId: `${messageId}_${idx + 1}`,
    whatsappMsgId: messageId,
    date: dateStr,
    time: timeStr,
    daId: daInfo.daId,
    altId: daInfo.altId || '-',
    daName: daInfo.name,
    senderPhone: displayPhone ? `+${displayPhone}` : '-',
    psoCode: item.psoCode,
    pharmacyName: item.pharmacyName,
    rawText: item.rawLine,
    crpCode: item.crpCode,
    productName: item.productName,
    packUnit: item.packUnit,
    orderedQty: item.orderedQty,
    unitPrice: item.unitPrice,
    totalAmount: item.totalAmount,
    matchType: item.matchType,
    status: 'ACTIVE'
  }));

  return {
    isOrder: finalOrders.length > 0,
    orders: finalOrders,
    unrecognizedItems,
    daInfo,
    dateStr,
    timeStr,
    displayPhone: displayPhone ? `+${displayPhone}` : '-',
    followUpPatch: null
  };
}

// ============================================================================
// 7. PERMANENT 5-METHOD IMAGE OCR & VISION AI PIPELINE + SMART BURST QUEUE
// ============================================================================
let localTesseract = null;
try {
  localTesseract = require('tesseract.js');
} catch (e) {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 24000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const imageOcrResultCache = new Map();
const ocrSpaceCallTimestamps = [];
const visionCallTimestamps = [];
let ocrSpaceCooldownUntil = 0;

function getRecentOcrSpaceCount() {
  const now = Date.now();
  while (ocrSpaceCallTimestamps.length > 0 && now - ocrSpaceCallTimestamps[0] > 62000) {
    ocrSpaceCallTimestamps.shift();
  }
  return ocrSpaceCallTimestamps.length;
}

function getRecentVisionCount() {
  const now = Date.now();
  while (visionCallTimestamps.length > 0 && now - visionCallTimestamps[0] > 62000) {
    visionCallTimestamps.shift();
  }
  return visionCallTimestamps.length;
}

let imageProcessingChain = Promise.resolve();
let pendingImageQueueCount = 0;
let consecutiveBurstProcessed = 0;
let lastImageFinishedAt = 0;

function enqueueImageOrderTask(taskFn) {
  pendingImageQueueCount++;
  const runTask = async () => {
    try {
      const now = Date.now();
      if (now - lastImageFinishedAt > 45000) {
        consecutiveBurstProcessed = 0;
      }
      consecutiveBurstProcessed++;

      if (consecutiveBurstProcessed >= 7) {
        addLog(`⏳ Batch Image #${consecutiveBurstProcessed}: pausing 3.5s to keep free OCR/Vision APIs smooth...`);
        await sleep(3500);
      } else if (consecutiveBurstProcessed > 1) {
        await sleep(1200);
      }

      await taskFn();
    } catch (err) {
      addLog(`❌ Queued Image Task Error: ${err.message}`);
    } finally {
      lastImageFinishedAt = Date.now();
      pendingImageQueueCount = Math.max(0, pendingImageQueueCount - 1);
    }
  };
  imageProcessingChain = imageProcessingChain.then(runTask, runTask);
  return imageProcessingChain;
}

async function downloadImageBufferWithRetry(msg) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1 && sock?.updateMediaMessage) {
        try {
          await sock.updateMediaMessage(msg);
        } catch (e) {}
        await sleep(1000 * attempt);
      }
      const buf = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage }
      );
      if (buf && buf.length > 0) return buf;
    } catch (err) {
      lastErr = err;
      addLog(`⚠️ Image media download retry ${attempt}/3: ${err.message}`);
    }
  }
  throw lastErr || new Error('Empty image buffer');
}

let ocrKeyRotateIdx = 0;
async function runOcrSpacePass(base64Image, mimeType, engineNumber = '2', isTable = 'true') {
  if (Date.now() < ocrSpaceCooldownUntil) {
    return '';
  }

  const configuredKeys = (process.env.OCR_SPACE_API_KEY || botConfig.ocrSpaceApiKey || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const keyPool = configuredKeys.length > 0 ? configuredKeys : ['helloworld'];

  if (keyPool.length === 1 && keyPool[0] === 'helloworld' && getRecentOcrSpaceCount() >= 8) {
    return '';
  }

  const apiKey = keyPool[ocrKeyRotateIdx % keyPool.length];
  ocrKeyRotateIdx++;

  const formData = new URLSearchParams();
  formData.append('apikey', apiKey);
  formData.append('base64Image', `data:${mimeType || 'image/jpeg'};base64,${base64Image}`);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', String(engineNumber));
  formData.append('scale', 'true');
  formData.append('isTable', String(isTable));
  formData.append('detectOrientation', 'true');

  try {
    ocrSpaceCallTimestamps.push(Date.now());
    const response = await fetchWithTimeout(
      'https://api.ocr.space/parse/image',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      },
      22000
    );

    if (response.status === 403 || response.status === 429 || response.status === 503) {
      ocrSpaceCooldownUntil = Date.now() + 25000;
      return '';
    }
    if (!response.ok) return '';

    const data = await response.json();
    if (data?.IsErroredOnProcessing) return '';
    return (data?.ParsedResults || [])
      .map((r) => r.ParsedText || '')
      .join('\n')
      .trim();
  } catch (e) {
    return '';
  }
}

async function runKeylessVisionPass(base64Image, mimeType, modelName = 'openai') {
  if (getRecentVisionCount() >= 14) {
    await sleep(2500);
  }
  const systemPrompt =
    'You are an expert pharmaceutical order OCR transcription assistant for Renata PLC in Bangladesh. ' +
    'Transcribe ALL text from this handwritten or printed medicine order image line by line. ' +
    'Preserve DA ID (e.g. CF4526, RF20363, C210012), PSO code (e.g. E71, T24, 475), Pharmacy/Party name, ' +
    'and each medicine name with its ordered quantity (e.g. Totifen 100ml - 50, Doxicap - 10, Lucan R 200 - 20). ' +
    'Output ONLY the transcribed lines without extra commentary.';

  try {
    visionCallTimestamps.push(Date.now());
    const res = await fetchWithTimeout(
      'https://text.pollinations.ai/openai',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Read all medicine order lines, DA ID, PSO code, and quantities from this image:' },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}` }
                }
              ]
            }
          ],
          temperature: 0.1
        })
      },
      26000
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    return '';
  }
}

async function runGeminiVisionPass(base64Image, mimeType) {
  const apiKey = (botConfig.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return '';
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Transcribe all handwritten or printed medicine order lines, DA ID (CF/RF/C), PSO code, Pharmacy name, and quantities from this image line by line:'
                },
                {
                  inline_data: {
                    mime_type: mimeType || 'image/jpeg',
                    data: base64Image
                  }
                }
              ]
            }
          ]
        })
      },
      22000
    );
    if (!res.ok) return '';
    const data = await res.json();
    return (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('\n')
      .trim();
  } catch (e) {
    return '';
  }
}

async function runLocalTesseractPass(imageBuffer) {
  if (!localTesseract || !imageBuffer) return '';
  try {
    const res = await localTesseract.recognize(imageBuffer, 'eng');
    return (res?.data?.text || '').trim();
  } catch (e) {
    return '';
  }
}

async function processImageOrderWithThreeRetries({
  imageBuffer,
  mimeType = 'image/jpeg',
  caption = '',
  messageId,
  timestamp,
  senderPhone,
  senderPushName,
  senderJid
}) {
  const imgHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  if (imageOcrResultCache.has(imgHash)) {
    const cachedText = imageOcrResultCache.get(imgHash);
    const combinedText = [caption, cachedText].filter(Boolean).join('\n');
    const parsed = parseWhatsAppOrderMessage({
      messageText: combinedText,
      messageId,
      timestamp,
      senderPhone,
      senderPushName,
      senderJid,
      isImageOrder: true
    });
    if ((parsed.orders && parsed.orders.length > 0) || (parsed.unrecognizedItems && parsed.unrecognizedItems.length > 0)) {
      return { ok: true, parsed, extractedText: cachedText, engine: 'Cached-OCR', attemptUsed: 1 };
    }
  }

  const base64Image = imageBuffer.toString('base64');
  const methods = [
    {
      name: 'Method 1/5 (Neural Handwriting & Table OCR Engine 2)',
      run: () => runOcrSpacePass(base64Image, mimeType, '2', 'true')
    },
    {
      name: 'Method 2/5 (Keyless Multimodal Vision AI #1 — Primary)',
      run: () => runKeylessVisionPass(base64Image, mimeType, 'openai')
    },
    {
      name: 'Method 3/5 (Keyless Multimodal Vision AI #2 — Fast/Alt Vision)',
      run: () => runKeylessVisionPass(base64Image, mimeType, 'openai-large')
    },
    {
      name: 'Method 4/5 (Raw Line-by-Line Camera OCR Engine 2)',
      run: () => runOcrSpacePass(base64Image, mimeType, '2', 'false')
    },
    {
      name: 'Method 5/5 (High-Contrast Orientation OCR Engine 1 + Gemini/Local Retry)',
      run: async () => {
        const gText = await runGeminiVisionPass(base64Image, mimeType);
        if (gText) return gText;
        const o1 = await runOcrSpacePass(base64Image, mimeType, '1', 'true');
        if (o1) return o1;
        return await runLocalTesseractPass(imageBuffer);
      }
    }
  ];

  let bestExtractedText = '';
  let bestParsed = null;
  let bestOrderCount = 0;
  let bestEngine = '';
  let bestAttempt = 0;

  for (let i = 0; i < methods.length; i++) {
    const m = methods[i];
    if (i > 0) {
      addLog(`🔄 Image Auto-Recheck [${m.name}] running...`);
    }
    const textOut = await m.run();
    if (!textOut) continue;

    if (textOut.length > bestExtractedText.length) {
      bestExtractedText = textOut;
    }

    const combined = [caption, textOut].filter(Boolean).join('\n');
    const candidateParsed = parseWhatsAppOrderMessage({
      messageText: combined,
      messageId,
      timestamp,
      senderPhone,
      senderPushName,
      senderJid,
      isImageOrder: true
    });

    const oCount = (candidateParsed.orders || []).length;
    const uCount = (candidateParsed.unrecognizedItems || []).length;

    if (oCount > 0 && uCount === 0) {
      imageOcrResultCache.set(imgHash, textOut);
      if (imageOcrResultCache.size > 200) {
        const firstK = imageOcrResultCache.keys().next().value;
        if (firstK) imageOcrResultCache.delete(firstK);
      }
      return {
        ok: true,
        parsed: candidateParsed,
        extractedText: textOut,
        engine: m.name,
        attemptUsed: i + 1
      };
    }

    if (oCount + uCount > bestOrderCount) {
      bestOrderCount = oCount + uCount;
      bestParsed = candidateParsed;
      bestEngine = m.name;
      bestAttempt = i + 1;
    }
  }

  if (bestParsed && bestOrderCount > 0) {
    return {
      ok: true,
      parsed: bestParsed,
      extractedText: bestExtractedText,
      engine: bestEngine,
      attemptUsed: bestAttempt
    };
  }

  return {
    ok: false,
    parsed: null,
    extractedText: bestExtractedText,
    engine: 'None',
    attemptUsed: methods.length
  };
}

function buildImageOrderReplyMessage(orders, engineName = 'AI-OCR', attemptUsed = 1) {
  const first = orders[0] || {};
  const totalAmt = orders.reduce((acc, o) => acc + (o.totalAmount || 0), 0);
  const lines = orders.map(
    (o, i) => `${i + 1}. *${o.productName}* — ${o.orderedQty} × ৳${Number(o.unitPrice).toFixed(2)} = *৳${Number(o.totalAmount).toFixed(2)}*`
  );
  return (
    `✅ *ছবি থেকে অর্ডারটি Google Sheet-এ সেভ হয়েছে!*\n` +
    `👤 *DA:* [${first.daId}] ${first.daName}\n` +
    `🏥 *Party:* ${first.pharmacyName} (PSO: ${first.psoCode})\n\n` +
    `📦 *অর্ডারকৃত প্রোডাক্টসমূহ:*\n` +
    lines.join('\n') +
    `\n\n💰 *মোট টাকা:* *৳${totalAmt.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n` +
    `❌ _অর্ডারটি বাতিল করতে এই মেসেজের Reply-তে লিখুন:_ */cnl*`
  );
}

// ============================================================================
// 8. GOOGLE SHEETS API & CLOUD PERSISTENCE ENGINE
// ============================================================================
let sheetsClient = null;
let googleAuthReady = false;
let googleAuthError = null;

let botConfig = {
  targetGroupId: process.env.TARGET_GROUP_ID || '',
  targetGroupName: process.env.TARGET_GROUP_NAME || 'CRP sales NK Depot',
  autoReactOnOrder: true,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  authorizedImageLids: [...DEFAULT_AUTHORIZED_LIDS],
  priceVersion: 'TRADE_PRICE_2026_10_30',
  updatedAt: null
};

const cancellableOrderMap = new Map();
const lastOrderBySenderMap = new Map();

if (fs.existsSync(LOCAL_CONFIG_PATH)) {
  try {
    const saved = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
    botConfig = {
      ...botConfig,
      ...saved,
      authorizedImageLids: Array.from(
        new Set([...DEFAULT_AUTHORIZED_LIDS, ...(saved.authorizedImageLids || [])])
      ).slice(0, 200)
    };
  } catch (e) {}
}

function saveLocalConfig() {
  try {
    if (Array.isArray(botConfig.authorizedImageLids) && botConfig.authorizedImageLids.length > 200) {
      botConfig.authorizedImageLids = botConfig.authorizedImageLids.slice(0, 200);
    }
    fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(botConfig, null, 2), 'utf8');
  } catch (e) {}
}

// ============================================================================
// 8B. v5.8-v6.0 TARGET GROUP & LAST 5 MESSAGE ID PERSISTENCE IN master_db.json
// ============================================================================
const sheetExistingMsgIds = new Set();
let isReconnectingWhatsApp = false;

function ensureMasterDbV58Structure() {
  if (!masterDb.targetGroup || typeof masterDb.targetGroup !== 'object') {
    masterDb.targetGroup = {
      targetGroupId: botConfig.targetGroupId || '',
      targetGroupName: botConfig.targetGroupName || 'CRP sales NK Depot',
      autoReactOnOrder: typeof botConfig.autoReactOnOrder === 'boolean' ? botConfig.autoReactOnOrder : true,
      updatedAt: new Date().toISOString()
    };
  }
  if (!Array.isArray(masterDb.lastProcessedMsgIds)) {
    masterDb.lastProcessedMsgIds = [];
  }
  if (!Array.isArray(masterDb.recentProcessedMsgIds)) {
    masterDb.recentProcessedMsgIds = [...masterDb.lastProcessedMsgIds];
  }
  if (typeof masterDb.lastProcessedMsgTimestamp !== 'number') {
    masterDb.lastProcessedMsgTimestamp = 0;
  }
}

function syncTargetGroupFromMasterDbToBotConfig() {
  ensureMasterDbV58Structure();
  const tg = masterDb.targetGroup;
  if (tg && (tg.targetGroupId || tg.targetGroupName)) {
    if (tg.targetGroupId) botConfig.targetGroupId = tg.targetGroupId;
    if (tg.targetGroupName) botConfig.targetGroupName = tg.targetGroupName;
    if (typeof tg.autoReactOnOrder === 'boolean') {
      botConfig.autoReactOnOrder = tg.autoReactOnOrder;
    }
  } else if (botConfig.targetGroupId || botConfig.targetGroupName) {
    masterDb.targetGroup = {
      targetGroupId: botConfig.targetGroupId || '',
      targetGroupName: botConfig.targetGroupName || 'CRP sales NK Depot',
      autoReactOnOrder: typeof botConfig.autoReactOnOrder === 'boolean' ? botConfig.autoReactOnOrder : true,
      updatedAt: new Date().toISOString()
    };
  }
}

function saveTargetGroupToMasterDb(groupId, groupName, autoReactOnOrder) {
  ensureMasterDbV58Structure();
  masterDb.targetGroup = {
    targetGroupId: String(groupId || '').trim(),
    targetGroupName: String(groupName || (groupId === 'ALL' ? 'All Joined Groups (সব গ্রুপ)' : 'CRP sales NK Depot')).trim(),
    autoReactOnOrder: typeof autoReactOnOrder === 'boolean' ? autoReactOnOrder : botConfig.autoReactOnOrder,
    updatedAt: new Date().toISOString()
  };
  botConfig.targetGroupId = masterDb.targetGroup.targetGroupId;
  botConfig.targetGroupName = masterDb.targetGroup.targetGroupName;
  botConfig.autoReactOnOrder = masterDb.targetGroup.autoReactOnOrder;
  botConfig.updatedAt = masterDb.targetGroup.updatedAt;
  saveLocalConfig();
  saveLocalMasterDb();
}

function isMessageAlreadyProcessed(msgId) {
  if (!msgId) return false;
  const cleanId = String(msgId).trim();
  if (!cleanId) return false;
  ensureMasterDbV58Structure();
  if (masterDb.lastProcessedMsgIds.includes(cleanId)) return true;
  if (masterDb.recentProcessedMsgIds.includes(cleanId)) return true;
  if (sheetExistingMsgIds.has(cleanId)) return true;
  return false;
}

function recordProcessedGroupMessageId(msgId, timestampMs = Date.now()) {
  if (!msgId) return;
  const cleanId = String(msgId).trim();
  if (!cleanId || cleanId.startsWith('TEST_')) return;
  ensureMasterDbV58Structure();
  sheetExistingMsgIds.add(cleanId);

  masterDb.lastProcessedMsgIds = [
    cleanId,
    ...masterDb.lastProcessedMsgIds.filter((id) => id !== cleanId)
  ].slice(0, 5);

  masterDb.recentProcessedMsgIds = [
    cleanId,
    ...masterDb.recentProcessedMsgIds.filter((id) => id !== cleanId)
  ].slice(0, 150);

  const tsNum = Number(timestampMs) || Date.now();
  if (tsNum > (masterDb.lastProcessedMsgTimestamp || 0)) {
    masterDb.lastProcessedMsgTimestamp = tsNum;
  }

  saveLocalMasterDb();
  scheduleCloudStateBackup(4000);
}

async function syncExistingSheetMessageIds() {
  if (!sheetsClient || !googleAuthReady || !GOOGLE_SHEET_ID) return;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!B2:B3000`
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      const id = String((r && r[0]) || '').trim();
      if (id) sheetExistingMsgIds.add(id);
    }
    ensureMasterDbV58Structure();
    if (masterDb.lastProcessedMsgIds.length === 0 && rows.length > 0) {
      const last5 = [];
      for (let i = rows.length - 1; i >= 0 && last5.length < 5; i--) {
        const id = String((rows[i] && rows[i][0]) || '').trim();
        if (id && !last5.includes(id)) last5.push(id);
      }
      if (last5.length > 0) {
        masterDb.lastProcessedMsgIds = last5;
        masterDb.recentProcessedMsgIds = Array.from(
          new Set([...last5, ...(masterDb.recentProcessedMsgIds || [])])
        ).slice(0, 150);
        saveLocalMasterDb();
      }
    }
  } catch (e) {}
}

async function initGoogleSheetsClient() {
  try {
    let credentials = null;
    const rawEnv = process.env.GOOGLE_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (rawEnv) {
      const trimmed = rawEnv.trim();
      if (trimmed.startsWith('{')) {
        credentials = JSON.parse(trimmed);
      } else {
        credentials = JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
      }
    } else if (fs.existsSync(path.join(__dirname, 'credentials.json'))) {
      credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8'));
    }

    if (!credentials) {
      googleAuthError = 'GOOGLE_CREDENTIALS_JSON environment variable is not set yet.';
      googleAuthReady = false;
      return false;
    }

    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    googleAuthReady = true;
    googleAuthError = null;
    addLog('✅ Google Sheets API authenticated successfully.');
    return true;
  } catch (err) {
    googleAuthError = err.message;
    googleAuthReady = false;
    addLog(`⚠️ Google Sheets Auth Error: ${err.message}`);
    return false;
  }
}

async function ensureSpreadsheetStructure(forceUpdateTradePrices = true) {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return false;
  try {
    const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    const existingTabs = new Map(
      (meta.data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId])
    );

    const requests = [];
    for (const tabName of Object.values(SHEET_TABS)) {
      if (!existingTabs.has(tabName)) {
        requests.push({
          addSheet: {
            properties: {
              title: tabName,
              hidden: tabName === SHEET_TABS.BOT_STATE
            }
          }
        });
      }
    }

    if (requests.length > 0) {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: GOOGLE_SHEET_ID,
        requestBody: { requests }
      });
      addLog(`📄 Created ${requests.length} missing worksheet tabs in Google Sheet.`);
    }

    // 1. Live_Orders Header
    const liveHeaderRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A1:S1`
    });
    if (!liveHeaderRes.data.values || liveHeaderRes.data.values.length === 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.LIVE_ORDERS}!A1:S1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Order Line ID', 'WhatsApp Msg ID', 'Date', 'Time', 'Primary DA ID',
            'Old / Alt ID', 'DA Name', 'Sender Phone', 'PSO Code', 'Pharmacy / Party Name',
            'Raw WhatsApp Text', 'CRP Code', 'Official Product Name', 'Pack Unit',
            'Ordered Qty', 'Trade Price (BDT)', 'Total Amount (BDT)', 'Match Type', 'Status'
          ]]
        }
      });
    }

    // 1B. All_Message_Logs Header
    const msgLogHeaderRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.MESSAGE_LOGS}!A1:K1`
    });
    if (!msgLogHeaderRes.data.values || msgLogHeaderRes.data.values.length === 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.MESSAGE_LOGS}!A1:K1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Log ID',
            'WhatsApp Msg ID',
            'Date',
            'Time',
            'Order Saved? (✅ / ❌)',
            'Live_Orders Row No. (Auto-Updated)',
            'Sender Phone',
            'Sender Name',
            'DA ID & Name',
            'Full WhatsApp Message',
            'Order Summary / Note'
          ]]
        }
      });
    }

    // 2. Deleted_Unsent_Log Header
    const delHeaderRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.DELETED_LOG}!A1:T1`
    });
    if (!delHeaderRes.data.values || delHeaderRes.data.values.length === 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.DELETED_LOG}!A1:T1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            'Order Line ID', 'WhatsApp Msg ID', 'Order Date', 'Order Time', 'Primary DA ID',
            'Old / Alt ID', 'DA Name', 'Sender Phone', 'PSO Code', 'Pharmacy / Party Name',
            'Raw WhatsApp Text', 'CRP Code', 'Official Product Name', 'Pack Unit',
            'Ordered Qty', 'Trade Price (BDT)', 'Total Amount (BDT)', 'Match Type',
            'Action Reason', 'Deleted / Replaced At'
          ]]
        }
      });
    }

    // 3. DA_Wise_Summary Tab
    const daHeaderRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.DA_SUMMARY}!A1:I5`
    });
    if (!daHeaderRes.data.values || daHeaderRes.data.values.length === 0) {
      const daRows = [
        [
          'Rank / SL', 'Primary DA ID', 'Old / Alt ID', 'DA Name', 'Registered Phone / Alias',
          'Total Product Lines Ordered', 'Total Quantity Ordered (Packs)',
          'Total Order Amount (BDT)', 'Last Order Date & Time'
        ]
      ];
      activeDAs.forEach((da, i) => {
        const rowNum = i + 2;
        daRows.push([
          i + 1,
          da.daId,
          da.altId || '-',
          da.name,
          (da.phones || []).join(', ') || (da.aliases || [])[0] || '-',
          `=COUNTIF(${SHEET_TABS.LIVE_ORDERS}!E:E, B${rowNum})`,
          `=SUMIF(${SHEET_TABS.LIVE_ORDERS}!E:E, B${rowNum}, ${SHEET_TABS.LIVE_ORDERS}!O:O)`,
          `=SUMIF(${SHEET_TABS.LIVE_ORDERS}!E:E, B${rowNum}, ${SHEET_TABS.LIVE_ORDERS}!Q:Q)`,
          `=IFERROR(INDEX(FILTER(${SHEET_TABS.LIVE_ORDERS}!C:C & " " & TEXT(${SHEET_TABS.LIVE_ORDERS}!D:D, "hh:mm:ss AM/PM"), ${SHEET_TABS.LIVE_ORDERS}!E:E=B${rowNum}), COUNTIF(${SHEET_TABS.LIVE_ORDERS}!E:E, B${rowNum})), "-")`
        ]);
      });
      const totalRowNum = activeDAs.length + 2;
      daRows.push([
        'TOTAL', 'ALL DAs', '-', 'Grand Total Across All DAs', '-',
        `=SUM(F2:F${totalRowNum - 1})`,
        `=SUM(G2:G${totalRowNum - 1})`,
        `=SUM(H2:H${totalRowNum - 1})`,
        '-'
      ]);
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.DA_SUMMARY}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: daRows }
      });
    }

    // 4. Product_Wise_Summary Tab
    if (forceUpdateTradePrices) {
      const prodRows = [
        [
          'CRP Code', 'Official Product Name (CRP.xlsx)', 'Pack Unit',
          'Official Trade Price (BDT)', 'Total Order Lines',
          'Total Quantity Ordered', 'Total Order Amount (BDT)'
        ]
      ];
      activeProducts.forEach((p, idx) => {
        const r = idx + 2;
        prodRows.push([
          p.code,
          p.name,
          p.unit,
          p.price,
          `=COUNTIF(${SHEET_TABS.LIVE_ORDERS}!L:L, A${r})`,
          `=SUMIF(${SHEET_TABS.LIVE_ORDERS}!L:L, A${r}, ${SHEET_TABS.LIVE_ORDERS}!O:O)`,
          `=SUMIF(${SHEET_TABS.LIVE_ORDERS}!L:L, A${r}, ${SHEET_TABS.LIVE_ORDERS}!Q:Q)`
        ]);
      });
      const totalProdRow = activeProducts.length + 2;
      prodRows.push([
        'TOTAL', 'ALL CRP PRODUCTS', '-', '-',
        `=SUM(E2:E${totalProdRow - 1})`,
        `=SUM(F2:F${totalProdRow - 1})`,
        `=SUM(G2:G${totalProdRow - 1})`
      ]);
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.PRODUCT_SUMMARY}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: prodRows }
      });
    }

    return true;
  } catch (err) {
    addLog(`⚠️ Spreadsheet structure check warning: ${err.message}`);
    return false;
  }
}

// ============================================================================
// 9. PERMANENT CLOUD SESSION, CONFIG & MASTER JSON DB BACKUP (_Bot_State v6.0)
//    - Automatically splits BOT_CONFIG, MASTER_DB_GZIP, and WA_AUTH_GZIP into
//      strict 30,000-character chunks so Google Sheets NEVER throws:
//      "Your input contains more than the maximum of 50000 characters in a single cell."
// ============================================================================
let stateBackupTimer = null;
let lastStateRowCount = 45;

function appendChunkedStateRows(stateRows, keyPrefix, fullString, updatedAtStr = '') {
  const safeStr = String(fullString || '');
  const chunks = [];
  for (let i = 0; i < safeStr.length; i += MAX_STATE_CHUNK_CHARS) {
    chunks.push(safeStr.slice(i, i + MAX_STATE_CHUNK_CHARS));
  }
  if (chunks.length === 0) chunks.push('');
  stateRows.push([keyPrefix, chunks[0], updatedAtStr || `${chunks.length} chunk(s)`]);
  for (let c = 1; c < chunks.length; c++) {
    stateRows.push([`${keyPrefix}_${c}`, chunks[c], '']);
  }
}

async function backupAuthAndConfigToSheet() {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return;
  try {
    const authFiles = {};
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs
        .readdirSync(AUTH_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const fullPath = path.join(AUTH_DIR, f);
          const stat = fs.statSync(fullPath);
          return { name: f, fullPath, isFile: stat.isFile(), mtimeMs: stat.mtimeMs };
        })
        .filter((x) => x.isFile);

      // Always keep creds.json + app-state-sync + up to 120 most recently modified key/session files
      // so Baileys auth backup never bloats indefinitely over weeks of running!
      files.sort((a, b) => {
        if (a.name === 'creds.json') return -1;
        if (b.name === 'creds.json') return 1;
        return b.mtimeMs - a.mtimeMs;
      });

      const keptFiles = files.slice(0, 125);
      for (const item of keptFiles) {
        authFiles[item.name] = fs.readFileSync(item.fullPath, 'utf8');
      }
    }

    const payloadJson = JSON.stringify({ authFiles, savedAt: new Date().toISOString() });
    const compressedAuthBase64 = zlib.gzipSync(Buffer.from(payloadJson, 'utf8')).toString('base64');

    // Exclude bulky full-text messageLogs from _Bot_State cloud GZIP (keep only last 15 compact logs,
    // because all message logs are ALREADY saved in the All_Message_Logs sheet tab and local master_db.json!)
    const compactMasterDbForCloud = {
      ...masterDb,
      messageLogs: (masterDb.messageLogs || []).slice(0, 15).map((m) => ({
        ...m,
        fullMessage: String(m.fullMessage || '').slice(0, 250)
      }))
    };
    const masterDbJson = JSON.stringify(compactMasterDbForCloud);
    const masterDbGzip = zlib.gzipSync(Buffer.from(masterDbJson, 'utf8')).toString('base64');

    const cleanBotConfigForCloud = {
      ...botConfig,
      authorizedImageLids: Array.from(new Set(botConfig.authorizedImageLids || [])).slice(0, 150)
    };
    const botConfigJson = JSON.stringify(cleanBotConfigForCloud);

    const nowIso = new Date().toISOString();
    const stateRows = [['Key', 'Value', 'Updated At']];

    // Chunk ALL THREE keys into strict <= 30,000-character cells!
    appendChunkedStateRows(stateRows, 'BOT_CONFIG', botConfigJson, nowIso);
    appendChunkedStateRows(stateRows, 'MASTER_DB_GZIP', masterDbGzip, masterDb.updatedAt || nowIso);
    appendChunkedStateRows(stateRows, 'WA_AUTH_GZIP', compressedAuthBase64, nowIso);

    const activeRowCount = stateRows.length;
    const totalRowsToWrite = Math.max(activeRowCount, lastStateRowCount, 45);
    while (stateRows.length < totalRowsToWrite) {
      stateRows.push(['', '', '']);
    }
    lastStateRowCount = activeRowCount;

    // Single atomic update (never clears before writing, and every cell is strictly <= 30,000 chars!)
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.BOT_STATE}!A1:C${stateRows.length}`,
      valueInputOption: 'RAW',
      requestBody: { values: stateRows }
    });
  } catch (err) {
    addLog(`⚠️ Cloud state backup warning: ${err.message}`);
  }
}

function scheduleCloudStateBackup(delayMs = 5000) {
  if (stateBackupTimer) clearTimeout(stateBackupTimer);
  stateBackupTimer = setTimeout(() => {
    backupAuthAndConfigToSheet();
  }, delayMs);
}

async function restoreAuthAndConfigFromSheet() {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return false;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.BOT_STATE}!A1:C250`
    });
    const rows = res.data.values || [];
    lastStateRowCount = Math.max(rows.length, 45);

    const botConfigChunks = [];
    const masterDbChunks = [];
    const waAuthChunks = [];

    for (const row of rows) {
      const [key, val] = row;
      if (!key || !val) continue;
      if (key === 'BOT_CONFIG' || key.startsWith('BOT_CONFIG_')) {
        botConfigChunks.push(val);
      } else if (key === 'MASTER_DB_GZIP' || key.startsWith('MASTER_DB_GZIP_')) {
        masterDbChunks.push(val);
      } else if (key === 'WA_AUTH_GZIP' || key.startsWith('WA_AUTH_GZIP_')) {
        waAuthChunks.push(val);
      }
    }

    if (botConfigChunks.length > 0) {
      try {
        const parsedConfig = JSON.parse(botConfigChunks.join(''));
        botConfig = {
          ...botConfig,
          ...parsedConfig,
          authorizedImageLids: Array.from(
            new Set([
              ...DEFAULT_AUTHORIZED_LIDS,
              ...(botConfig.authorizedImageLids || []),
              ...(parsedConfig.authorizedImageLids || [])
            ])
          ).slice(0, 200)
        };
        saveLocalConfig();
        addLog(`☁️ Restored saved group config: "${botConfig.targetGroupName}" (${botConfig.targetGroupId || 'All Groups'})`);
      } catch (e) {}
    }

    if (masterDbChunks.length > 0) {
      try {
        const unzippedDb = zlib.gunzipSync(Buffer.from(masterDbChunks.join(''), 'base64')).toString('utf8');
        const parsedDb = JSON.parse(unzippedDb);
        applyMasterDbObject(parsedDb, true);
        syncTargetGroupFromMasterDbToBotConfig();
        saveLocalConfig();
        addLog(`☁️ Restored Dynamic Master DB from Cloud (${masterDb.das.length} DAs, ${masterDb.products.length} Products, Target Group: "${botConfig.targetGroupName}").`);
      } catch (e) {}
    }

    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (!fs.existsSync(credsPath) && waAuthChunks.length > 0) {
      const fullBase64 = waAuthChunks.join('');
      const unzipped = zlib.gunzipSync(Buffer.from(fullBase64, 'base64')).toString('utf8');
      const { authFiles } = JSON.parse(unzipped);
      if (authFiles && authFiles['creds.json']) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        for (const [filename, content] of Object.entries(authFiles)) {
          const parsed = JSON.parse(content, BufferJSON.reviver);
          fs.writeFileSync(
            path.join(AUTH_DIR, filename),
            JSON.stringify(parsed, BufferJSON.replacer, 2),
            'utf8'
          );
        }
        addLog('🔐 Restored WhatsApp login session from Google Sheet cloud backup! No QR scan needed.');
        return true;
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

// ============================================================================
// 10. GOOGLE SHEETS ORDER CRUD + ALL_MESSAGE_LOGS & LIVE ROW AUTO-SYNC (v6.0)
// ============================================================================
let sheetQueue = Promise.resolve();
function enqueueSheetTask(taskFn) {
  sheetQueue = sheetQueue.then(taskFn).catch((err) => {
    addLog(`❌ Sheet Queue Error: ${err.message}`);
  });
  return sheetQueue;
}

const liveMsgIdToSheetRowsMap = new Map();

function ensureMessageLogsArray() {
  if (!Array.isArray(masterDb.messageLogs)) {
    masterDb.messageLogs = [];
  }
}

async function recordMessageInAllLogs({
  whatsappMsgId,
  dateStr,
  timeStr,
  senderPhone = '',
  senderPushName = '',
  daId = '-',
  daName = '-',
  fullMessage = '',
  isSaved = false,
  sheetRows = [],
  note = ''
}) {
  if (!whatsappMsgId) return null;
  const cleanMsgId = String(whatsappMsgId).trim();
  if (!cleanMsgId) return null;

  ensureMessageLogsArray();
  const dtNow = new Date();
  const finalDate = dateStr || dtNow.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' });
  const finalTime = timeStr || dtNow.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const normPhone = normalizeBdPhone(senderPhone);
  const displayPhone = normPhone ? `+${normPhone}` : (senderPhone || '-');

  const currentMappedRows = liveMsgIdToSheetRowsMap.get(cleanMsgId) || sheetRows || [];
  const finalSaved = currentMappedRows.length > 0 ? true : Boolean(isSaved);
  const finalRows = currentMappedRows.length > 0 ? currentMappedRows : (sheetRows || []);
  const rowLabel = finalRows.length > 0 ? `Row ${finalRows.join(', ')}` : (finalSaved ? 'Saved' : '❌ সেভ হয়নি');
  const safeMsg = safeSheetCell(String(fullMessage || '').trim(), 8000);
  const safeNote = safeSheetCell(note || (finalSaved ? 'Order Saved' : 'Not Saved'), 2000);

  let existing = masterDb.messageLogs.find((m) => m.whatsappMsgId === cleanMsgId);
  if (existing) {
    if (safeMsg && (!existing.fullMessage || safeMsg.length >= existing.fullMessage.length)) {
      existing.fullMessage = safeMsg;
    }
    if (displayPhone && displayPhone !== '-') existing.senderPhone = displayPhone;
    if (senderPushName) existing.senderPushName = senderPushName;
    if (daId && daId !== '-' && daId !== 'UNRESOLVED') existing.daId = daId;
    if (daName && daName !== '-' && !daName.startsWith('Unknown')) existing.daName = daName;
    existing.isSaved = finalSaved;
    existing.sheetRows = finalRows;
    existing.sheetRowText = rowLabel;
    if (safeNote) existing.note = safeNote;
    existing.updatedAt = new Date().toISOString();
  } else {
    existing = {
      logId: `LOG_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`,
      whatsappMsgId: cleanMsgId,
      date: finalDate,
      time: finalTime,
      senderPhone: displayPhone,
      senderPushName: senderPushName || '-',
      daId: daId || '-',
      daName: daName || '-',
      fullMessage: safeMsg,
      isSaved: finalSaved,
      sheetRows: finalRows,
      sheetRowText: rowLabel,
      note: safeNote,
      updatedAt: new Date().toISOString()
    };
    masterDb.messageLogs.unshift(existing);
    if (masterDb.messageLogs.length > 250) {
      masterDb.messageLogs.length = 250;
    }
  }

  saveLocalMasterDb();

  if (sheetsClient && googleAuthReady && GOOGLE_SHEET_ID) {
    enqueueSheetTask(async () => {
      try {
        const colBRes = await sheetsClient.spreadsheets.values.get({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `${SHEET_TABS.MESSAGE_LOGS}!A1:B2500`
        });
        const rows = colBRes.data.values || [['Log ID', 'WhatsApp Msg ID']];
        let targetRow = -1;
        let firstEmptyRow = rows.length + 1;
        for (let i = 1; i < rows.length; i++) {
          const rLogId = String(rows[i]?.[0] || '').trim();
          const rMsgId = String(rows[i]?.[1] || '').trim();
          if (rMsgId === cleanMsgId) {
            targetRow = i + 1;
            break;
          }
          if (!rLogId && !rMsgId && firstEmptyRow === rows.length + 1) {
            firstEmptyRow = i + 1;
          }
        }
        if (targetRow === -1) targetRow = firstEmptyRow;

        const statusFormula = `=IF(COUNTIF(${SHEET_TABS.LIVE_ORDERS}!$B$2:$B$5000, INDIRECT("B"&ROW()))>0, "✅ Saved", "❌ Not Saved")`;
        const rowNumFormula = `=IFERROR(IF(COUNTIF(${SHEET_TABS.LIVE_ORDERS}!$B$2:$B$5000, INDIRECT("B"&ROW()))>0, "Row " & TEXTJOIN(", ", TRUE, ARRAYFORMULA(IF(${SHEET_TABS.LIVE_ORDERS}!$B$2:$B$5000=INDIRECT("B"&ROW()), ROW(${SHEET_TABS.LIVE_ORDERS}!$B$2:$B$5000), ""))), "❌ সেভ হয়নি"), "❌ সেভ হয়নি")`;

        const rowValues = [[
          safeSheetCell(existing.logId, 200),
          safeSheetCell(cleanMsgId, 200),
          `'${existing.date}`,
          `'${existing.time}`,
          statusFormula,
          rowNumFormula,
          safeSheetCell(existing.senderPhone, 100),
          safeSheetCell(existing.senderPushName, 200),
          safeSheetCell(`${existing.daId !== '-' ? '[' + existing.daId + '] ' : ''}${existing.daName}`, 300),
          safeSheetCell(existing.fullMessage, 15000),
          safeSheetCell(existing.note, 2000)
        ]];

        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `${SHEET_TABS.MESSAGE_LOGS}!A${targetRow}:K${targetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: rowValues }
        });
      } catch (e) {}
    });
  }

  return existing;
}

let isSyncingRowNumbers = false;
async function syncLiveSheetRowNumbers() {
  if (!sheetsClient || !googleAuthReady || !GOOGLE_SHEET_ID || isSyncingRowNumbers) return;
  isSyncingRowNumbers = true;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A2:S3500`
    });
    const rows = res.data.values || [];
    liveMsgIdToSheetRowsMap.clear();
    const lineIdToRowMap = new Map();
    const sheetOrderGroups = new Map();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !String(r[0] || '').trim()) continue;
      const exactSheetRowNum = i + 2;
      const lineId = String(r[0] || '').trim();
      const msgId = String(r[1] || '').trim();
      if (lineId) lineIdToRowMap.set(lineId, exactSheetRowNum);
      if (msgId) {
        sheetExistingMsgIds.add(msgId);
        if (!liveMsgIdToSheetRowsMap.has(msgId)) {
          liveMsgIdToSheetRowsMap.set(msgId, []);
        }
        liveMsgIdToSheetRowsMap.get(msgId).push(exactSheetRowNum);

        if (!sheetOrderGroups.has(msgId)) {
          sheetOrderGroups.set(msgId, {
            whatsappMsgId: msgId,
            date: String(r[2] || '').replace(/^'/, ''),
            time: String(r[3] || '').replace(/^'/, ''),
            daId: String(r[4] || '-'),
            daName: String(r[6] || '-'),
            senderPhone: String(r[7] || '-'),
            psoCode: String(r[8] || '-'),
            pharmacyName: String(r[9] || '-'),
            rawLines: [],
            productsSummary: []
          });
        }
        const grp = sheetOrderGroups.get(msgId);
        if (r[10]) grp.rawLines.push(String(r[10]));
        if (r[12]) grp.productsSummary.push(`${r[12]} (${r[14] || 0})`);
      }
    }

    for (const o of recentOrders) {
      if (o.orderLineId && lineIdToRowMap.has(o.orderLineId)) {
        o.sheetRowNumber = lineIdToRowMap.get(o.orderLineId);
      } else if (o.whatsappMsgId && liveMsgIdToSheetRowsMap.has(o.whatsappMsgId)) {
        const rList = liveMsgIdToSheetRowsMap.get(o.whatsappMsgId);
        o.sheetRowNumber = rList[0];
      } else {
        o.sheetRowNumber = null;
      }
    }

    ensureMessageLogsArray();
    let changed = false;

    for (const [msgId, grp] of sheetOrderGroups.entries()) {
      const exists = masterDb.messageLogs.some((m) => m.whatsappMsgId === msgId);
      if (!exists) {
        const rNums = liveMsgIdToSheetRowsMap.get(msgId) || [];
        masterDb.messageLogs.push({
          logId: `LOG_SEED_${msgId.slice(-8)}`,
          whatsappMsgId: msgId,
          date: grp.date,
          time: grp.time,
          senderPhone: grp.senderPhone,
          senderPushName: grp.daName,
          daId: grp.daId,
          daName: grp.daName,
          fullMessage: `${grp.daId} ${grp.daName}\nPSO: ${grp.psoCode} | Party: ${grp.pharmacyName}\n` + grp.rawLines.join('\n'),
          isSaved: true,
          sheetRows: rNums,
          sheetRowText: `Row ${rNums.join(', ')}`,
          note: `✅ সেভ হয়েছে (${grp.productsSummary.join(', ').slice(0, 300)})`,
          updatedAt: new Date().toISOString()
        });
        changed = true;
      }
    }

    for (const log of masterDb.messageLogs) {
      const currentRows = liveMsgIdToSheetRowsMap.get(log.whatsappMsgId) || [];
      const nowSaved = currentRows.length > 0;
      const newRowText = nowSaved ? `Row ${currentRows.join(', ')}` : '❌ সেভ হয়নি';
      if (log.isSaved !== nowSaved || log.sheetRowText !== newRowText) {
        log.isSaved = nowSaved;
        log.sheetRows = currentRows;
        log.sheetRowText = newRowText;
        if (!nowSaved && log.note && log.note.startsWith('✅')) {
          log.note = '❌ Google Sheet থেকে মুছে ফেলা হয়েছে';
        }
        changed = true;
      }
    }

    if (changed) {
      if (masterDb.messageLogs.length > 250) masterDb.messageLogs.length = 250;
      saveLocalMasterDb();
    }
  } catch (e) {
  } finally {
    isSyncingRowNumbers = false;
  }
}

async function appendOrdersToSheet(orders) {
  if (!orders || orders.length === 0) return [];
  return enqueueSheetTask(async () => {
    for (const o of orders) {
      recentOrders.unshift(o);
    }
    if (recentOrders.length > 50) recentOrders.length = 50;
    stats.totalOrdersSaved += orders.length;
    stats.totalAmountSaved = Number(
      (stats.totalAmountSaved + orders.reduce((acc, x) => acc + x.totalAmount, 0)).toFixed(2)
    );

    if (!sheetsClient || !googleAuthReady) {
      addLog(`⚠️ Order parsed locally (${orders.length} items) — waiting for Google Sheets credentials.`);
      return [];
    }

    const values = orders.map((o) => [
      safeSheetCell(o.orderLineId, 200),
      safeSheetCell(o.whatsappMsgId, 200),
      `'${o.date}`,
      `'${o.time}`,
      safeSheetCell(o.daId, 100),
      safeSheetCell(o.altId, 100),
      safeSheetCell(o.daName, 200),
      safeSheetCell(o.senderPhone, 100),
      safeSheetCell(o.psoCode, 100),
      safeSheetCell(o.pharmacyName, 500),
      safeSheetCell(o.rawText, 2000),
      safeSheetCell(o.crpCode, 100),
      safeSheetCell(o.productName, 300),
      safeSheetCell(o.packUnit, 100),
      o.orderedQty,
      o.unitPrice,
      o.totalAmount,
      safeSheetCell(o.matchType, 100),
      safeSheetCell(o.status, 100)
    ]);

    const colARes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A1:A3500`
    });
    const colARows = colARes.data.values || [['Order Line ID']];
    let targetStartRow = colARows.length + 1;
    for (let i = 1; i < colARows.length; i++) {
      if (!colARows[i] || !String(colARows[i][0] || '').trim()) {
        targetStartRow = i + 1;
        break;
      }
    }

    const targetEndRow = targetStartRow + values.length - 1;
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A${targetStartRow}:S${targetEndRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });

    const savedRowNums = [];
    for (let idx = 0; idx < orders.length; idx++) {
      const rNum = targetStartRow + idx;
      savedRowNums.push(rNum);
      orders[idx].sheetRowNumber = rNum;
    }

    const msgId = orders[0]?.whatsappMsgId;
    if (msgId) {
      liveMsgIdToSheetRowsMap.set(msgId, savedRowNums);
      recordProcessedGroupMessageId(msgId, Date.now());
      ensureMessageLogsArray();
      const logItem = masterDb.messageLogs.find((m) => m.whatsappMsgId === msgId);
      const summaryNote = `✅ সেভ হয়েছে (${orders.map((o) => `${o.productName} x${o.orderedQty}`).join(', ').slice(0, 300)})`;
      if (logItem) {
        logItem.isSaved = true;
        logItem.sheetRows = savedRowNums;
        logItem.sheetRowText = `Row ${savedRowNums.join(', ')}`;
        logItem.daId = orders[0].daId;
        logItem.daName = orders[0].daName;
        logItem.note = summaryNote;
        saveLocalMasterDb();
      } else {
        recordMessageInAllLogs({
          whatsappMsgId: msgId,
          dateStr: orders[0].date,
          timeStr: orders[0].time,
          senderPhone: orders[0].senderPhone,
          senderPushName: orders[0].daName,
          daId: orders[0].daId,
          daName: orders[0].daName,
          fullMessage: orders.map((o) => o.rawText).join('\n'),
          isSaved: true,
          sheetRows: savedRowNums,
          note: summaryNote
        }).catch(() => {});
      }
    }

    addLog(
      `✅ Saved ${orders.length} order line(s) at Row ${savedRowNums.join(', ')} from ${orders[0].daName} (${orders[0].daId}) to Google Sheets.`
    );
    return savedRowNums;
  });
}

async function removeOrdersByMessageId(whatsappMsgId, reason = 'UNSENT_BY_USER') {
  if (!whatsappMsgId) return 0;
  return enqueueSheetTask(async () => {
    const removedLocal = [];
    for (let i = recentOrders.length - 1; i >= 0; i--) {
      if (recentOrders[i].whatsappMsgId === whatsappMsgId) {
        const [rem] = recentOrders.splice(i, 1);
        removedLocal.push(rem);
      }
    }
    if (removedLocal.length > 0 && (reason === 'UNSENT_BY_USER' || reason === 'CANCELLED_BY_CNL')) {
      stats.totalOrdersDeleted += removedLocal.length;
      stats.totalOrdersSaved = Math.max(0, stats.totalOrdersSaved - removedLocal.length);
      const subtracted = removedLocal.reduce((acc, x) => acc + (x.totalAmount || 0), 0);
      stats.totalAmountSaved = Number(Math.max(0, stats.totalAmountSaved - subtracted).toFixed(2));
    }

    if (!sheetsClient || !googleAuthReady) {
      return removedLocal.length;
    }

    const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    const liveSheet = (meta.data.sheets || []).find(
      (s) => s.properties.title === SHEET_TABS.LIVE_ORDERS
    );
    if (!liveSheet) return 0;
    const liveSheetId = liveSheet.properties.sheetId;

    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A1:S`
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return 0;

    const matchingZeroBasedIndices = [];
    const archivedRows = [];
    const deletedAt = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });

    for (let r = 1; r < rows.length; r++) {
      const rowMsgId = String(rows[r]?.[1] || '').trim();
      if (rowMsgId === String(whatsappMsgId).trim()) {
        matchingZeroBasedIndices.push(r);
        const fullRow = rows[r].map((cell) => safeSheetCell(cell, 5000));
        while (fullRow.length < 18) fullRow.push('');
        fullRow[18] = reason;
        fullRow.push(deletedAt);
        archivedRows.push(fullRow);
      }
    }

    if (matchingZeroBasedIndices.length === 0) return removedLocal.length;

    const deleteRequests = matchingZeroBasedIndices
      .sort((a, b) => b - a)
      .map((rowIndex) => ({
        deleteDimension: {
          range: {
            sheetId: liveSheetId,
            dimension: 'ROWS',
            startIndex: rowIndex,
            endIndex: rowIndex + 1
          }
        }
      }));

    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: { requests: deleteRequests }
    });

    if (archivedRows.length > 0) {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.DELETED_LOG}!A:T`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: archivedRows }
      });
    }

    liveMsgIdToSheetRowsMap.delete(String(whatsappMsgId).trim());
    setTimeout(() => {
      syncLiveSheetRowNumbers().catch(() => {});
    }, 500);
    addLog(
      `🗑️ Auto-removed ${matchingZeroBasedIndices.length} order line(s) from Google Sheet (${reason}, Msg ID: ${whatsappMsgId}) & auto-updated Row numbers.`
    );
    return matchingZeroBasedIndices.length;
  });
}

async function applyFollowUpPatchToSheet(patch) {
  if (!patch) return;
  return enqueueSheetTask(async () => {
    const cleanPhone = patch.senderPhone ? `+${normalizeBdPhone(patch.senderPhone)}` : '';
    for (const o of recentOrders) {
      if (cleanPhone && o.senderPhone === cleanPhone) {
        if (patch.daInfo && (o.daId.startsWith('WA-') || o.daId === 'UNKNOWN')) {
          o.daId = patch.daInfo.daId;
          o.altId = patch.daInfo.altId || '-';
          o.daName = patch.daInfo.name;
        }
        if (patch.psoCode && (!o.psoCode || o.psoCode === '-')) {
          o.psoCode = patch.psoCode;
        }
      }
    }

    if (!sheetsClient || !googleAuthReady || !cleanPhone) return;

    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A1:S`
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return;

    const dataUpdates = [];
    for (let r = rows.length - 1; r >= Math.max(1, rows.length - 25); r--) {
      if (!rows[r]) continue;
      const rowPhone = String(rows[r][7] || '').trim();
      if (rowPhone === cleanPhone) {
        const rowNum = r + 1;
        if (patch.daInfo && (String(rows[r][4]).startsWith('WA-') || rows[r][4] === 'UNKNOWN')) {
          dataUpdates.push({
            range: `${SHEET_TABS.LIVE_ORDERS}!E${rowNum}:G${rowNum}`,
            values: [[patch.daInfo.daId, patch.daInfo.altId || '-', patch.daInfo.name]]
          });
        }
        if (patch.psoCode && (!rows[r][8] || rows[r][8] === '-')) {
          dataUpdates.push({
            range: `${SHEET_TABS.LIVE_ORDERS}!I${rowNum}`,
            values: [[patch.psoCode]]
          });
        }
      }
    }

    if (dataUpdates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId: GOOGLE_SHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: dataUpdates
        }
      });
      addLog(`🔧 Applied follow-up patch (${patch.daInfo?.daId || ''} ${patch.psoCode || ''}) to recent order rows.`);
    }
  });
}

// ============================================================================
// 11. WHATSAPP BAILEYS ENGINE + UNIFIED SELF-LEARNING ADMIN BOT (01793362829)
// ============================================================================
let sock = null;
let waStatus = 'DISCONNECTED';
let currentQrDataUrl = null;
let connectedUser = null;
let joinedGroups = [];
const recentOrders = [];
const activityLogs = [];

const pendingResolutions = new Map();
const pendingQuestionMsgIdMap = new Map();
let pendingCounter = 100;

const stats = {
  totalMessagesChecked: 0,
  totalOrdersSaved: 0,
  totalOrdersDeleted: 0,
  totalAmountSaved: 0
};

function addLog(msg) {
  const ts = new Date().toLocaleTimeString('en-US', {
    timeZone: 'Asia/Dhaka',
    hour12: true
  });
  const entry = `[${ts}] ${msg}`;
  console.log(entry);
  activityLogs.unshift(entry);
  if (activityLogs.length > 60) activityLogs.length = 60;
}

const sentMessagesCache = new Map();
let sendMsgMutex = Promise.resolve();

function cacheSentProtoMessage(sentObj, fallbackText = '') {
  if (!sentObj?.key?.id) return;
  const msgContent = sentObj.message || (fallbackText ? { conversation: fallbackText } : { conversation: 'CRP Bot' });
  sentMessagesCache.set(sentObj.key.id, msgContent);
  if (sentMessagesCache.size > 400) {
    const oldestKey = sentMessagesCache.keys().next().value;
    if (oldestKey) sentMessagesCache.delete(oldestKey);
  }
}

function safeSendMessage(jid, content, options = undefined) {
  const runSend = async () => {
    if (!sock || waStatus !== 'CONNECTED' || !jid) return null;
    try {
      if (typeof sock.assertSessions === 'function' && !jid.endsWith('@g.us')) {
        try {
          await sock.assertSessions([jid], false);
        } catch (e) {}
      }
      const sent = await sock.sendMessage(jid, content, options);
      if (sent?.key?.id) {
        cacheSentProtoMessage(sent, content?.text || '');
      }
      await sleep(220);
      return sent;
    } catch (err) {
      addLog(`⚠️ safeSendMessage warning (${jid}): ${err.message}`);
      return null;
    }
  };
  const p = sendMsgMutex.then(runSend, runSend);
  sendMsgMutex = p.catch(() => null);
  return p;
}

async function sendInteractivePromptToAdminAndOrigin(item, promptText) {
  if (item.originMsg?.key?.id) {
    pendingQuestionMsgIdMap.set(item.originMsg.key.id, item.token);
  }
  if (!sock || waStatus !== 'CONNECTED') {
    addLog(`⚠️ WhatsApp not connected for prompt [${item.token}]. Ready in Web Dashboard.`);
    return;
  }

  // STRICT ADMIN-ONLY DELIVERY: Never send unknown DA or wrong product prompts to any WhatsApp group or non-admin!
  const sentToJids = new Set();
  const adminPhones = getAdminAlertPhones();
  for (const ph of adminPhones) {
    const normPh = normalizeBdPhone(ph);
    if (!normPh) continue;
    const dmJid = `${normPh}@s.whatsapp.net`;
    if (sentToJids.has(dmJid)) continue;

    const sentDm = await safeSendMessage(dmJid, { text: promptText });
    if (sentDm?.key?.id) {
      pendingQuestionMsgIdMap.set(sentDm.key.id, item.token);
    }
    sentToJids.add(dmJid);
    addLog(`📲 Sent prompt [${item.token}] strictly to Admin DM +${normPh} (Group muted)`);
  }
}

function buildPromptTextForPendingItem(item) {
  const senderNumberLabel =
    (item.displayPhone && item.displayPhone !== '-' ? item.displayPhone : '') ||
    (item.senderPhone ? `+${normalizeBdPhone(item.senderPhone)}` : 'Unknown Number');
  const senderDisplay = `${senderNumberLabel}${item.senderPushName ? ` (${item.senderPushName})` : ''}`;
  const fullMsgBlock = (item.rawText || item.rawLine || '-').trim();

  if (!item.daInfo || !item.daInfo.isKnownDA) {
    item.type = 'UNKNOWN_DA';
    const recognizedPreview = (item.orders || []).map((o) => `${o.productName} (${o.orderedQty})`).join(', ');
    const unknownPreview = (item.unrecognizedItems || []).map((u) => `${u.unknownProductText} (${u.orderedQty})`).join(', ');
    const allPreview = [recognizedPreview, unknownPreview].filter(Boolean).join(', ') || 'Order';
    const detId = item.daInfo?.detectedDaId || item.detectedDaId;

    if (detId) {
      return (
        `❓ *নতুন/অপরিচিত DA ID শনাক্ত হয়েছে!* (${item.token})\n` +
        `📱 প্রেরকের নম্বর: *${senderDisplay}*\n` +
        `🆔 শনাক্তকৃত ID: *${detId}* (ডেটাবেসে নাম নেই)\n` +
        `🏪 ফার্মেসি: *${item.defaultPharmacy || 'General Party'}*\n` +
        `💊 অর্ডার: *${allPreview}*\n` +
        `📩 *সম্পূর্ণ মেসেজ:*\n\`\`\`\n${fullMsgBlock}\n\`\`\`\n\n` +
        `👉 এই মেসেজের *Reply*-তে (অথবা ওয়েবসাইট থেকে) প্রতিনিধির *নাম* (যেমন: \`${detId} নাম\`) লিখে পাঠান।\n` +
        `উত্তর দিলেই নাম ডেটাবেসে যোগ হবে এবং অর্ডারটি Google Sheet-এ সেভ হবে! (বাতিল করতে লিখুন \`/cnl\`)`
      );
    }
    return (
      `❓ *অর্ডারে কোনো পরিচিত DA ID বা নাম পাওয়া যায়নি!* (${item.token})\n` +
      `📱 প্রেরকের নম্বর: *${senderDisplay}*\n` +
      `🏪 ফার্মেসি: *${item.defaultPharmacy || 'General Party'}*\n` +
      `💊 অর্ডার: *${allPreview}*\n` +
      `📩 *সম্পূর্ণ মেসেজ:*\n\`\`\`\n${fullMsgBlock}\n\`\`\`\n\n` +
      `👉 এই অর্ডারটি কার নামে সেভ হবে? এই মেসেজের *Reply*-তে (অথবা ওয়েবসাইট থেকে) *ID এবং নাম* লিখে পাঠান (যেমন: \`CF4526 Seraj\` বা \`RF9084 Tofayel\`)।\n` +
      `উত্তর দিলেই এটি ডেটাবেসে ও Google Sheet-এ অটোমেটিক সেভ হয়ে যাবে! (বাতিল করতে লিখুন \`/cnl\`)`
    );
  }

  if (item.unrecognizedItems && item.unrecognizedItems.length > 0) {
    item.type = 'UNKNOWN_PRODUCT';
    const currentUnk = item.unrecognizedItems[0];
    item.unknownProductText = currentUnk.unknownProductText;
    item.orderedQty = currentUnk.orderedQty;
    item.rawLine = currentUnk.rawLine;

    const knownListStr = (item.orders || []).length > 0
      ? `✅ চেনা প্রোডাক্ট: *${item.orders.map((o) => `${o.productName} (${o.orderedQty})`).join(', ')}*\n`
      : '';

    return (
      `🤔 *অপরিচিত প্রোডাক্ট বা ভুল বানান পাওয়া গেছে!* (${item.token})\n` +
      `👤 প্রতিনিধি: *${item.daInfo.name}* (${item.daInfo.daId})\n` +
      `📱 প্রেরকের নম্বর: *${senderDisplay}*\n` +
      `🏪 ফার্মেসি: *${currentUnk.pharmacyName || item.defaultPharmacy || 'General Party'}*\n` +
      knownListStr +
      `📝 অপরিচিত লাইন: *"${currentUnk.rawLine}"*\n` +
      `❓ অপরিচিত বানান: *"${currentUnk.unknownProductText}"* | পরিমাণ: *${currentUnk.orderedQty}*\n` +
      `📩 *সম্পূর্ণ মেসেজ:*\n\`\`\`\n${fullMsgBlock}\n\`\`\`\n\n` +
      `👉 *"${currentUnk.unknownProductText}"* কোন প্রোডাক্ট? এই মেসেজের *Reply*-তে (অথবা ওয়েবসাইট থেকে) সঠিক প্রোডাক্টের *নাম বা কোড* পাঠান (যেমন: \`Totifen\` বা \`919\` বা \`Lucan R 200\`)।\n` +
      `💡 নতুন প্রোডাক্ট হলে লিখুন: \`NEW | কোড | নাম | দাম\`\n` +
      `❌ এই লাইনটি বাদ দিয়ে বাকি অর্ডার সেভ করতে লিখুন: \`skip\``
    );
  }

  return '';
}

async function createPendingOrderResolution({
  parsedResult,
  rawText = '',
  senderPhone = '',
  senderPushName = '',
  rawSenderId = '',
  originRemoteJid = '',
  originMsg = null,
  isImageOrder = false
}) {
  if (!parsedResult) return null;
  pendingCounter++;
  const token = `#ORD${pendingCounter}`;

  const firstPharmacy =
    parsedResult.orders?.[0]?.pharmacyName ||
    parsedResult.unrecognizedItems?.[0]?.pharmacyName ||
    'General Party';

  const pendingItem = {
    token,
    type: (!parsedResult.daInfo || !parsedResult.daInfo.isKnownDA) ? 'UNKNOWN_DA' : 'UNKNOWN_PRODUCT',
    createdAt: new Date().toISOString(),
    daInfo: parsedResult.daInfo || { daId: 'UNRESOLVED', altId: '-', name: 'Unknown DA', isKnownDA: false },
    detectedDaId: parsedResult.daInfo?.detectedDaId || null,
    orders: parsedResult.orders ? [...parsedResult.orders] : [],
    unrecognizedItems: parsedResult.unrecognizedItems ? [...parsedResult.unrecognizedItems] : [],
    unknownProductText: parsedResult.unrecognizedItems?.[0]?.unknownProductText || '',
    orderedQty: parsedResult.unrecognizedItems?.[0]?.orderedQty || 0,
    rawLine: parsedResult.unrecognizedItems?.[0]?.rawLine || '',
    defaultPharmacy: firstPharmacy,
    messageId: parsedResult.orders?.[0]?.whatsappMsgId || originMsg?.key?.id || `MSG_${Date.now()}`,
    whatsappMsgId: parsedResult.orders?.[0]?.whatsappMsgId || originMsg?.key?.id || `MSG_${Date.now()}`,
    dateStr: parsedResult.dateStr || new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' }),
    timeStr: parsedResult.timeStr || new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka' }),
    displayPhone: parsedResult.displayPhone || (senderPhone ? `+${normalizeBdPhone(senderPhone)}` : '-'),
    rawText: String(rawText || ''),
    senderPhone,
    senderPushName,
    rawSenderId,
    originRemoteJid,
    originMsg,
    isImageOrder
  };

  pendingResolutions.set(token, pendingItem);
  const promptText = buildPromptTextForPendingItem(pendingItem);
  if (promptText) {
    await sendInteractivePromptToAdminAndOrigin(pendingItem, promptText);
  }
  return pendingItem;
}

async function createPendingDaResolution(opts) {
  return createPendingOrderResolution({
    parsedResult: {
      daInfo: {
        daId: opts.detectedDaId || 'UNRESOLVED',
        name: 'Unknown DA',
        isKnownDA: false,
        detectedDaId: opts.detectedDaId || null
      },
      orders: opts.orders || [],
      unrecognizedItems: [],
      dateStr: opts.orders?.[0]?.date,
      timeStr: opts.orders?.[0]?.time,
      displayPhone: opts.orders?.[0]?.senderPhone
    },
    rawText: opts.rawText || '',
    senderPhone: opts.senderPhone || '',
    senderPushName: opts.senderPushName || '',
    originRemoteJid: opts.originRemoteJid || '',
    originMsg: opts.originMsgKey ? { key: opts.originMsgKey } : null,
    isImageOrder: Boolean(opts.isImageOrder)
  });
}

async function createPendingProductResolution(opts) {
  return createPendingOrderResolution({
    parsedResult: {
      daInfo: opts.daInfo ? { ...opts.daInfo, isKnownDA: true } : { daId: 'UNKNOWN', name: 'Unknown DA', isKnownDA: true },
      orders: [],
      unrecognizedItems: opts.unknownItem ? [opts.unknownItem] : [],
      dateStr: opts.dateStr,
      timeStr: opts.timeStr,
      displayPhone: opts.displayPhone
    },
    originRemoteJid: opts.originRemoteJid || ''
  });
}

async function finalizeAndSavePendingOrder(item, learnedSummaryLines = []) {
  pendingResolutions.delete(item.token);

  const finalOrders = (item.orders || []).map((o, idx) => ({
    ...o,
    orderLineId: `${item.whatsappMsgId}_${idx + 1}`,
    whatsappMsgId: item.whatsappMsgId,
    daId: item.daInfo.daId,
    altId: item.daInfo.altId || '-',
    daName: item.daInfo.name,
    senderPhone:
      item.daInfo.phones && item.daInfo.phones.length > 0
        ? `+${item.daInfo.phones[0]}`
        : (o.senderPhone || item.displayPhone || '-')
  }));

  if (finalOrders.length === 0) {
    return {
      ok: true,
      message: `🗑️ *${item.token}* অর্ডারে কোনো বৈধ প্রোডাক্ট না থাকায় Google Sheet-এ সেভ করা হয়নি।`
    };
  }

  await appendOrdersToSheet(finalOrders);

  cancellableOrderMap.set(item.whatsappMsgId, item.whatsappMsgId);
  if (item.rawSenderId) lastOrderBySenderMap.set(item.rawSenderId, item.whatsappMsgId);
  if (item.senderPhone) lastOrderBySenderMap.set(item.senderPhone, item.whatsappMsgId);

  const totalAmt = finalOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const itemsLines = finalOrders.map(
    (o, i) => `${i + 1}. *${o.productName}* — ${o.orderedQty} × ৳${Number(o.unitPrice).toFixed(2)} = *৳${Number(o.totalAmount).toFixed(2)}*`
  );

  const confirmMsg =
    `✅ *ডেটাবেস আপডেট ও অর্ডারটি Google Sheet-এ সেভ হয়েছে!*\n` +
    (learnedSummaryLines.length > 0 ? learnedSummaryLines.join('\n') + '\n' : '') +
    `👤 *DA:* [${item.daInfo.daId}] ${item.daInfo.name}\n` +
    `🏥 *Party:* ${finalOrders[0].pharmacyName} (PSO: ${finalOrders[0].psoCode})\n\n` +
    `📦 *সেভ হওয়া অর্ডার:*\n` +
    itemsLines.join('\n') +
    `\n\n💰 *সর্বমোট:* *৳${totalAmt.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n` +
    `❌ _বাতিল করতে এই মেসেজের Reply-তে লিখুন:_ */cnl*`;

  return {
    ok: true,
    finalOrders,
    message: confirmMsg
  };
}

async function resolvePendingItemWithAnswer(token, rawAnswerText) {
  const item = pendingResolutions.get(token);
  if (!item) {
    return { ok: false, message: `⚠️ টোকেন ${token} খুঁজে পাওয়া যায়নি বা আগেই সমাধান হয়েছে।` };
  }

  const answer = String(rawAnswerText || '').trim();
  if (!answer) {
    return { ok: false, message: '⚠️ উত্তর খালি রাখা যাবে না।' };
  }

  if (/^(\/?cnl|cancel|বাতিল)$/i.test(answer)) {
    pendingResolutions.delete(token);
    addLog(`🗑️ Pending order ${token} cancelled by Admin.`);
    return { ok: true, cancelled: true, message: `❌ *${token}* অর্ডারটি বাতিল করা হয়েছে (Google Sheet-এ যোগ করা হয়নি)।` };
  }

  if (!item.learnedLogs) item.learnedLogs = [];

  if (!item.daInfo || !item.daInfo.isKnownDA) {
    let resolvedDA = null;

    const idMatch = answer.toUpperCase().match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b/);
    if (idMatch) {
      const candidateId = `${idMatch[1]}${idMatch[2]}`;
      const existingById = activeDAs.find(
        (d) => d.daId.toUpperCase() === candidateId || (d.altId && d.altId.toUpperCase() === candidateId)
      );
      const remainingName = answer
        .replace(/\b(CF|RF|C)\s*[\-_.]?\s*\d{4,6}\b/i, '')
        .replace(/^[\s\-:=,|]+|[\s\-:=,|]+$/g, '')
        .trim();

      if (existingById) {
        if (remainingName && remainingName.length >= 2) {
          existingById.name = remainingName;
          if (!existingById.aliases.includes(remainingName.toLowerCase())) {
            existingById.aliases.push(remainingName.toLowerCase());
          }
          saveLocalMasterDb();
          scheduleCloudStateBackup(2000);
        }
        resolvedDA = existingById;
      } else {
        const finalName = remainingName || `DA ${candidateId}`;
        resolvedDA = {
          daId: candidateId,
          altId: '',
          name: finalName,
          phones: [],
          aliases: [finalName.toLowerCase(), candidateId.toLowerCase()]
        };
        masterDb.das.push(resolvedDA);
        saveLocalMasterDb();
        scheduleCloudStateBackup(2000);
      }
    } else {
      const lowerAns = answer.toLowerCase();
      const existingByName = activeDAs.find(
        (d) =>
          d.name.toLowerCase() === lowerAns ||
          d.name.toLowerCase().includes(lowerAns) ||
          (d.aliases && d.aliases.some((a) => a.toLowerCase() === lowerAns))
      );

      const detId = item.daInfo?.detectedDaId || item.detectedDaId;
      if (existingByName && !detId) {
        resolvedDA = existingByName;
      } else {
        const finalId = detId || `CF${Math.floor(10000 + Math.random() * 89999)}`;
        resolvedDA = {
          daId: finalId,
          altId: '',
          name: answer,
          phones: (!item.isImageOrder && item.senderPhone && !getAuthorizedImagePhones().includes(normalizeBdPhone(item.senderPhone)))
            ? [normalizeBdPhone(item.senderPhone)]
            : [],
          aliases: [answer.toLowerCase(), finalId.toLowerCase()]
        };
        masterDb.das.push(resolvedDA);
        saveLocalMasterDb();
        scheduleCloudStateBackup(2000);
      }
    }

    item.daInfo = { ...resolvedDA, isKnownDA: true };
    for (const o of item.orders || []) {
      o.daId = resolvedDA.daId;
      o.altId = resolvedDA.altId || '-';
      o.daName = resolvedDA.name;
    }
    item.learnedLogs.push(`👤 প্রতিনিধি সেভ: *[${resolvedDA.daId}] ${resolvedDA.name}*`);
    addLog(`🧠 Admin resolved DA for ${token} -> [${resolvedDA.daId}] ${resolvedDA.name}`);

    if (item.unrecognizedItems && item.unrecognizedItems.length > 0) {
      const nextPrompt = buildPromptTextForPendingItem(item);
      return {
        ok: true,
        needsMoreInput: true,
        nextPromptToken: item.token,
        message: `✅ প্রতিনিধি *[${resolvedDA.daId}] ${resolvedDA.name}* ডেটাবেসে সেভ হয়েছে!\n\nএবার নিচের অপরিচিত প্রোডাক্টটির নাম কনফার্ম করুন:\n\n${nextPrompt}`
      };
    }

    return await finalizeAndSavePendingOrder(item, item.learnedLogs);
  }

  if (item.unrecognizedItems && item.unrecognizedItems.length > 0) {
    const currentUnk = item.unrecognizedItems[0];

    if (/^(skip|bad|বাদ|no|na)$/i.test(answer)) {
      item.unrecognizedItems.shift();
      item.learnedLogs.push(`⏭️ বাদ দেওয়া হয়েছে: *"${currentUnk.rawLine}"*`);
      if (item.unrecognizedItems.length > 0) {
        const nextPrompt = buildPromptTextForPendingItem(item);
        return {
          ok: true,
          needsMoreInput: true,
          nextPromptToken: item.token,
          message: `⏭️ *"${currentUnk.unknownProductText}"* বাদ দেওয়া হয়েছে।\n\nএবার পরের প্রোডাক্টটি কনফার্ম করুন:\n\n${nextPrompt}`
        };
      }
      return await finalizeAndSavePendingOrder(item, item.learnedLogs);
    }

    let matchedProd = null;
    if (/^new\s*\|/i.test(answer)) {
      const parts = answer.split('|').map((s) => s.trim());
      if (parts.length >= 4) {
        const newCode = parts[1].toUpperCase();
        const newName = parts[2].toUpperCase();
        const newPrice = parseFloat(parts[3]) || 0;
        const newUnit = parts[4] || "Box/Bottle";
        if (newCode && newName && newPrice > 0) {
          matchedProd = {
            code: newCode,
            name: newName,
            unit: newUnit,
            price: newPrice,
            family: newName.split(/\s+/)[0],
            aliases: [newName.toLowerCase(), currentUnk.unknownProductText.toLowerCase()]
          };
          masterDb.products.push(matchedProd);
          saveLocalMasterDb();
          scheduleCloudStateBackup(2000);
        }
      }
    }

    if (!matchedProd) {
      const byExactCode = activeProducts.find(
        (p) => String(p.code).toUpperCase() === answer.toUpperCase()
      );
      if (byExactCode) {
        matchedProd = byExactCode;
      } else {
        const mRes = matchCRPProduct(answer);
        if (mRes && mRes.product) {
          matchedProd = mRes.product;
        }
      }
    }

    if (!matchedProd) {
      return {
        ok: false,
        needsMoreInput: true,
        nextPromptToken: item.token,
        message:
          `⚠️ *"${answer}"* দিয়ে কোনো প্রোডাক্ট খুঁজে পাওয়া যায়নি।\n` +
          `সঠিক প্রোডাক্টের কোড (যেমন \`919\`) বা নাম (যেমন \`Totifen\` বা \`Lucan R 200\`) লিখুন, অথবা নতুন প্রোডাক্ট যোগ করতে লিখুন:\n` +
          `\`NEW | কোড | নাম | দাম\``
      };
    }

    const learnedAlias = currentUnk.unknownProductText.toLowerCase().trim();
    if (!matchedProd.aliases) matchedProd.aliases = [];
    if (learnedAlias && !isAccidentalPsoAlias(learnedAlias) && !matchedProd.aliases.includes(learnedAlias)) {
      matchedProd.aliases.push(learnedAlias);
    }
    syncProductWithBrandGroup(matchedProd, learnedAlias);
    saveLocalMasterDb();
    scheduleCloudStateBackup(2000);

    const totalAmount = Number((currentUnk.orderedQty * matchedProd.price).toFixed(2));
    item.orders.push({
      orderLineId: `${item.whatsappMsgId}_${item.orders.length + 1}`,
      whatsappMsgId: item.whatsappMsgId,
      date: item.dateStr,
      time: item.timeStr,
      daId: item.daInfo.daId,
      altId: item.daInfo.altId || '-',
      daName: item.daInfo.name,
      senderPhone: item.displayPhone || '-',
      psoCode: currentUnk.psoCode || '-',
      pharmacyName: currentUnk.pharmacyName || item.defaultPharmacy || 'General Party',
      rawText: currentUnk.rawLine,
      crpCode: matchedProd.code,
      productName: matchedProd.name,
      packUnit: matchedProd.unit,
      orderedQty: currentUnk.orderedQty,
      unitPrice: matchedProd.price,
      totalAmount,
      matchType: 'AI-Learned',
      status: 'ACTIVE'
    });

    item.learnedLogs.push(`🧠 নতুন বানান সেভ: *"${currentUnk.unknownProductText}"* ➔ *[${matchedProd.code}] ${matchedProd.name}*`);
    item.unrecognizedItems.shift();

    addLog(
      `🧠 Self-Learned Alias: "${learnedAlias}" -> [${matchedProd.code}] ${matchedProd.name} (${currentUnk.orderedQty} pcs = ৳${totalAmount})`
    );

    if (item.unrecognizedItems.length > 0) {
      const nextPrompt = buildPromptTextForPendingItem(item);
      return {
        ok: true,
        needsMoreInput: true,
        nextPromptToken: item.token,
        message: `✅ *"${currentUnk.unknownProductText}"* ➔ *${matchedProd.name}* সেভ হয়েছে!\n\nএবার পরের অপরিচিত প্রোডাক্টটির নাম দিন:\n\n${nextPrompt}`
      };
    }

    return await finalizeAndSavePendingOrder(item, item.learnedLogs);
  }

  return { ok: false, message: '⚠️ Unknown resolution state.' };
}

function isAllowedTargetGroup(remoteJid) {
  if (!remoteJid || !remoteJid.endsWith('@g.us')) return false;
  syncTargetGroupFromMasterDbToBotConfig();
  const cfgId = (botConfig.targetGroupId || masterDb.targetGroup?.targetGroupId || '').trim();
  const cfgName = (botConfig.targetGroupName || masterDb.targetGroup?.targetGroupName || '').trim().toLowerCase();

  if ((!cfgId || cfgId === 'ALL') && (!cfgName || cfgName.includes('all joined groups'))) {
    return true;
  }
  if (cfgId && cfgId !== 'ALL' && remoteJid === cfgId) {
    return true;
  }
  if (cfgName) {
    const foundGroup = joinedGroups.find((g) => g.id === remoteJid);
    if (foundGroup) {
      const subj = (foundGroup.subject || '').trim().toLowerCase();
      if (subj === cfgName || subj.includes(cfgName) || cfgName.includes(subj)) {
        return true;
      }
    }
  }
  return false;
}

function unwrapBaileysMessageContainer(m) {
  if (!m) return null;
  if (m.deviceSentMessage?.message) return unwrapBaileysMessageContainer(m.deviceSentMessage.message);
  if (m.ephemeralMessage?.message) return unwrapBaileysMessageContainer(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return unwrapBaileysMessageContainer(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return unwrapBaileysMessageContainer(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage?.message) return unwrapBaileysMessageContainer(m.documentWithCaptionMessage.message);
  return m;
}

function inspectBaileysMessage(msg) {
  if (!msg || !msg.message) return { type: 'IGNORE' };

  const rawM = msg.message;
  const m = unwrapBaileysMessageContainer(rawM) || rawM;

  const proto =
    m.protocolMessage ||
    rawM.protocolMessage ||
    rawM.ephemeralMessage?.message?.protocolMessage;

  if (proto && (proto.type === 0 || proto.type === 'REVOKE') && proto.key?.id) {
    return {
      type: 'REVOKE',
      targetMsgId: proto.key.id,
      remoteJid: msg.key.remoteJid
    };
  }

  const editedObj =
    m.editedMessage?.message?.protocolMessage ||
    m.protocolMessage?.editedMessage ||
    (proto && (proto.type === 14 || proto.type === 'MESSAGE_EDIT') ? proto : null);

  if (editedObj) {
    const innerEdited = editedObj.editedMessage || m.editedMessage?.message;
    const targetId = editedObj.key?.id || proto?.key?.id || msg.key.id;
    const editedText =
      innerEdited?.conversation ||
      innerEdited?.extendedTextMessage?.text ||
      innerEdited?.protocolMessage?.editedMessage?.conversation ||
      innerEdited?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
      '';
    if (editedText && targetId) {
      return {
        type: 'EDIT',
        targetMsgId: targetId,
        text: editedText,
        remoteJid: msg.key.remoteJid
      };
    }
  }

  const imgMsg =
    m.imageMessage ||
    (m.documentMessage && String(m.documentMessage.mimetype || '').startsWith('image/')
      ? m.documentMessage
      : null);

  if (imgMsg) {
    return {
      type: 'IMAGE',
      msgId: msg.key.id,
      caption: (imgMsg.caption || '').trim(),
      mimeType: imgMsg.mimetype || 'image/jpeg',
      remoteJid: msg.key.remoteJid,
      rawMsg: msg
    };
  }

  const extMsg = m.extendedTextMessage;
  const text =
    m.conversation ||
    extMsg?.text ||
    '';

  const ctxInfo = extMsg?.contextInfo || m.contextInfo || null;
  const quotedMsgId = ctxInfo?.stanzaId || null;
  const qMsg = unwrapBaileysMessageContainer(ctxInfo?.quotedMessage) || ctxInfo?.quotedMessage;
  const quotedText =
    qMsg?.conversation ||
    qMsg?.extendedTextMessage?.text ||
    qMsg?.imageMessage?.caption ||
    '';

  if (text.trim()) {
    return {
      type: 'TEXT',
      msgId: msg.key.id,
      text: text.trim(),
      quotedMsgId,
      quotedText: quotedText.trim(),
      remoteJid: msg.key.remoteJid
    };
  }

  return { type: 'IGNORE' };
}

function harvestLidMappingsFromGroups(groupsList) {
  const allWatchedPhones = Array.from(new Set([...getAuthorizedImagePhones(), ...getAdminAlertPhones()]));
  for (const g of groupsList || []) {
    for (const p of g.participants || []) {
      const ids = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean);
      let lidPart = null;
      let phonePart = null;
      for (const item of ids) {
        const s = String(item);
        if (s.endsWith('@lid')) {
          lidPart = s.split('@')[0].split(':')[0];
        } else if (s.endsWith('@s.whatsapp.net')) {
          const norm = normalizeBdPhone(s.split('@')[0].split(':')[0]);
          if (norm.startsWith('8801')) phonePart = norm;
        }
      }
      if (lidPart && phonePart) {
        lidToPhoneMap.set(lidPart, phonePart);
        if (allWatchedPhones.includes(phonePart)) {
          if (!botConfig.authorizedImageLids) botConfig.authorizedImageLids = [];
          if (!botConfig.authorizedImageLids.includes(lidPart)) {
            botConfig.authorizedImageLids.push(lidPart);
          }
        }
      }
    }
  }
}

async function refreshJoinedGroups() {
  if (!sock || waStatus !== 'CONNECTED') return [];
  try {
    const groupsObj = await sock.groupFetchAllParticipating();
    const rawGroups = Object.values(groupsObj);
    harvestLidMappingsFromGroups(rawGroups);

    joinedGroups = rawGroups
      .map((g) => ({
        id: g.id,
        subject: g.subject || 'Unnamed Group',
        size: (g.participants || []).length
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));

    syncTargetGroupFromMasterDbToBotConfig();

    if (botConfig.targetGroupId && botConfig.targetGroupId !== 'ALL') {
      const exactIdMatch = joinedGroups.find((g) => g.id === botConfig.targetGroupId);
      if (exactIdMatch) {
        if (botConfig.targetGroupName !== exactIdMatch.subject) {
          saveTargetGroupToMasterDb(exactIdMatch.id, exactIdMatch.subject, botConfig.autoReactOnOrder);
        }
        return joinedGroups;
      }
    }

    if (botConfig.targetGroupName && botConfig.targetGroupId !== 'ALL') {
      const autoFound = joinedGroups.find(
        (g) =>
          g.subject.toLowerCase().trim() === botConfig.targetGroupName.toLowerCase().trim() ||
          g.subject.toLowerCase().includes(botConfig.targetGroupName.toLowerCase().trim())
      );
      if (autoFound && botConfig.targetGroupId !== autoFound.id) {
        saveTargetGroupToMasterDb(autoFound.id, autoFound.subject, botConfig.autoReactOnOrder);
        scheduleCloudStateBackup(2000);
        addLog(`🎯 Synced target WhatsApp group in master_db.json: "${autoFound.subject}" (${autoFound.id})`);
      }
    }
    return joinedGroups;
  } catch (err) {
    addLog(`⚠️ Could not fetch group list: ${err.message}`);
    return joinedGroups;
  }
}

async function autoBindAuthorizedImagePhones() {
  if (!sock || waStatus !== 'CONNECTED') return;
  try {
    const phonesToBind = Array.from(new Set([...getAuthorizedImagePhones(), ...getAdminAlertPhones()]));
    if (typeof sock.onWhatsApp === 'function' && phonesToBind.length > 0) {
      const results = await sock.onWhatsApp(...phonesToBind);
      for (const r of results || []) {
        const phoneNorm = normalizeBdPhone((r.jid || '').split('@')[0].split(':')[0]);
        const lidClean = (r.lid || '').split('@')[0].split(':')[0];
        if (lidClean && phoneNorm) {
          lidToPhoneMap.set(lidClean, phoneNorm);
          if (!botConfig.authorizedImageLids) botConfig.authorizedImageLids = [];
          if (!botConfig.authorizedImageLids.includes(lidClean)) {
            botConfig.authorizedImageLids.push(lidClean);
            addLog(`🔐 Auto-bound phone +${phoneNorm} -> LID ${lidClean}`);
          }
        }
      }
    }
  } catch (e) {}
}

async function startWhatsApp() {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    let version = [2, 3000, 1015901307];
    try {
      const vRes = await fetchLatestBaileysVersion();
      if (vRes && vRes.version) version = vRes.version;
    } catch (e) {}

    if (sock) {
      try {
        sock.ev.removeAllListeners();
        if (sock.ws && typeof sock.ws.close === 'function') {
          sock.ws.close();
        }
      } catch (e) {}
    }

    waStatus = 'CONNECTING';
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Renata CRP Order Tracker'),
      keepAliveIntervalMs: 20000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 1500,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        if (key?.id && sentMessagesCache.has(key.id)) {
          return sentMessagesCache.get(key.id);
        }
        return { conversation: 'CRP Order Bot Message' };
      }
    });

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      scheduleCloudStateBackup(6000);
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts || []) {
        if (c.lid && c.id && c.id.endsWith('@s.whatsapp.net')) {
          const lid = c.lid.split('@')[0].split(':')[0];
          const ph = normalizeBdPhone(c.id.split('@')[0].split(':')[0]);
          if (ph.startsWith('8801')) lidToPhoneMap.set(lid, ph);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        waStatus = 'QR_READY';
        currentQrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        addLog('📲 New WhatsApp QR Code generated. Scan it from the Web Dashboard.');
      }

      if (connection === 'open') {
        isReconnectingWhatsApp = false;
        waStatus = 'CONNECTED';
        currentQrDataUrl = null;
        connectedUser = {
          id: sock.user?.id || '',
          name: sock.user?.name || 'WhatsApp User',
          lid: sock.user?.lid || ''
        };
        if (connectedUser.lid && connectedUser.id) {
          const botLid = connectedUser.lid.split('@')[0].split(':')[0];
          const botPh = normalizeBdPhone(connectedUser.id.split('@')[0].split(':')[0]);
          if (botPh.startsWith('8801')) lidToPhoneMap.set(botLid, botPh);
        }

        syncTargetGroupFromMasterDbToBotConfig();
        await syncExistingSheetMessageIds();

        addLog(
          `🟢 WhatsApp Connected as ${connectedUser.name} (${connectedUser.id}) | Target Group: "${botConfig.targetGroupName}" | Last 5 Msg IDs in JSON: [${(masterDb.lastProcessedMsgIds || []).join(', ') || 'None'}]`
        );

        if (typeof sock.uploadPreKeysToServerIfRequired === 'function') {
          try {
            await sock.uploadPreKeysToServerIfRequired();
          } catch (e) {}
        }

        await autoBindAuthorizedImagePhones();
        await refreshJoinedGroups();
        syncTargetGroupFromMasterDbToBotConfig();
        scheduleCloudStateBackup(3000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        addLog(`🔴 WhatsApp connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        syncTargetGroupFromMasterDbToBotConfig();

        if (statusCode === DisconnectReason.loggedOut) {
          isReconnectingWhatsApp = false;
          waStatus = 'DISCONNECTED';
          connectedUser = null;
          currentQrDataUrl = null;
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (e) {}
          setTimeout(() => startWhatsApp(), 3000);
        } else if (shouldReconnect && !isReconnectingWhatsApp) {
          isReconnectingWhatsApp = true;
          waStatus = 'CONNECTING';
          const reconnectDelay = (statusCode === 428 || statusCode === 503) ? 1500 : 3000;
          setTimeout(() => {
            isReconnectingWhatsApp = false;
            startWhatsApp();
          }, reconnectDelay);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        try {
          const remoteJid = msg.key?.remoteJid || '';
          if (!remoteJid || remoteJid === 'status@broadcast') continue;

          const isGroup = remoteJid.endsWith('@g.us');
          const inspected = inspectBaileysMessage(msg);
          if (inspected.type === 'IGNORE') continue;

          const senderJid = msg.key.participant || msg.participant || remoteJid;
          const rawSenderId = senderJid.split('@')[0].split(':')[0];
          let senderPhone = resolveRealSenderPhone(msg);
          const senderPushName = msg.pushName || '';
          const msgTimestamp = msg.messageTimestamp
            ? Number(msg.messageTimestamp) * 1000
            : Date.now();

          const textOrCaption = (inspected.text || inspected.caption || '').trim();

          if (
            textOrCaption.includes('নতুন/অপরিচিত DA ID শনাক্ত হয়েছে!') ||
            textOrCaption.includes('অর্ডারে কোনো পরিচিত DA ID বা নাম পাওয়া যায়নি!') ||
            textOrCaption.includes('অপরিচিত প্রোডাক্ট বা ভুল বানান পাওয়া গেছে!') ||
            textOrCaption.includes('ডেটাবেস আপডেট ও অর্ডারটি Google Sheet-এ সেভ হয়েছে!') ||
            textOrCaption.includes('ডেটাবেস আপডেট ও অর্ডার সেভ হয়েছে!') ||
            textOrCaption.includes('ছবি থেকে অর্ডারটি Google Sheet-এ সেভ হয়েছে!') ||
            textOrCaption.includes('অর্ডারটি বাতিল (/cnl) করা হয়েছে!') ||
            textOrCaption.includes('ছবিটি ৩ বার অটো-রিচেক') ||
            textOrCaption.includes('ছবিটি ৫টি ভিন্ন পদ্ধতিতে') ||
            textOrCaption.includes('নতুন প্রতিনিধি অটো-যুক্ত হয়েছে!') ||
            textOrCaption.includes('প্রোডাক্ট খুঁজে পাওয়া যায়নি।')
          ) {
            continue;
          }

          const bindMatch = textOrCaption.match(/^\/?bind(?:\s+([\+\d\-\s]{10,18}))?$/i);
          if (bindMatch) {
            const allowedList = getAuthorizedImagePhones();
            const targetPh = bindMatch[1]
              ? normalizeBdPhone(bindMatch[1])
              : (allowedList[0] || '8801793362829');
            if (!masterDb.authorizedImagePhones.includes(targetPh)) {
              masterDb.authorizedImagePhones.push(targetPh);
            }
            lidToPhoneMap.set(rawSenderId, targetPh);
            if (!botConfig.authorizedImageLids) botConfig.authorizedImageLids = [];
            if (!botConfig.authorizedImageLids.includes(rawSenderId)) {
              botConfig.authorizedImageLids.push(rawSenderId);
            }
            saveLocalConfig();
            saveLocalMasterDb();
            scheduleCloudStateBackup(2000);
            addLog(`🔗 Bound sender ID ${rawSenderId} to authorized phone +${targetPh}`);
            if (sock) {
              try {
                await sock.sendMessage(
                  remoteJid,
                  { text: `✅ আপনার অ্যাকাউন্টটি (+${targetPh}, ID: ${rawSenderId}) স্থায়ীভাবে যুক্ত হয়েছে!` },
                  { quoted: msg }
                );
              } catch (e) {}
            }
            continue;
          }

          if (inspected.type === 'TEXT' && pendingResolutions.size > 0) {
            let matchedToken = null;
            let answerBody = inspected.text.trim();

            if (inspected.quotedMsgId && pendingQuestionMsgIdMap.has(inspected.quotedMsgId)) {
              const candidateTok = pendingQuestionMsgIdMap.get(inspected.quotedMsgId);
              if (pendingResolutions.has(candidateTok)) {
                matchedToken = candidateTok;
              }
            }

            if (!matchedToken && inspected.quotedText) {
              const qTokenMatch = inspected.quotedText.match(/#(?:ORD|DA|PR)\d+/i);
              if (qTokenMatch) {
                const candidateTok = qTokenMatch[0].toUpperCase();
                if (pendingResolutions.has(candidateTok)) {
                  matchedToken = candidateTok;
                }
              }
            }

            if (!matchedToken) {
              const prefixMatch = answerBody.match(/^#?((?:ORD|DA|PR)\d+)\s+([\s\S]+)$/i);
              if (prefixMatch) {
                const candidateTok = '#' + prefixMatch[1].toUpperCase();
                if (pendingResolutions.has(candidateTok)) {
                  matchedToken = candidateTok;
                  answerBody = prefixMatch[2].trim();
                }
              }
            }

            if (!matchedToken) {
              const allPending = Array.from(pendingResolutions.values());
              const latestPending = allPending[allPending.length - 1];
              const isSingleLineReply = !answerBody.includes('\n') && answerBody.length <= 65;

              if (!isGroup && isSingleLineReply) {
                const primaryAdmin = getAdminAlertPhones()[0] || '8801793362829';
                if (!senderPhone.startsWith('8801')) {
                  lidToPhoneMap.set(rawSenderId, primaryAdmin);
                  senderPhone = primaryAdmin;
                }
                matchedToken = latestPending.token;
              } else if (
                isGroup &&
                isSingleLineReply &&
                (isAdminAlertSender(msg, senderPhone) || rawSenderId === latestPending.rawSenderId)
              ) {
                const hasTrailingOrderQty = /[\-:=]\s*\d+\s*(?:ta|pes|pcs|pc|p|box|bx)?$/i.test(answerBody) || /\b\d+\s*(?:ta|pes|pcs|pc|box|bx)$/i.test(answerBody);
                if (!hasTrailingOrderQty) {
                  matchedToken = latestPending.token;
                }
              }
            }

            if (matchedToken && pendingResolutions.has(matchedToken)) {
              const pItem = pendingResolutions.get(matchedToken);
              addLog(`💬 Received reply for [${matchedToken}] from +${senderPhone || rawSenderId}: "${answerBody}"`);
              const resOut = await resolvePendingItemWithAnswer(matchedToken, answerBody);

              if (sock && resOut?.message) {
                try {
                  // Only reply directly in private Admin DM — NEVER post resolution messages in any WhatsApp group!
                  const replyTargetJid = remoteJid.endsWith('@g.us')
                    ? `${normalizeBdPhone(getAdminAlertPhones()[0] || '8801793362829')}@s.whatsapp.net`
                    : remoteJid;
                  const sentConfirm = await safeSendMessage(
                    replyTargetJid,
                    { text: resOut.message },
                    !remoteJid.endsWith('@g.us') ? { quoted: msg } : undefined
                  );
                  if (sentConfirm?.key?.id) {
                    if (resOut.needsMoreInput && resOut.nextPromptToken) {
                      pendingQuestionMsgIdMap.set(sentConfirm.key.id, resOut.nextPromptToken);
                    } else if (pItem?.whatsappMsgId) {
                      cancellableOrderMap.set(sentConfirm.key.id, pItem.whatsappMsgId);
                    }
                  }
                  // Silently react ✅ on the original group message when saved (no text sent to the group)
                  if (!resOut.needsMoreInput && resOut.ok && botConfig.autoReactOnOrder && pItem?.originRemoteJid && pItem?.originMsg?.key) {
                    try {
                      await sock.sendMessage(pItem.originRemoteJid, {
                        react: { text: '✅', key: pItem.originMsg.key }
                      });
                    } catch (e) {}
                  }
                } catch (e) {}
              }
              continue;
            }
          }

          if (isGroup && !isAllowedTargetGroup(remoteJid)) {
            if (!(inspected.type === 'IMAGE' && isAuthorizedForImageOrder(msg, senderPhone))) {
              continue;
            }
          }

          if (isGroup && (inspected.type === 'TEXT' || inspected.type === 'IMAGE')) {
            const isCnlCmd = inspected.type === 'TEXT' && /^\/?cnl\b/i.test(inspected.text.trim());
            if (!isCnlCmd && inspected.msgId && isMessageAlreadyProcessed(inspected.msgId)) {
              continue;
            }
            if (type === 'append') {
              if (Date.now() - msgTimestamp > 24 * 60 * 60 * 1000) {
                continue;
              }
              addLog(`🔄 Reconnect Sync: Checking missed group message (${inspected.msgId}) against saved JSON IDs...`);
            }
          }

          if (inspected.type === 'REVOKE') {
            addLog(`🚨 Unsend/Delete detected for Msg ID: ${inspected.targetMsgId}`);
            await removeOrdersByMessageId(inspected.targetMsgId, 'UNSENT_BY_USER');
            continue;
          }

          if (inspected.type === 'EDIT') {
            addLog(`✏️ Message Edit detected for Msg ID: ${inspected.targetMsgId}`);
            await removeOrdersByMessageId(inspected.targetMsgId, 'REPLACED_BY_EDIT');
            const parsedEdit = parseWhatsAppOrderMessage({
              messageText: inspected.text,
              messageId: inspected.targetMsgId,
              timestamp: msgTimestamp,
              senderPhone,
              senderPushName,
              senderJid,
              isImageOrder: false
            });
            if ((parsedEdit.orders && parsedEdit.orders.length > 0) || (parsedEdit.unrecognizedItems && parsedEdit.unrecognizedItems.length > 0)) {
              const needsHold = (parsedEdit.daInfo && !parsedEdit.daInfo.isKnownDA) || (parsedEdit.unrecognizedItems && parsedEdit.unrecognizedItems.length > 0);
              if (needsHold) {
                await createPendingOrderResolution({
                  parsedResult: parsedEdit,
                  rawText: inspected.text,
                  senderPhone,
                  senderPushName,
                  rawSenderId,
                  originRemoteJid: remoteJid,
                  originMsg: msg,
                  isImageOrder: false
                });
              } else {
                await appendOrdersToSheet(parsedEdit.orders);
              }
            }
            continue;
          }

          if (inspected.type === 'IMAGE') {
            if (!senderPhone.startsWith('8801') && isGroup && sock) {
              try {
                const gMeta = await sock.groupMetadata(remoteJid);
                harvestLidMappingsFromGroups([gMeta]);
                senderPhone = resolveRealSenderPhone(msg);
              } catch (e) {}
            }

            if (!isAuthorizedForImageOrder(msg, senderPhone)) {
              addLog(
                `⛔ Ignored image from unauthorized sender (ID: ${rawSenderId}, Phone: ${senderPhone || 'Unknown'}, Name: ${senderPushName}).`
              );
              continue;
            }

            recordProcessedGroupMessageId(inspected.msgId, msgTimestamp);
            addLog(`📥 Image received from +${senderPhone || rawSenderId}. Saved Msg ID (${inspected.msgId}) to master_db.json & added to Sequential Image Queue (Queue size: ${pendingImageQueueCount + 1})...`);
            if (sock) {
              try {
                await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
              } catch (e) {}
            }

            const preDownloadedBufferPromise = downloadImageBufferWithRetry(msg).catch((e) => {
              addLog(`⚠️ Initial media pre-fetch warning (${inspected.msgId}): ${e.message}`);
              return null;
            });

            enqueueImageOrderTask(async () => {
              addLog(`📸 Processing queued image (${inspected.msgId}) via 5-Method Rate-Limit-Proof Pipeline...`);
              let imageBuffer = await preDownloadedBufferPromise;
              if (!imageBuffer) {
                try {
                  imageBuffer = await downloadImageBufferWithRetry(msg);
                } catch (dlErr) {
                  addLog(`❌ Failed to download image media after retries: ${dlErr.message}`);
                  return;
                }
              }

              const ocrPipelineResult = await processImageOrderWithThreeRetries({
                imageBuffer,
                mimeType: inspected.mimeType,
                caption: inspected.caption,
                messageId: inspected.msgId,
                timestamp: msgTimestamp,
                senderPhone,
                senderPushName,
                senderJid
              });
              imageBuffer = null;

              const parsedImg = ocrPipelineResult.parsed;

              if (ocrPipelineResult.ok && parsedImg && ((parsedImg.orders && parsedImg.orders.length > 0) || (parsedImg.unrecognizedItems && parsedImg.unrecognizedItems.length > 0))) {
                const orders = parsedImg.orders || [];
                const unrecognized = parsedImg.unrecognizedItems || [];
                const daInfo = parsedImg.daInfo;

                const needsHold = (daInfo && !daInfo.isKnownDA) || unrecognized.length > 0;

                if (needsHold) {
                  await recordMessageInAllLogs({
                    whatsappMsgId: inspected.msgId,
                    dateStr: parsedImg.dateStr,
                    timeStr: parsedImg.timeStr,
                    senderPhone,
                    senderPushName,
                    daId: daInfo?.daId || 'UNRESOLVED',
                    daName: daInfo?.name || 'Unknown DA',
                    fullMessage: ocrPipelineResult.extractedText || inspected.caption || '[Image Order]',
                    isSaved: false,
                    sheetRows: [],
                    note: '⏳ পেন্ডিং (অ্যাডমিন রিপ্লাইয়ের অপেক্ষায়)'
                  });
                  await createPendingOrderResolution({
                    parsedResult: parsedImg,
                    rawText: ocrPipelineResult.extractedText || inspected.caption,
                    senderPhone,
                    senderPushName,
                    rawSenderId,
                    originRemoteJid: remoteJid,
                    originMsg: msg,
                    isImageOrder: true
                  });
                } else if (orders.length > 0) {
                  const savedRows = await appendOrdersToSheet(orders);
                  await recordMessageInAllLogs({
                    whatsappMsgId: inspected.msgId,
                    dateStr: parsedImg.dateStr,
                    timeStr: parsedImg.timeStr,
                    senderPhone,
                    senderPushName,
                    daId: daInfo?.daId || orders[0].daId,
                    daName: daInfo?.name || orders[0].daName,
                    fullMessage: ocrPipelineResult.extractedText || inspected.caption || '[Image Order]',
                    isSaved: true,
                    sheetRows: savedRows,
                    note: `✅ ছবির অর্ডার সেভ হয়েছে (${orders.length}টি প্রোডাক্ট)`
                  });

                  cancellableOrderMap.set(inspected.msgId, inspected.msgId);
                  lastOrderBySenderMap.set(rawSenderId, inspected.msgId);
                  if (senderPhone) lastOrderBySenderMap.set(senderPhone, inspected.msgId);

                  const replyText = buildImageOrderReplyMessage(
                    orders,
                    ocrPipelineResult.engine,
                    ocrPipelineResult.attemptUsed
                  );
                  const sentReply = await safeSendMessage(
                    remoteJid,
                    { text: replyText },
                    { quoted: msg }
                  );
                  if (sentReply?.key?.id) {
                    cancellableOrderMap.set(sentReply.key.id, inspected.msgId);
                  }
                  if (sock) {
                    try {
                      await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                    } catch (e) {}
                  }
                }
              } else {
                await recordMessageInAllLogs({
                  whatsappMsgId: inspected.msgId,
                  senderPhone,
                  senderPushName,
                  daId: '-',
                  daName: senderPushName || '-',
                  fullMessage: ocrPipelineResult.extractedText || inspected.caption || '[Image — No CRP Order Recognized]',
                  isSaved: false,
                  sheetRows: [],
                  note: '❌ ছবিতে কোনো অর্ডার পাওয়া যায়নি'
                });
                addLog(
                  `❌ All 5 OCR/Vision methods found no valid CRP order. Extracted: "${(ocrPipelineResult.extractedText || '').replace(/\n/g, ' | ').slice(0, 180)}"`
                );
                if (sock) {
                  try {
                    await sock.sendMessage(remoteJid, { react: { text: '⚠️', key: msg.key } });
                  } catch (e) {}
                }
                await safeSendMessage(
                  remoteJid,
                  {
                    text:
                      '⚠️ *ছবিটি ৫টি ভিন্ন পদ্ধতিতে (OCR + Dual AI Vision) চেক করার পরও কোনো CRP প্রোডাক্টের অর্ডার পাওয়া যায়নি।*\n' +
                      'অনুগ্রহ করে খাতার লেখাটি আরেকটু পরিষ্কার করে ছবি তুলে পাঠান।' +
                      (ocrPipelineResult.extractedText
                        ? `\n\n_শনাক্তকৃত লেখা:_\n${ocrPipelineResult.extractedText.slice(0, 220)}`
                        : '')
                  },
                  { quoted: msg }
                );
              }
            });
            continue;
          }

          if (inspected.type === 'TEXT') {
            if (/^\/?cnl\b/i.test(inspected.text.trim())) {
              let targetOrderMsgId = null;
              if (inspected.quotedMsgId) {
                targetOrderMsgId =
                  cancellableOrderMap.get(inspected.quotedMsgId) || inspected.quotedMsgId;
              } else {
                targetOrderMsgId =
                  lastOrderBySenderMap.get(rawSenderId) ||
                  lastOrderBySenderMap.get(senderPhone) ||
                  null;
              }

              if (targetOrderMsgId) {
                const removedCount = await removeOrdersByMessageId(
                  targetOrderMsgId,
                  'CANCELLED_BY_CNL'
                );
                if (removedCount > 0) {
                  addLog(`❌ Order (${targetOrderMsgId}) cancelled via /cnl command (${removedCount} lines removed).`);
                  if (sock) {
                    try {
                      await sock.sendMessage(
                        remoteJid,
                        {
                          text: `❌ *অর্ডারটি বাতিল (/cnl) করা হয়েছে!*\nGoogle Sheet থেকে ওই অর্ডারের *${removedCount}টি লাইন* মুছে ফেলা হয়েছে।`
                        },
                        { quoted: msg }
                      );
                    } catch (e) {}
                  }
                } else {
                  if (sock) {
                    try {
                      await sock.sendMessage(
                        remoteJid,
                        { text: '⚠️ বাতিল করার মতো কোনো সক্রিয় অর্ডার খুঁজে পাওয়া যায়নি (হয়তো আগেই মুছে ফেলা হয়েছে)।' },
                        { quoted: msg }
                      );
                    } catch (e) {}
                  }
                }
              }
              continue;
            }

            if (!isGroup) continue;

            stats.totalMessagesChecked++;
            const parsed = parseWhatsAppOrderMessage({
              messageText: inspected.text,
              messageId: inspected.msgId,
              timestamp: msgTimestamp,
              senderPhone,
              senderPushName,
              senderJid,
              isImageOrder: false
            });

            const hasOrders = parsed.orders && parsed.orders.length > 0;
            const hasUnknownProd = parsed.unrecognizedItems && parsed.unrecognizedItems.length > 0;

            if (hasOrders || hasUnknownProd) {
              const needsHold = (parsed.daInfo && !parsed.daInfo.isKnownDA) || hasUnknownProd;
              if (needsHold) {
                await recordMessageInAllLogs({
                  whatsappMsgId: inspected.msgId,
                  dateStr: parsed.dateStr,
                  timeStr: parsed.timeStr,
                  senderPhone,
                  senderPushName,
                  daId: parsed.daInfo?.daId || 'UNRESOLVED',
                  daName: parsed.daInfo?.name || senderPushName || 'Unknown DA',
                  fullMessage: inspected.text,
                  isSaved: false,
                  sheetRows: [],
                  note: '⏳ পেন্ডিং প্রশ্ন (উত্তরের অপেক্ষায়)'
                });
                await createPendingOrderResolution({
                  parsedResult: parsed,
                  rawText: inspected.text,
                  senderPhone,
                  senderPushName,
                  rawSenderId,
                  originRemoteJid: remoteJid,
                  originMsg: msg,
                  isImageOrder: false
                });
              } else if (hasOrders) {
                const savedRows = await appendOrdersToSheet(parsed.orders);
                await recordMessageInAllLogs({
                  whatsappMsgId: inspected.msgId,
                  dateStr: parsed.dateStr,
                  timeStr: parsed.timeStr,
                  senderPhone,
                  senderPushName,
                  daId: parsed.daInfo?.daId || parsed.orders[0].daId,
                  daName: parsed.daInfo?.name || parsed.orders[0].daName,
                  fullMessage: inspected.text,
                  isSaved: true,
                  sheetRows: savedRows,
                  note: `✅ অর্ডার সেভ হয়েছে (${parsed.orders.length}টি আইটেম)`
                });
                cancellableOrderMap.set(inspected.msgId, inspected.msgId);
                lastOrderBySenderMap.set(rawSenderId, inspected.msgId);
                if (botConfig.autoReactOnOrder && sock) {
                  try {
                    await sock.sendMessage(remoteJid, {
                      react: { text: '✅', key: msg.key }
                    });
                  } catch (e) {}
                }
              }
            } else if (parsed.followUpPatch) {
              await applyFollowUpPatchToSheet(parsed.followUpPatch);
              await recordMessageInAllLogs({
                whatsappMsgId: inspected.msgId,
                dateStr: parsed.dateStr,
                timeStr: parsed.timeStr,
                senderPhone,
                senderPushName,
                daId: parsed.daInfo?.daId || '-',
                daName: parsed.daInfo?.name || senderPushName || '-',
                fullMessage: inspected.text,
                isSaved: false,
                sheetRows: [],
                note: '🔧 Follow-up ID/PSO Patch'
              });
            } else {
              await recordMessageInAllLogs({
                whatsappMsgId: inspected.msgId,
                dateStr: parsed.dateStr,
                timeStr: parsed.timeStr,
                senderPhone,
                senderPushName,
                daId: parsed.daInfo?.isKnownDA ? parsed.daInfo.daId : '-',
                daName: parsed.daInfo?.isKnownDA ? parsed.daInfo.name : (senderPushName || '-'),
                fullMessage: inspected.text,
                isSaved: false,
                sheetRows: [],
                note: '❌ সাধারণ মেসেজ (কোনো অর্ডার নেই)'
              });
            }
            recordProcessedGroupMessageId(inspected.msgId, msgTimestamp);
          }
        } catch (err) {
          addLog(`❌ Error processing message: ${err.message}`);
        }
      }
    });

    sock.ev.on('messaging-history.set', async ({ messages: histMessages }) => {
      try {
        if (!Array.isArray(histMessages) || histMessages.length === 0) return;
        syncTargetGroupFromMasterDbToBotConfig();
        const recentGroupMsgs = histMessages.filter((m) => {
          const jid = m?.key?.remoteJid || '';
          if (!jid.endsWith('@g.us') || !isAllowedTargetGroup(jid)) return false;
          const id = m?.key?.id || '';
          if (!id || isMessageAlreadyProcessed(id)) return false;
          const tsMs = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : 0;
          return tsMs > 0 && Date.now() - tsMs <= 6 * 60 * 60 * 1000;
        });
        if (recentGroupMsgs.length > 0 && sock?.ev) {
          addLog(`🔄 History Sync on Reconnect: Checking ${recentGroupMsgs.length} recent group message(s) for missed orders...`);
          sock.ev.emit('messages.upsert', { messages: recentGroupMsgs, type: 'append' });
        }
      } catch (e) {}
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const u of updates) {
        try {
          const remoteJid = u.key?.remoteJid || '';
          if (!remoteJid) continue;
          if (remoteJid.endsWith('@g.us') && !isAllowedTargetGroup(remoteJid)) {
            continue;
          }

          if (
            u.update?.message === null ||
            u.update?.messageStubType === 1 ||
            u.update?.message?.protocolMessage?.type === 0
          ) {
            const targetId =
              u.update?.message?.protocolMessage?.key?.id || u.key?.id;
            if (targetId) {
              addLog(`🚨 Unsend/Delete (via update) for Msg ID: ${targetId}`);
              await removeOrdersByMessageId(targetId, 'UNSENT_BY_USER');
            }
          } else if (u.update?.message) {
            const inspected = inspectBaileysMessage({
              key: u.key,
              message: u.update.message
            });
            if (inspected.type === 'EDIT') {
              await removeOrdersByMessageId(inspected.targetMsgId, 'REPLACED_BY_EDIT');
              const senderJid = u.key.participant || remoteJid;
              const senderPhone = resolveRealSenderPhone({ key: u.key });
              const parsedEdit = parseWhatsAppOrderMessage({
                messageText: inspected.text,
                messageId: inspected.targetMsgId,
                timestamp: Date.now(),
                senderPhone,
                senderPushName: '',
                senderJid,
                isImageOrder: false
              });
              if (parsedEdit.isOrder && parsedEdit.orders.length > 0) {
                await appendOrdersToSheet(parsedEdit.orders);
              }
            }
          }
        } catch (err) {
          addLog(`❌ Error in messages.update: ${err.message}`);
        }
      }
    });
  } catch (err) {
    addLog(`❌ Failed to start WhatsApp socket: ${err.message}`);
    setTimeout(() => startWhatsApp(), 5000);
  }
}

// ============================================================================
// 12. EXPRESS WEB SERVER, MASTER DB CRUD API & NEO-BRUTALISM DASHBOARD UI
// ============================================================================
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    version: '6.0-multi-chunk-cloud-state',
    waStatus,
    googleAuthReady,
    targetGroup: botConfig.targetGroupName,
    daCount: activeDAs.length,
    productCount: activeProducts.length,
    pendingCount: pendingResolutions.size,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    waStatus,
    qrDataUrl: currentQrDataUrl,
    connectedUser,
    googleAuthReady,
    googleAuthError,
    googleSheetId: GOOGLE_SHEET_ID,
    googleSheetUrl: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`,
    botConfig: {
      ...botConfig,
      hasGeminiKey: Boolean(botConfig.geminiApiKey || process.env.GEMINI_API_KEY)
    },
    adminAlertPhones: getAdminAlertPhones().map((p) => '+' + p),
    authorizedImagePhones: getAuthorizedImagePhones().map((p) => '+' + p),
    joinedGroups,
    stats,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    recentOrders: recentOrders.slice(0, 40),
    logs: activityLogs.slice(0, 50),
    productCount: activeProducts.length,
    daCount: activeDAs.length,
    targetGroup: masterDb.targetGroup || {
      targetGroupId: botConfig.targetGroupId,
      targetGroupName: botConfig.targetGroupName,
      autoReactOnOrder: botConfig.autoReactOnOrder
    },
    lastProcessedMsgIds: masterDb.lastProcessedMsgIds || [],
    messageLogs: (masterDb.messageLogs || []).slice(0, 120),
    pendingResolutions: Array.from(pendingResolutions.values()).map((p) => ({
      token: p.token,
      type: p.type,
      createdAt: p.createdAt,
      daInfo: p.daInfo,
      detectedDaId: p.detectedDaId,
      orders: p.orders,
      unrecognizedItems: p.unrecognizedItems,
      unknownProductText: p.unknownProductText,
      orderedQty: p.orderedQty,
      rawLine: p.rawLine,
      rawText: p.rawText || p.rawLine || '',
      defaultPharmacy: p.defaultPharmacy,
      whatsappMsgId: p.whatsappMsgId,
      senderPhone: p.senderPhone,
      displayPhone: p.displayPhone || (p.senderPhone ? '+' + normalizeBdPhone(p.senderPhone) : '-'),
      senderPushName: p.senderPushName || ''
    }))
  });
});

app.post('/api/message-logs/sync-rows', async (req, res) => {
  await syncLiveSheetRowNumbers();
  res.json({
    ok: true,
    messageLogs: (masterDb.messageLogs || []).slice(0, 120)
  });
});

app.post('/api/message/edit-submit', async (req, res) => {
  try {
    const {
      whatsappMsgId,
      pendingToken,
      editedText,
      senderPhone,
      senderPushName,
      overrideDaText
    } = req.body || {};

    const cleanText = String(editedText || '').trim();
    if (!cleanText) {
      return res.status(400).json({ ok: false, error: 'মেসেজের লেখা খালি রাখা যাবে না।' });
    }

    const finalMsgId = String(whatsappMsgId || `WEB_EDIT_${Date.now()}`).trim();

    let combinedText = cleanText;
    if (overrideDaText && String(overrideDaText).trim()) {
      const daOverrideStr = String(overrideDaText).trim();
      const idMatch = daOverrideStr.toUpperCase().match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b/);
      if (idMatch) {
        const candId = `${idMatch[1]}${idMatch[2]}`;
        const remName = daOverrideStr
          .replace(/\b(CF|RF|C)\s*[\-_.]?\s*\d{4,6}\b/i, '')
          .replace(/^[\s\-:=,|]+|[\s\-:=,|]+$/g, '')
          .trim();
        let existingDa = masterDb.das.find((d) => d.daId.toUpperCase() === candId);
        if (!existingDa && remName) {
          existingDa = {
            daId: candId,
            altId: '',
            name: remName,
            phones: senderPhone ? [normalizeBdPhone(senderPhone)].filter(Boolean) : [],
            aliases: [remName.toLowerCase(), candId.toLowerCase()]
          };
          masterDb.das.unshift(existingDa);
          saveLocalMasterDb();
          rebuildMasterLookupCaches();
        } else if (existingDa && remName && existingDa.name.startsWith('Unknown')) {
          existingDa.name = remName;
          saveLocalMasterDb();
          rebuildMasterLookupCaches();
        }
      }
      if (!cleanText.toUpperCase().includes(daOverrideStr.toUpperCase().split(/\s+/)[0])) {
        combinedText = `${daOverrideStr}\n${cleanText}`;
      }
    }

    if (pendingToken && pendingResolutions.has(pendingToken)) {
      pendingResolutions.delete(pendingToken);
    }
    for (const [tok, pVal] of pendingResolutions.entries()) {
      if (pVal.whatsappMsgId === finalMsgId) {
        pendingResolutions.delete(tok);
      }
    }

    if (liveMsgIdToSheetRowsMap.has(finalMsgId) || sheetExistingMsgIds.has(finalMsgId)) {
      await removeOrdersByMessageId(finalMsgId, 'REPLACED_BY_WEB_EDIT');
    }

    const parsed = parseWhatsAppOrderMessage({
      messageText: combinedText,
      messageId: finalMsgId,
      timestamp: Date.now(),
      senderPhone: senderPhone || '',
      senderPushName: senderPushName || '',
      senderJid: senderPhone ? `${normalizeBdPhone(senderPhone)}@s.whatsapp.net` : '',
      isImageOrder: false
    });

    if (!parsed.orders || parsed.orders.length === 0) {
      await recordMessageInAllLogs({
        whatsappMsgId: finalMsgId,
        senderPhone: senderPhone || '',
        senderPushName: senderPushName || '',
        daId: parsed.daInfo?.daId || '-',
        daName: parsed.daInfo?.name || '-',
        fullMessage: combinedText,
        isSaved: false,
        sheetRows: [],
        note: '❌ এডিট করা মেসেজে কোনো পরিচিত CRP প্রোডাক্ট পাওয়া যায়নি'
      });
      return res.status(400).json({
        ok: false,
        error: 'এডিট করা মেসেজে কোনো পরিচিত প্রোডাক্ট বা পরিমাণ পাওয়া যায়নি। প্রোডাক্টের নাম ও সংখ্যা ঠিকমতো লিখুন।',
        parsed
      });
    }

    if (parsed.daInfo && !parsed.daInfo.isKnownDA) {
      const fallbackDaId = parsed.daInfo.detectedDaId || (overrideDaText ? overrideDaText.trim().split(/\s+/)[0].toUpperCase() : 'WEB-DA');
      const fallbackDaName = overrideDaText
        ? overrideDaText.trim()
        : (senderPushName || parsed.daInfo.name || 'Web Approved DA');
      for (const o of parsed.orders) {
        o.daId = fallbackDaId;
        o.daName = fallbackDaName;
      }
      parsed.daInfo.daId = fallbackDaId;
      parsed.daInfo.name = fallbackDaName;
      parsed.daInfo.isKnownDA = true;
    }

    const savedRows = await appendOrdersToSheet(parsed.orders);
    await recordMessageInAllLogs({
      whatsappMsgId: finalMsgId,
      dateStr: parsed.dateStr,
      timeStr: parsed.timeStr,
      senderPhone: senderPhone || parsed.orders[0]?.senderPhone || '',
      senderPushName: senderPushName || parsed.daInfo?.name || '',
      daId: parsed.orders[0]?.daId || '-',
      daName: parsed.orders[0]?.daName || '-',
      fullMessage: combinedText,
      isSaved: true,
      sheetRows: savedRows,
      note: `✅ ওয়েবসাইট থেকে এডিট করে সেভ করা হয়েছে (${parsed.orders.length}টি প্রোডাক্ট)`
    });

    await syncLiveSheetRowNumbers();

    return res.json({
      ok: true,
      whatsappMsgId: finalMsgId,
      savedRows,
      orders: parsed.orders,
      unrecognizedItems: parsed.unrecognizedItems || [],
      message: `✅ মেসেজটি সফলভাবে এডিট ও Google Sheet-এ সেভ হয়েছে! (Row: ${savedRows.join(', ')})`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/master-db', (req, res) => {
  res.json({
    ok: true,
    das: masterDb.das,
    products: masterDb.products,
    productGroups: masterDb.productGroups || [],
    imageQueueCount: pendingImageQueueCount,
    adminAlertPhones: getAdminAlertPhones(),
    authorizedImagePhones: getAuthorizedImagePhones(),
    targetGroup: masterDb.targetGroup || {
      targetGroupId: botConfig.targetGroupId,
      targetGroupName: botConfig.targetGroupName,
      autoReactOnOrder: botConfig.autoReactOnOrder
    },
    lastProcessedMsgIds: masterDb.lastProcessedMsgIds || [],
    recentProcessedMsgIdsCount: (masterDb.recentProcessedMsgIds || []).length,
    pendingResolutions: Array.from(pendingResolutions.values()),
    updatedAt: masterDb.updatedAt
  });
});

app.post('/api/product-group/save', (req, res) => {
  const { groupName, keywords } = req.body || {};
  const cleanGroup = String(groupName || '').trim().toUpperCase();
  if (!cleanGroup) {
    return res.status(400).json({ ok: false, error: 'গ্রুপের নাম (Group Name) দিতে হবে।' });
  }
  const cleanKeywords = Array.from(
    new Set(
      [
        cleanGroup.toLowerCase(),
        ...(Array.isArray(keywords) ? keywords : String(keywords || '').split(','))
          .map((k) => String(k || '').trim().toLowerCase())
          .filter((k) => k && !isAccidentalPsoAlias(k))
      ]
    )
  );
  if (!Array.isArray(masterDb.productGroups)) masterDb.productGroups = [];
  const idx = masterDb.productGroups.findIndex((g) => g.groupName.toUpperCase() === cleanGroup);
  if (idx >= 0) {
    masterDb.productGroups[idx].keywords = cleanKeywords;
    addLog(`🗂️ Updated Product Group [${cleanGroup}] (${cleanKeywords.length} keywords)`);
  } else {
    masterDb.productGroups.unshift({ groupName: cleanGroup, keywords: cleanKeywords });
    addLog(`➕ Created New Product Group [${cleanGroup}]`);
  }
  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  res.json({ ok: true, productGroups: masterDb.productGroups });
});

app.post('/api/product-group/keyword', (req, res) => {
  const { groupName, keyword, action } = req.body || {};
  const cleanGroup = String(groupName || '').trim().toUpperCase();
  const cleanKw = String(keyword || '').trim().toLowerCase();
  const grp = (masterDb.productGroups || []).find((g) => g.groupName.toUpperCase() === cleanGroup);
  if (!grp) return res.status(404).json({ ok: false, error: 'Group not found' });
  if (!grp.keywords) grp.keywords = [];

  if (action === 'remove') {
    grp.keywords = grp.keywords.filter((k) => k.toLowerCase() !== cleanKw);
  } else if (cleanKw && !isAccidentalPsoAlias(cleanKw)) {
    const stem = extractCommonBrandStem(cleanKw) || cleanKw;
    if (!grp.keywords.includes(stem)) grp.keywords.push(stem);
    if (!grp.keywords.includes(cleanKw)) grp.keywords.push(cleanKw);
  }
  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  res.json({ ok: true, group: grp });
});

app.post('/api/product-group/delete', (req, res) => {
  const { groupName, resetDefault } = req.body || {};
  if (resetDefault) {
    masterDb.productGroups = buildDefaultProductGroups(masterDb.products);
    saveLocalMasterDb();
    scheduleCloudStateBackup(1500);
    return res.json({ ok: true, productGroups: masterDb.productGroups });
  }
  const cleanGroup = String(groupName || '').trim().toUpperCase();
  masterDb.productGroups = (masterDb.productGroups || []).filter((g) => g.groupName.toUpperCase() !== cleanGroup);
  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  res.json({ ok: true, productGroups: masterDb.productGroups });
});

app.get('/api/master-db/export', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="crp_master_db_backup.json"');
  res.send(JSON.stringify(masterDb, null, 2));
});

app.post('/api/master-db/import', async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const payload = body.dbData && typeof body.dbData === 'object' ? body.dbData : body;

    const hasValidData =
      payload &&
      (Array.isArray(payload.das) ||
        Array.isArray(payload.products) ||
        Array.isArray(payload.productGroups) ||
        Array.isArray(payload.adminAlertPhones) ||
        Array.isArray(payload.authorizedImagePhones) ||
        Array.isArray(payload));

    if (!hasValidData) {
      return res.status(400).json({
        ok: false,
        error: 'সঠিক JSON ডাটাবেস ফরম্যাট পাওয়া যায়নি (das বা products থাকতে হবে)।'
      });
    }

    if (mode === 'replace') {
      applyMasterDbObject(payload, true);
      addLog(`🔄 Replaced Master DB from imported JSON (${masterDb.das.length} DAs, ${masterDb.products.length} Products, ${(masterDb.productGroups || []).length} Groups).`);
    } else {
      mergeMasterDbObject(payload, true);
      addLog(`➕ Merged imported JSON into Master DB (${masterDb.das.length} DAs, ${masterDb.products.length} Products, ${(masterDb.productGroups || []).length} Groups).`);
    }

    scheduleCloudStateBackup(1000);
    if (googleAuthReady) {
      ensureSpreadsheetStructure(true).catch(() => {});
    }

    return res.json({
      ok: true,
      mode,
      daCount: masterDb.das.length,
      productCount: masterDb.products.length,
      groupCount: (masterDb.productGroups || []).length,
      message:
        mode === 'replace'
          ? `✅ সম্পূর্ণ ডাটাবেস সফলভাবে রিপ্লেস হয়েছে! (প্রতিনিধি: ${masterDb.das.length}, প্রোডাক্ট: ${masterDb.products.length}, গ্রুপ: ${(masterDb.productGroups || []).length})`
          : `✅ আগের ডাটার সাথে নতুন JSON ফাইল সফলভাবে মার্জ হয়েছে! (মোট প্রতিনিধি: ${masterDb.das.length}, প্রোডাক্ট: ${masterDb.products.length}, গ্রুপ: ${(masterDb.productGroups || []).length})`
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'JSON Import Error: ' + err.message });
  }
});

app.post('/api/da/save', async (req, res) => {
  const { originalDaId, daId, altId, name, phones, aliases } = req.body || {};
  const cleanId = String(daId || '').trim().toUpperCase();
  const cleanName = String(name || '').trim();
  if (!cleanId || !cleanName) {
    return res.status(400).json({ ok: false, error: 'DA ID এবং নাম অবশ্যই দিতে হবে।' });
  }

  const cleanPhones = (Array.isArray(phones) ? phones : String(phones || '').split(','))
    .map((p) => normalizeBdPhone(p))
    .filter(Boolean);

  const cleanAliases = Array.from(
    new Set(
      [
        cleanName.toLowerCase(),
        cleanId.toLowerCase(),
        ...(Array.isArray(aliases) ? aliases : String(aliases || '').split(','))
          .map((a) => String(a || '').trim().toLowerCase())
          .filter(Boolean)
      ]
    )
  );

  const lookupId = String(originalDaId || cleanId).trim().toUpperCase();
  const existingIdx = masterDb.das.findIndex((d) => d.daId.toUpperCase() === lookupId);

  const daRecord = {
    daId: cleanId,
    altId: String(altId || '').trim().toUpperCase(),
    name: cleanName,
    phones: cleanPhones,
    aliases: cleanAliases
  };

  if (existingIdx >= 0) {
    masterDb.das[existingIdx] = daRecord;
    addLog(`✏️ Updated DA in Master DB: [${cleanId}] ${cleanName}`);
  } else {
    masterDb.das.unshift(daRecord);
    addLog(`➕ Added new DA to Master DB: [${cleanId}] ${cleanName}`);
  }

  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  res.json({ ok: true, da: daRecord, totalDAs: masterDb.das.length });
});

app.post('/api/da/delete', async (req, res) => {
  const { daId, deleteAll, resetDefault } = req.body || {};

  if (resetDefault) {
    masterDb.das = JSON.parse(JSON.stringify(DEFAULT_DA_MASTER));
    saveLocalMasterDb();
    scheduleCloudStateBackup(1500);
    addLog('🔄 Reset DA Database to default 46 DAs.');
    return res.json({ ok: true, totalDAs: masterDb.das.length });
  }

  if (deleteAll) {
    masterDb.das = [];
    senderContextCache.clear();
    saveLocalMasterDb();
    scheduleCloudStateBackup(1500);
    addLog('🗑️ Cleared ALL DAs from Master Database as requested by Admin.');
    return res.json({ ok: true, totalDAs: 0 });
  }

  const target = String(daId || '').trim().toUpperCase();
  const before = masterDb.das.length;
  masterDb.das = masterDb.das.filter((d) => d.daId.toUpperCase() !== target);
  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  addLog(`🗑️ Removed DA [${target}] from Master DB.`);
  res.json({ ok: true, removed: before - masterDb.das.length, totalDAs: masterDb.das.length });
});

app.post('/api/product/save', async (req, res) => {
  const { originalCode, code, name, unit, price, family, aliases } = req.body || {};
  const cleanCode = String(code || '').trim().toUpperCase();
  const cleanName = String(name || '').trim().toUpperCase();
  const cleanPrice = Number(parseFloat(price) || 0);

  if (!cleanCode || !cleanName || cleanPrice <= 0) {
    return res.status(400).json({ ok: false, error: 'প্রোডাক্টের কোড, নাম এবং সঠিক দাম (Trade Price) দিতে হবে।' });
  }

  const cleanAliases = Array.from(
    new Set(
      (Array.isArray(aliases) ? aliases : String(aliases || '').split(','))
        .map((a) => String(a || '').trim().toLowerCase())
        .filter((a) => a && !isAccidentalPsoAlias(a))
    )
  );

  const lookupCode = String(originalCode || cleanCode).trim().toUpperCase();
  const existingIdx = masterDb.products.findIndex((p) => String(p.code).toUpperCase() === lookupCode);

  const prodRecord = {
    code: cleanCode,
    name: cleanName,
    unit: String(unit || "Box/Bottle").trim(),
    price: Number(cleanPrice.toFixed(2)),
    family: String(family || cleanName.split(/\s+/)[0]).trim().toUpperCase(),
    aliases: cleanAliases
  };

  syncProductWithBrandGroup(prodRecord);
  if (existingIdx >= 0) {
    masterDb.products[existingIdx] = prodRecord;
    addLog(`✏️ Updated Product [${cleanCode}] ${cleanName} in Group [${prodRecord.family}] (TP: ৳${prodRecord.price})`);
  } else {
    masterDb.products.unshift(prodRecord);
    addLog(`➕ Added New Product [${cleanCode}] ${cleanName} to Group [${prodRecord.family}] (TP: ৳${prodRecord.price})`);
  }

  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  res.json({ ok: true, product: prodRecord, totalProducts: masterDb.products.length });
});

app.post('/api/product/alias', async (req, res) => {
  const { code, alias, action } = req.body || {};
  const cleanCode = String(code || '').trim().toUpperCase();
  const cleanAlias = String(alias || '').trim().toLowerCase();
  const prod = masterDb.products.find((p) => String(p.code).toUpperCase() === cleanCode);
  if (!prod) {
    return res.status(404).json({ ok: false, error: 'Product not found.' });
  }
  if (!prod.aliases) prod.aliases = [];

  if (action === 'remove') {
    prod.aliases = prod.aliases.filter((a) => a.toLowerCase() !== cleanAlias);
    addLog(`🗑️ Removed alias "${cleanAlias}" from [${cleanCode}] ${prod.name}`);
  } else if (cleanAlias && !isAccidentalPsoAlias(cleanAlias)) {
    if (!prod.aliases.includes(cleanAlias)) {
      prod.aliases.push(cleanAlias);
      syncProductWithBrandGroup(prod, cleanAlias);
      addLog(`🧠 Added wrong-spelling alias "${cleanAlias}" -> [${cleanCode}] ${prod.name} & Group [${prod.family}]`);
    }
  }

  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  res.json({ ok: true, product: prod });
});

app.post('/api/product/delete', async (req, res) => {
  const { code, deleteAll, resetDefault } = req.body || {};

  if (resetDefault) {
    masterDb.products = JSON.parse(JSON.stringify(DEFAULT_CRP_PRODUCTS));
    saveLocalMasterDb();
    scheduleCloudStateBackup(1500);
    addLog('🔄 Reset Product Database to default 79 CRP products.');
    return res.json({ ok: true, totalProducts: masterDb.products.length });
  }

  if (deleteAll) {
    masterDb.products = [];
    saveLocalMasterDb();
    scheduleCloudStateBackup(1500);
    addLog('🗑️ Cleared ALL products from Master DB.');
    return res.json({ ok: true, totalProducts: 0 });
  }

  const target = String(code || '').trim().toUpperCase();
  masterDb.products = masterDb.products.filter((p) => String(p.code).toUpperCase() !== target);
  saveLocalMasterDb();
  scheduleCloudStateBackup(1500);
  addLog(`🗑️ Deleted Product [${target}] from Master DB.`);
  res.json({ ok: true, totalProducts: masterDb.products.length });
});

app.post('/api/phones/save', async (req, res) => {
  const { adminAlertPhones, authorizedImagePhones } = req.body || {};

  if (adminAlertPhones !== undefined) {
    const list = (Array.isArray(adminAlertPhones) ? adminAlertPhones : String(adminAlertPhones || '').split(','))
      .map((p) => normalizeBdPhone(p))
      .filter((p) => p.length >= 11);
    masterDb.adminAlertPhones = list.length > 0 ? Array.from(new Set(list)) : [...DEFAULT_ADMIN_ALERT_PHONES];
  }

  if (authorizedImagePhones !== undefined) {
    const list = (Array.isArray(authorizedImagePhones) ? authorizedImagePhones : String(authorizedImagePhones || '').split(','))
      .map((p) => normalizeBdPhone(p))
      .filter((p) => p.length >= 11);
    masterDb.authorizedImagePhones = list.length > 0 ? Array.from(new Set(list)) : [...DEFAULT_AUTHORIZED_IMAGE_PHONES];
  }

  saveLocalMasterDb();
  await autoBindAuthorizedImagePhones();
  scheduleCloudStateBackup(1500);
  addLog(
    `📱 Updated Phone Config — Admin Alert: [${masterDb.adminAlertPhones.join(', ')}], Image Auth: [${masterDb.authorizedImagePhones.join(', ')}]`
  );
  res.json({
    ok: true,
    adminAlertPhones: masterDb.adminAlertPhones,
    authorizedImagePhones: masterDb.authorizedImagePhones
  });
});

app.post('/api/pending/resolve', async (req, res) => {
  const { token, answer } = req.body || {};
  const result = await resolvePendingItemWithAnswer(String(token || '').trim(), String(answer || '').trim());
  res.json(result);
});

app.post('/api/orders/clear', (req, res) => {
  const count = recentOrders.length;
  recentOrders.length = 0;
  cancellableOrderMap.clear();
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
  addLog(`🧹 Cleared ${count} order(s) from Live Parsed Orders memory buffer.`);
  res.json({ ok: true, cleared: count, memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) });
});

app.post('/api/logs/clear', (req, res) => {
  activityLogs.length = 0;
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
  addLog('🧹 Server logs cleared manually to free Render memory.');
  res.json({ ok: true, memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) });
});

app.post('/api/groups/refresh', async (req, res) => {
  const groups = await refreshJoinedGroups();
  res.json({ ok: true, groups });
});

app.post('/api/config/group', async (req, res) => {
  let { groupId, groupName, autoReactOnOrder, geminiApiKey } = req.body || {};
  groupId = typeof groupId === 'string' ? groupId.trim() : '';
  groupName = typeof groupName === 'string' ? groupName.trim() : '';

  if (groupId === 'ALL') {
    botConfig.targetGroupId = 'ALL';
    botConfig.targetGroupName = 'All Joined Groups (সব গ্রুপ)';
  } else {
    if (groupId) {
      const foundById = joinedGroups.find((g) => g.id === groupId);
      if (foundById) groupName = foundById.subject;
    } else if (groupName) {
      const foundByName = joinedGroups.find(
        (g) =>
          g.subject.toLowerCase().trim() === groupName.toLowerCase() ||
          g.subject.toLowerCase().includes(groupName.toLowerCase())
      );
      if (foundByName) {
        groupId = foundByName.id;
        groupName = foundByName.subject;
      }
    }
    botConfig.targetGroupId = groupId;
    botConfig.targetGroupName = groupName || 'All Joined Groups';
  }

  if (typeof autoReactOnOrder === 'boolean') botConfig.autoReactOnOrder = autoReactOnOrder;
  if (typeof geminiApiKey === 'string' && geminiApiKey.trim()) {
    botConfig.geminiApiKey = geminiApiKey.trim();
  }
  botConfig.updatedAt = new Date().toISOString();

  saveTargetGroupToMasterDb(botConfig.targetGroupId, botConfig.targetGroupName, botConfig.autoReactOnOrder);
  await backupAuthAndConfigToSheet();
  addLog(`🔒 Group Config Saved in master_db.json: "${botConfig.targetGroupName}" [ID: ${botConfig.targetGroupId || 'ALL'}]`);
  res.json({ ok: true, botConfig, targetGroup: masterDb.targetGroup });
});

app.post('/api/test-parse', async (req, res) => {
  const { messageText, senderPhone, senderName, saveToSheet, simulateUnsendMsgId, isImageOrder } = req.body || {};

  if (simulateUnsendMsgId) {
    const removedCount = await removeOrdersByMessageId(simulateUnsendMsgId, 'CANCELLED_BY_CNL');
    return res.json({ ok: true, action: 'UNSEND_SIMULATED', removedCount });
  }

  const msgId = `TEST_${Date.now()}`;
  const result = parseWhatsAppOrderMessage({
    messageText: messageText || '',
    messageId: msgId,
    timestamp: new Date(),
    senderPhone: senderPhone || '8801793362829',
    senderPushName: senderName || 'Test User',
    senderJid: `${senderPhone || '8801793362829'}@s.whatsapp.net`,
    isImageOrder: Boolean(isImageOrder)
  });

  if (saveToSheet && result.isOrder && result.orders.length > 0) {
    if (result.daInfo && !result.daInfo.isKnownDA) {
      await createPendingDaResolution({
        orders: result.orders,
        detectedDaId: result.daInfo.detectedDaId,
        rawText: messageText || '',
        senderPhone: senderPhone || '8801793362829',
        senderPushName: senderName || 'Test User',
        isImageOrder: Boolean(isImageOrder)
      });
    } else {
      await appendOrdersToSheet(result.orders);
    }
  }

  if (saveToSheet && result.unrecognizedItems && result.unrecognizedItems.length > 0) {
    for (const unk of result.unrecognizedItems) {
      await createPendingProductResolution({
        unknownItem: unk,
        daInfo: result.daInfo,
        messageId: msgId,
        dateStr: result.dateStr,
        timeStr: result.timeStr,
        displayPhone: result.displayPhone
      });
    }
  }

  res.json({ ok: true, msgId, ...result });
});

app.post('/api/sheets/sync', async (req, res) => {
  if (!googleAuthReady) {
    await initGoogleSheetsClient();
  }
  const ok = await ensureSpreadsheetStructure(true);
  await backupAuthAndConfigToSheet();
  res.json({ ok, googleAuthReady, googleAuthError, productCount: activeProducts.length, daCount: activeDAs.length });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    if (sock) await sock.logout();
  } catch (e) {}
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  } catch (e) {}
  waStatus = 'DISCONNECTED';
  currentQrDataUrl = null;
  connectedUser = null;
  addLog('🔄 WhatsApp session manually reset by admin. Generating fresh QR code...');
  setTimeout(() => startWhatsApp(), 1500);
  res.json({ ok: true });
});

// Serve Neo-Brutalism v6.0 Master Command Center UI at "/"
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send("<!DOCTYPE html>\n<html lang=\"bn\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>Renata CRP Order Tracker v6.0 — Dynamic Master DB & Self-Learning AI</title>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;600;700&family=Space+Grotesk:wght@600;700;800&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --bg: #FFFDF7;\n      --ink: #000000;\n      --yellow: #FFE600;\n      --mint: #6EE7B7;\n      --sky: #7DD3FC;\n      --pink: #FF90E8;\n      --coral: #FDA4AF;\n      --lavender: #C4B5FD;\n      --orange: #FDBA74;\n      --white: #FFFFFF;\n      --border: 3px solid #000000;\n      --shadow: 6px 6px 0px #000000;\n      --shadow-sm: 4px 4px 0px #000000;\n    }\n    * { box-sizing: border-box; margin: 0; padding: 0; }\n    body {\n      font-family: 'Space Grotesk', 'Hind Siliguri', sans-serif;\n      background-color: var(--bg);\n      background-image: radial-gradient(#000000 1.1px, transparent 1.1px);\n      background-size: 22px 22px;\n      color: var(--ink);\n      line-height: 1.5;\n      padding: 16px;\n    }\n    .container { max-width: 1320px; margin: 0 auto; }\n\n    header {\n      display: flex;\n      flex-wrap: wrap;\n      justify-content: space-between;\n      align-items: center;\n      gap: 14px;\n      background: var(--yellow);\n      border: 3.5px solid var(--ink);\n      box-shadow: 7px 7px 0px var(--ink);\n      padding: 18px 22px;\n      border-radius: 12px;\n      margin-bottom: 18px;\n    }\n    header h1 { font-size: 1.4rem; font-weight: 800; text-transform: uppercase; }\n    header p { font-size: 0.9rem; font-weight: 700; opacity: 0.85; margin-top: 2px; }\n\n    .badge {\n      display: inline-flex;\n      align-items: center;\n      gap: 5px;\n      padding: 6px 12px;\n      border-radius: 8px;\n      font-size: 0.8rem;\n      font-weight: 800;\n      border: 2.5px solid var(--ink);\n      box-shadow: 3px 3px 0px var(--ink);\n      background: var(--white);\n    }\n    .badge.ok { background: var(--mint); }\n    .badge.warn { background: var(--orange); }\n    .badge.err { background: var(--coral); }\n    .badge.info { background: var(--lavender); }\n\n    .nav-tabs {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 10px;\n      margin-bottom: 20px;\n    }\n    .tab-btn {\n      cursor: pointer;\n      border: 3px solid var(--ink);\n      box-shadow: 4px 4px 0px var(--ink);\n      padding: 10px 18px;\n      border-radius: 10px;\n      font-weight: 800;\n      font-size: 0.92rem;\n      background: var(--white);\n      color: var(--ink);\n      transition: all 0.1s ease;\n    }\n    .tab-btn.active {\n      background: var(--ink) !important;\n      color: var(--yellow) !important;\n      transform: translate(2px, 2px);\n      box-shadow: 2px 2px 0px var(--ink);\n    }\n\n    .tab-panel { display: none; }\n    .tab-panel.active { display: block; }\n\n    .stats-row {\n      display: grid;\n      grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));\n      gap: 14px;\n      margin-bottom: 20px;\n    }\n    .stat-card {\n      border: var(--border);\n      box-shadow: var(--shadow-sm);\n      padding: 14px 16px;\n      border-radius: 10px;\n    }\n    .stat-card.c1 { background: #A7F3D0; }\n    .stat-card.c2 { background: #BAE6FD; }\n    .stat-card.c3 { background: #FEF08A; }\n    .stat-card.c4 { background: #FECDD3; }\n    .stat-card.c5 { background: #DDD6FE; }\n    .stat-card .lbl { font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }\n    .stat-card .val { font-size: 1.35rem; font-weight: 800; margin-top: 4px; }\n\n    .grid {\n      display: grid;\n      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));\n      gap: 20px;\n      margin-bottom: 22px;\n    }\n    .card {\n      background: var(--white);\n      border: var(--border);\n      box-shadow: var(--shadow);\n      border-radius: 12px;\n      overflow: hidden;\n      margin-bottom: 20px;\n    }\n    .card-header {\n      padding: 13px 18px;\n      border-bottom: var(--border);\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 10px;\n      flex-wrap: wrap;\n      font-weight: 800;\n      font-size: 1rem;\n    }\n    .card-header.h-pink { background: var(--pink); }\n    .card-header.h-mint { background: var(--mint); }\n    .card-header.h-sky { background: var(--sky); }\n    .card-header.h-yellow { background: var(--yellow); }\n    .card-header.h-lavender { background: var(--lavender); }\n    .card-header.h-orange { background: var(--orange); }\n    .card-body { padding: 18px; }\n\n    .qr-box {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      padding: 16px;\n      background: #FFFDF7;\n      border: 2.5px dashed var(--ink);\n      border-radius: 10px;\n      min-height: 220px;\n      text-align: center;\n    }\n    .qr-box img {\n      max-width: 210px;\n      border-radius: 8px;\n      border: 3px solid var(--ink);\n      box-shadow: var(--shadow-sm);\n      margin-bottom: 10px;\n      background: #fff;\n    }\n\n    label { display: block; font-size: 0.84rem; font-weight: 700; margin-bottom: 5px; margin-top: 10px; }\n    select, input[type=\"text\"], input[type=\"number\"], input[type=\"password\"], textarea {\n      width: 100%;\n      background: #FFFDF7;\n      border: 2.5px solid var(--ink);\n      box-shadow: 3px 3px 0px var(--ink);\n      color: var(--ink);\n      padding: 9px 12px;\n      border-radius: 8px;\n      font-size: 0.9rem;\n      font-weight: 600;\n      font-family: inherit;\n      outline: none;\n    }\n    select:focus, input:focus, textarea:focus { background: #FEF9C3; }\n    textarea { min-height: 100px; font-family: monospace; resize: vertical; }\n\n    .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }\n    button, .btn-link {\n      cursor: pointer;\n      border: 2.5px solid var(--ink);\n      box-shadow: 4px 4px 0px var(--ink);\n      padding: 9px 14px;\n      border-radius: 8px;\n      font-weight: 800;\n      font-size: 0.84rem;\n      font-family: inherit;\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n      text-decoration: none;\n      color: var(--ink);\n      background: var(--white);\n      transition: transform 0.08s ease, box-shadow 0.08s ease;\n    }\n    button:hover, .btn-link:hover { transform: translate(1.5px, 1.5px); box-shadow: 2.5px 2.5px 0px var(--ink); }\n    button:active, .btn-link:active { transform: translate(3.5px, 3.5px); box-shadow: 0px 0px 0px var(--ink); }\n    .btn-primary { background: var(--mint); }\n    .btn-blue { background: var(--sky); }\n    .btn-yellow { background: var(--yellow); }\n    .btn-pink { background: var(--pink); }\n    .btn-danger { background: var(--coral); }\n    .btn-sm { padding: 5px 10px; font-size: 0.76rem; box-shadow: 2.5px 2.5px 0px var(--ink); }\n\n    .table-wrap {\n      overflow-x: auto;\n      max-height: 460px;\n      overflow-y: auto;\n      border: 2.5px solid var(--ink);\n      border-radius: 8px;\n    }\n    table { width: 100%; border-collapse: collapse; font-size: 0.84rem; background: var(--white); }\n    th, td {\n      padding: 9px 11px;\n      border-bottom: 2px solid var(--ink);\n      border-right: 1.5px solid var(--ink);\n      text-align: left;\n    }\n    th {\n      background: var(--ink);\n      color: var(--yellow);\n      font-weight: 800;\n      text-transform: uppercase;\n      position: sticky;\n      top: 0;\n      z-index: 2;\n    }\n    tr:nth-child(even) td { background: #FFFDF5; }\n    tr:hover td { background: #FEF08A; }\n\n    .alias-chip {\n      display: inline-flex;\n      align-items: center;\n      gap: 4px;\n      background: #FEF9C3;\n      border: 1.5px solid #000;\n      padding: 2px 7px;\n      border-radius: 6px;\n      font-size: 0.75rem;\n      font-weight: 700;\n      margin: 2px;\n    }\n\n    .log-box {\n      background: #111827;\n      border: 3px solid var(--ink);\n      border-radius: 8px;\n      padding: 12px;\n      height: 210px;\n      overflow-y: auto;\n      font-family: monospace;\n      font-size: 0.8rem;\n      color: #A7F3D0;\n    }\n    .log-box div { padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.12); }\n\n    @media (max-width: 640px) {\n      body { padding: 10px; }\n      .grid { grid-template-columns: 1fr; }\n    }\n  </style>\n</head>\n<body>\n  <div class=\"container\">\n    <header>\n      <div>\n        <h1>⚡ Renata PLC (NK Depot) — CRP Order Bot v6.0</h1>\n        <p>Dynamic JSON Master DB • Multi-Chunk Cloud Backup (50K Limit Proof) • All Message Logs & Auto Row Sync</p>\n      </div>\n      <div style=\"display:flex; gap:8px; flex-wrap:wrap; align-items:center;\">\n        <span id=\"waBadge\" class=\"badge warn\">⏳ WhatsApp...</span>\n        <span id=\"sheetBadge\" class=\"badge warn\">⏳ Sheet...</span>\n        <span id=\"ramBadge\" class=\"badge info\">⚡ RAM: -- MB</span>\n        <a id=\"openSheetBtn\" href=\"#\" target=\"_blank\" class=\"btn-link btn-blue\">📊 Google Sheet ↗</a>\n      </div>\n    </header>\n\n    <div class=\"nav-tabs\">\n      <button class=\"tab-btn active\" onclick=\"switchTab('tab-control', this)\">📡 ১. বট কন্ট্রোল ও লাইভ অর্ডার</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-da', this)\">👥 ২. প্রতিনিধি ডেটাবেস (<span id=\"navDaCount\">0</span>)</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-products', this)\">💊 ৩. প্রোডাক্ট ও ভুল বানান (<span id=\"navProdCount\">0</span>)</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-groups', this)\">🧩 ৪. প্রোডাক্ট কমন গ্রুপ ও কিওয়ার্ড (<span id=\"navGrpCount\">0</span>)</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-phones', this)\">📱 ৫. অ্যাডমিন সেটিংস ও JSON ইমপোর্ট</button>\n    </div>\n\n    <div id=\"tab-control\" class=\"tab-panel active\">\n      <div class=\"stats-row\">\n        <div class=\"stat-card c1\">\n          <div class=\"lbl\">🎯 সক্রিয় গ্রুপ</div>\n          <div class=\"val\" id=\"statGroup\" style=\"font-size:1rem;\">Loading...</div>\n        </div>\n        <div class=\"stat-card c2\">\n          <div class=\"lbl\">📦 মোট সেভ অর্ডার</div>\n          <div class=\"val\" id=\"statSaved\">0</div>\n        </div>\n        <div class=\"stat-card c3\">\n          <div class=\"lbl\">💰 মোট অর্ডার (৳)</div>\n          <div class=\"val\" id=\"statAmount\">৳0.00</div>\n        </div>\n        <div class=\"stat-card c4\">\n          <div class=\"lbl\">❓ পেন্ডিং প্রশ্ন (Admin)</div>\n          <div class=\"val\" id=\"statPending\">0</div>\n        </div>\n        <div class=\"stat-card c5\">\n          <div class=\"lbl\">📲 অ্যাডমিন অ্যালার্ট নম্বর</div>\n          <div class=\"val\" id=\"statAdminPhones\" style=\"font-size:0.86rem; line-height:1.35;\">+8801793362829</div>\n        </div>\n      </div>\n\n      <div id=\"pendingCard\" class=\"card\" style=\"display:none;\">\n        <div class=\"card-header h-orange\">\n          <span>❓ অপরিচিত প্রতিনিধি (DA) ও প্রোডাক্ট প্রশ্নসমূহ (WhatsApp 01793362829 অথবা এখান থেকে উত্তর দিন)</span>\n        </div>\n        <div class=\"card-body\">\n          <div id=\"pendingListContainer\"></div>\n        </div>\n      </div>\n\n      <div class=\"grid\">\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-pink\">\n            <span>১. WhatsApp কানেকশন</span>\n            <button class=\"btn-danger btn-sm\" onclick=\"logoutWhatsApp()\">Change Account</button>\n          </div>\n          <div class=\"card-body\">\n            <div id=\"qrContainer\" class=\"qr-box\">\n              <p style=\"font-weight:700;\">Loading WhatsApp status...</p>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-mint\">\n            <span>২. WhatsApp গ্রুপ সেটিংস</span>\n            <button class=\"btn-yellow btn-sm\" onclick=\"refreshGroups()\">🔄 গ্রুপ রিফ্রেশ</button>\n          </div>\n          <div class=\"card-body\">\n            <label>আপনার WhatsApp গ্রুপ সিলেক্ট করুন:</label>\n            <select id=\"groupSelect\" onchange=\"onGroupDropdownChange()\">\n              <option value=\"ALL\">🌐 All Joined Groups (সব গ্রুপ থেকে অর্ডার নিবে)</option>\n            </select>\n            <label>অথবা নির্দিষ্ট গ্রুপের নাম:</label>\n            <input type=\"text\" id=\"targetGroupNameInput\" placeholder=\"e.g. CRP sales NK Depot\" oninput=\"onGroupNameManualInput()\" />\n            <input type=\"hidden\" id=\"targetGroupIdInput\" />\n\n            <label style=\"display:flex; align-items:center; gap:8px; margin-top:12px; cursor:pointer;\">\n              <input type=\"checkbox\" id=\"autoReactCheckbox\" style=\"width:18px; height:18px; accent-color:#000;\" checked />\n              অর্ডার সেভ হলে মেসেজে অটোমেটিক ✅ রিয়েকশন দিবে\n            </label>\n\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"saveGroupConfig()\">💾 Save Group Settings</button>\n              <button class=\"btn-blue\" onclick=\"syncSheetStructure()\">📊 Sync DB to Sheet</button>\n            </div>\n            <p id=\"saveStatusMsg\" style=\"font-size:0.84rem; font-weight:800; color:#047857; margin-top:8px;\"></p>\n            <div style=\"margin-top:10px; padding:9px 11px; background:#FEF9C3; border:2px solid #000; border-radius:8px; font-size:0.78rem; font-weight:700;\">\n              <div>📌 <b>JSON-এ সেভ থাকা গ্রুপ:</b> <span id=\"jsonSavedGroupLabel\">Loading...</span></div>\n              <div style=\"margin-top:4px;\">🆔 <b>সর্বশেষ ৫টি মেসেজ আইডি (master_db.json):</b> <span id=\"last5MsgIdsLabel\" style=\"font-family:monospace; word-break:break-all;\">None</span></div>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-sky\">\n            <span>🧪 ৩. অর্ডার ও সেলফ-লার্নিং টেস্টার</span>\n          </div>\n          <div class=\"card-body\">\n            <label>অর্ডার মেসেজ লিখে টেস্ট করুন (অপরিচিত নাম/ওষুধ দিলে 01793362829-এ প্রশ্ন পাঠাবে):</label>\n            <textarea id=\"testInput\">CF4526 Seraj\nPso t-23\nCus: Nipun pharmacy\nTotifen 50\nDoxicup 10 pes</textarea>\n            <div class=\"btn-row\">\n              <button class=\"btn-yellow\" onclick=\"runTestParse(false)\">🔍 Test Parser</button>\n              <button class=\"btn-primary\" onclick=\"runTestParse(true)\">🚀 Test & Save / Ask Admin</button>\n            </div>\n            <div id=\"testResultBox\" style=\"margin-top:10px; font-size:0.82rem; font-weight:600;\"></div>\n          </div>\n        </div>\n      </div>\n\n      <div id=\"editMsgModal\" style=\"display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:9999; padding:16px; overflow-y:auto; align-items:center; justify-content:center;\">\n        <div class=\"card\" style=\"max-width:640px; width:100%; margin:40px auto; border:3.5px solid #000; box-shadow:8px 8px 0px #000;\">\n          <div class=\"card-header h-mint\">\n            <span>✏️ মেসেজ এডিট করে Google Sheet-এ সাবমিট করুন (Edit & Submit Order)</span>\n            <button class=\"btn-danger btn-sm\" onclick=\"closeEditMsgModal()\">✖ বন্ধ করুন</button>\n          </div>\n          <div class=\"card-body\">\n            <input type=\"hidden\" id=\"editModalMsgId\" />\n            <input type=\"hidden\" id=\"editModalToken\" />\n            <div style=\"display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:10px;\">\n              <div>\n                <label style=\"margin-top:0;\">📱 প্রেরকের মোবাইল নম্বর (Sender Number):</label>\n                <input type=\"text\" id=\"editModalPhone\" placeholder=\"+88017...\" />\n              </div>\n              <div>\n                <label style=\"margin-top:0;\">👤 প্রতিনিধির ID ও নাম (যেমন: CF4526 Seraj):</label>\n                <input type=\"text\" id=\"editModalDaText\" placeholder=\"মেসেজে লেখা না থাকলে এখানে দিন (ঐচ্ছিক)\" />\n              </div>\n            </div>\n            <label>📩 সম্পূর্ণ মেসেজ (এখানে ভুল বানান, PSO কোড, ID বা পরিমাণ ঠিক করুন):</label>\n            <textarea id=\"editModalText\" style=\"min-height:150px; font-size:0.9rem; line-height:1.45;\"></textarea>\n            <div id=\"editModalStatus\" style=\"margin-top:8px; font-size:0.84rem; font-weight:800;\"></div>\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"submitEditedMessageFromWeb()\">🚀 সংশোধন করে সাবমিট ও Google Sheet-এ সেভ করুন</button>\n              <button class=\"btn-danger\" onclick=\"closeEditMsgModal()\">বাতিল</button>\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-mint\">\n          <span>📨 সব মেসেজ লগ — কোন মেসেজ সেভ হয়েছে (✅) আর কোনটি হয়নি (❌) এবং Google Sheet Row নম্বর</span>\n          <div style=\"display:flex; gap:8px; flex-wrap:wrap; align-items:center;\">\n            <select id=\"msgLogFilterSelect\" onchange=\"renderMessageLogsTable()\" style=\"width:auto; padding:5px 10px; font-size:0.78rem;\">\n              <option value=\"ALL\">📋 সব মেসেজ (All)</option>\n              <option value=\"SAVED\">✅ শুধু সেভ হওয়া (Saved)</option>\n              <option value=\"UNSAVED\">❌ সেভ না হওয়া (Not Saved)</option>\n            </select>\n            <input type=\"text\" id=\"msgLogSearchInput\" placeholder=\"🔍 মেসেজ, Row বা নম্বর খুঁজুন...\" oninput=\"renderMessageLogsTable()\" style=\"width:200px; padding:5px 10px; font-size:0.78rem;\" />\n            <button class=\"btn-yellow btn-sm\" onclick=\"syncRowsFromSheetNow()\">🔄 Row নম্বর সিঙ্ক</button>\n            <button class=\"btn-blue btn-sm\" onclick=\"openEditMsgModal('', '', '', '', '')\">➕ নতুন মেসেজ লিখে সাবমিট</button>\n          </div>\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\" style=\"max-height:480px;\">\n            <table>\n              <thead>\n                <tr>\n                  <th>স্ট্যাটাস (✅/❌)</th>\n                  <th>Google Sheet Row নং</th>\n                  <th>তারিখ ও সময়</th>\n                  <th>প্রেরকের নম্বর ও নাম</th>\n                  <th>প্রতিনিধি (DA)</th>\n                  <th>সম্পূর্ণ মেসেজ (Full Message)</th>\n                  <th>বিবরণ / নোট</th>\n                  <th>অ্যাকশন (Edit & Submit)</th>\n                </tr>\n              </thead>\n              <tbody id=\"messageLogsTableBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-yellow\">\n          <span>📋 সর্বশেষ ট্র্যাক হওয়া অর্ডারসমূহ (Live Parsed Orders)</span>\n          <button class=\"btn-danger btn-sm\" onclick=\"clearLiveOrders()\">🧹 Clear Orders List</button>\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\">\n            <table>\n              <thead>\n                <tr>\n                  <th>Sheet Row</th>\n                  <th>Date & Time</th>\n                  <th>DA ID & Name</th>\n                  <th>PSO</th>\n                  <th>Pharmacy</th>\n                  <th>Raw Text</th>\n                  <th>Product</th>\n                  <th>Qty</th>\n                  <th>TP</th>\n                  <th>Total</th>\n                  <th>Match / Edit</th>\n                </tr>\n              </thead>\n              <tbody id=\"ordersTableBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-lavender\">\n          <span>🖥️ সিস্টেম লগ (Live Server Logs)</span>\n          <button class=\"btn-danger btn-sm\" onclick=\"clearServerLogs()\">🧹 Clear Server Logs</button>\n        </div>\n        <div class=\"card-body\">\n          <div id=\"logBox\" class=\"log-box\"></div>\n        </div>\n      </div>\n    </div>\n\n    <div id=\"tab-da\" class=\"tab-panel\">\n      <div class=\"card\">\n        <div class=\"card-header h-mint\">\n          <span>➕ নতুন প্রতিনিধি (DA) যোগ করুন অথবা এডিট করুন</span>\n          <div style=\"display:flex; gap:8px;\">\n            <button class=\"btn-yellow btn-sm\" onclick=\"resetDaForm()\">🔄 Clear Form</button>\n            <button class=\"btn-blue btn-sm\" onclick=\"resetAllDasToDefault()\">♻️ ডিফল্ট ৪৬ জন রিস্টোর করুন</button>\n            <button class=\"btn-danger btn-sm\" onclick=\"deleteAllDas()\">🗑️ সব DA মুছে ফেলুন (Remove All)</button>\n          </div>\n        </div>\n        <div class=\"card-body\">\n          <input type=\"hidden\" id=\"daOriginalId\" />\n          <div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px;\">\n            <div>\n              <label>Primary DA ID (যেমন: CF4526, RF20363):</label>\n              <input type=\"text\" id=\"daIdInput\" placeholder=\"e.g. CF9988\" />\n            </div>\n            <div>\n              <label>Alt / Old ID (ঐচ্ছিক):</label>\n              <input type=\"text\" id=\"daAltIdInput\" placeholder=\"e.g. C122210\" />\n            </div>\n            <div>\n              <label>প্রতিনিধির নাম (DA Name):</label>\n              <input type=\"text\" id=\"daNameInput\" placeholder=\"e.g. Md Karim Uddin\" />\n            </div>\n            <div>\n              <label>মোবাইল নম্বর (কমা দিয়ে একাধিক দেওয়া যাবে):</label>\n              <input type=\"text\" id=\"daPhonesInput\" placeholder=\"e.g. 01711223344\" />\n            </div>\n            <div>\n              <label>ডাকনাম / Aliases (কমা দিয়ে):</label>\n              <input type=\"text\" id=\"daAliasesInput\" placeholder=\"e.g. karim, karim da\" />\n            </div>\n          </div>\n          <div class=\"btn-row\">\n            <button class=\"btn-primary\" onclick=\"saveDaRecord()\">💾 প্রতিনিধি সেভ করুন (Save DA)</button>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-yellow\">\n          <span>👥 বর্তমান প্রতিনিধি তালিকা (Total DAs: <span id=\"daTotalLabel\">0</span>)</span>\n          <input type=\"text\" id=\"daSearchInput\" placeholder=\"🔍 ID, নাম বা মোবাইল দিয়ে খুঁজুন...\" oninput=\"renderDaTable()\" style=\"max-width:280px; padding:6px 10px;\" />\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\">\n            <table>\n              <thead>\n                <tr>\n                  <th>#</th>\n                  <th>DA ID</th>\n                  <th>Alt ID</th>\n                  <th>প্রতিনিধির নাম (Name)</th>\n                  <th>মোবাইল নম্বর</th>\n                  <th>Aliases / ডাকনাম</th>\n                  <th>অ্যাকশন (Edit / Delete)</th>\n                </tr>\n              </thead>\n              <tbody id=\"daDatabaseBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n    </div>\n\n    <div id=\"tab-products\" class=\"tab-panel\">\n      <div class=\"card\">\n        <div class=\"card-header h-sky\">\n          <span>💊 নতুন প্রোডাক্ট যোগ করুন অথবা দাম ও ভুল বানান (Aliases) এডিট করুন</span>\n          <div style=\"display:flex; gap:8px;\">\n            <button class=\"btn-yellow btn-sm\" onclick=\"resetProductForm()\">🔄 Clear Form</button>\n            <button class=\"btn-blue btn-sm\" onclick=\"resetProductsToDefault()\">♻️ ডিফল্ট ৭৯টি প্রোডাক্ট রিস্টোর করুন</button>\n          </div>\n        </div>\n        <div class=\"card-body\">\n          <input type=\"hidden\" id=\"prodOriginalCode\" />\n          <div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:12px;\">\n            <div>\n              <label>CRP Code (যেমন: 919, CS7):</label>\n              <input type=\"text\" id=\"prodCodeInput\" placeholder=\"e.g. 919\" />\n            </div>\n            <div>\n              <label>প্রোডাক্টের নাম (Official Name):</label>\n              <input type=\"text\" id=\"prodNameInput\" placeholder=\"e.g. TOTIFEN SYRUP 100ML\" />\n            </div>\n            <div>\n              <label>প্যাক সাইজ (Pack Unit):</label>\n              <input type=\"text\" id=\"prodUnitInput\" placeholder=\"e.g. Bottle (100ml)\" />\n            </div>\n            <div>\n              <label>Trade Price (৳ দর):</label>\n              <input type=\"number\" step=\"0.01\" id=\"prodPriceInput\" placeholder=\"e.g. 47.23\" />\n            </div>\n            <div>\n              <label>Brand Family / গ্রুপ নাম (ঐচ্ছিক):</label>\n              <input type=\"text\" id=\"prodFamilyInput\" placeholder=\"e.g. LUCAN-R, TOTIFEN\" />\n            </div>\n          </div>\n          <label>ভুল বানান লিস্ট / Aliases (কমা দিয়ে লিখুন — যেকোনো বানান লিখলেই এই প্রোডাক্ট চিনে নেবে):</label>\n          <input type=\"text\" id=\"prodAliasesInput\" placeholder=\"e.g. totifen, totipen, totifin, toti syp, totifen 100\" />\n          <div class=\"btn-row\">\n            <button class=\"btn-primary\" onclick=\"saveProductRecord()\">💾 প্রোডাক্ট ও বানান সেভ করুন (Save Product)</button>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-pink\">\n          <span>💊 সব প্রোডাক্ট ও ভুল বানান ডেটাবেস (Total: <span id=\"prodTotalLabel\">0</span>)</span>\n          <input type=\"text\" id=\"prodSearchInput\" placeholder=\"🔍 প্রোডাক্টের নাম, কোড বা ভুল বানান খুঁজুন...\" oninput=\"renderProductTable()\" style=\"max-width:300px; padding:6px 10px;\" />\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\">\n            <table>\n              <thead>\n                <tr>\n                  <th>Code</th>\n                  <th>প্রোডাক্টের নাম ও প্যাক</th>\n                  <th>Trade Price (৳)</th>\n                  <th>ভুল বানান সমূহ (Recognized Wrong Spellings / Aliases)</th>\n                  <th>নতুন বানান যোগ</th>\n                  <th>অ্যাকশন</th>\n                </tr>\n              </thead>\n              <tbody id=\"productDatabaseBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n    </div>\n\n    <div id=\"tab-groups\" class=\"tab-panel\">\n      <div class=\"card\">\n        <div class=\"card-header h-yellow\">\n          <span>🧩 প্রোডাক্ট কমন গ্রুপ ও কিওয়ার্ড ম্যানেজার (Total Groups: <span id=\"grpTotalLabel\">0</span>)</span>\n          <div style=\"display:flex; gap:8px; flex-wrap:wrap;\">\n            <input type=\"text\" id=\"newGroupNameInput\" placeholder=\"গ্রুপ নাম (e.g. LUCAN-R)\" style=\"max-width:170px; padding:6px 10px;\" />\n            <input type=\"text\" id=\"newGroupKeywordsInput\" placeholder=\"কমন কিওয়ার্ড (e.g. lucanr, luen, luncanr)\" style=\"max-width:260px; padding:6px 10px;\" />\n            <button class=\"btn-primary btn-sm\" onclick=\"saveBrandGroup()\">💾 গ্রুপ সেভ করুন</button>\n            <button class=\"btn-blue btn-sm\" onclick=\"resetBrandGroupsToDefault()\">♻️ ডিফল্ট গ্রুপ রিস্টোর</button>\n          </div>\n        </div>\n        <div class=\"card-body\">\n          <p style=\"font-size:0.85rem; font-weight:700; margin-bottom:12px;\">\n            💡 <b>কীভাবে কাজ করে:</b> একই নামের একাধিক প্রোডাক্ট (যেমন: <code>LUCAN-R 200</code>, <code>LUCAN-R 150</code>, <code>LUCAN-R 50</code>, <code>LUCAN-R SYP</code>) একই গ্রুপে থাকে। কোনো একটি ভ্যারিয়েন্টের জন্য নতুন বানান (যেমন: <code>luen 200</code> বা <code>luncanr 200</code>) শেখালে কমন নাম <code>luen</code> / <code>luncanr</code> অটোমেটিক এই গ্রুপে যুক্ত হয়ে যায়—ফলে পরবর্তীতে কেউ <code>luen 150</code>, <code>luen 50</code> বা <code>luen syp</code> লিখলেও বট নিজে থেকেই চিনে সঠিক প্রোডাক্টটি Google Sheet-এ যোগ করবে!\n          </p>\n          <div style=\"margin-bottom:12px;\">\n            <input type=\"text\" id=\"groupSearchInput\" placeholder=\"🔍 গ্রুপের নাম, প্রোডাক্ট বা কমন কিওয়ার্ড দিয়ে খুঁজুন...\" oninput=\"renderProductGroupsTable()\" style=\"max-width:360px;\" />\n          </div>\n          <div class=\"table-wrap\" style=\"max-height:520px;\">\n            <table>\n              <thead>\n                <tr>\n                  <th>Group Name (কমন নাম)</th>\n                  <th>গ্রুপের প্রোডাক্টসমূহ (Variants & Trade Price)</th>\n                  <th>কমন কিওয়ার্ড / ভুল বানান (Shared Keywords)</th>\n                  <th>নতুন কমন কিওয়ার্ড যোগ</th>\n                  <th>অ্যাকশন</th>\n                </tr>\n              </thead>\n              <tbody id=\"productGroupsBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n    </div>\n\n    <div id=\"tab-phones\" class=\"tab-panel\">\n      <div class=\"grid\">\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-yellow\">\n            <span>📲 ১. অ্যাডমিন অ্যালার্ট ও রিপ্লাই নম্বরসমূহ (Multiple Admin Numbers)</span>\n          </div>\n          <div class=\"card-body\">\n            <p style=\"font-size:0.86rem; font-weight:600; margin-bottom:10px;\">\n              কোনো অর্ডারে <b>অপরিচিত DA ID/নাম</b> অথবা <b>অপরিচিত ওষুধের বানান</b> পাওয়া গেলে বট নিচের নম্বরগুলোতে WhatsApp মেসেজ পাঠিয়ে জিজ্ঞেস করবে এবং এই নম্বরগুলো থেকে Reply দিলে অটোমেটিক ডেটাবেসে যুক্ত হয়ে যাবে:\n            </p>\n            <label>অ্যাডমিন নম্বরসমূহ (কমা দিয়ে একাধিক নম্বর যোগ করুন):</label>\n            <input type=\"text\" id=\"adminAlertPhonesInput\" placeholder=\"8801793362829, 8801732273944\" />\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"savePhoneSettings()\">💾 অ্যাডমিন নম্বর সেভ করুন</button>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-mint\">\n            <span>📸 ২. ছবির অর্ডার অনুমোদিত নম্বরসমূহ (Authorized Image Senders)</span>\n          </div>\n          <div class=\"card-body\">\n            <p style=\"font-size:0.86rem; font-weight:600; margin-bottom:10px;\">\n              খাতায় লিখে ছবি তুলে পাঠালে শুধুমাত্র নিচের নম্বরগুলো থেকে বট ছবির অর্ডার রিড করবে (কমা দিয়ে যতখুশি নম্বর যোগ বা রিমুভ করতে পারবেন):\n            </p>\n            <label>ছবির অর্ডারের অনুমোদিত নম্বরসমূহ (কমা দিয়ে):</label>\n            <input type=\"text\" id=\"authImagePhonesInput\" placeholder=\"8801732273944, 8801793362829\" />\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"savePhoneSettings()\">💾 ছবির অনুমোদিত নম্বর সেভ করুন</button>\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-lavender\">\n          <span>📂 ৩. ডাটাবেস JSON ফাইল ইমপোর্ট ও ব্যাকআপ (Import / Export Master DB JSON)</span>\n          <a href=\"/api/master-db/export\" class=\"btn-link btn-blue btn-sm\">📥 বর্তমান ডাটাবেস ডাউনলোড (.json)</a>\n        </div>\n        <div class=\"card-body\">\n          <div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:16px; align-items:start;\">\n            <div style=\"border:2.5px dashed #000; background:#FEF9C3; padding:14px; border-radius:10px;\">\n              <label style=\"margin-top:0;\">📁 ১. আপনার কম্পিউটার বা মোবাইল থেকে JSON ফাইল সিলেক্ট করুন:</label>\n              <input type=\"file\" id=\"jsonImportFileInput\" accept=\".json,application/json\" onchange=\"handleJsonFileSelect(this)\" style=\"margin-top:6px; padding:8px; background:#fff; border:2px solid #000; border-radius:8px; width:100%; font-weight:700; cursor:pointer;\" />\n              <div id=\"jsonFileSummary\" style=\"margin-top:8px; font-size:0.82rem; font-weight:800; color:#047857;\"></div>\n\n              <label style=\"margin-top:12px;\">⚙️ ইমপোর্ট মোড (Import Mode):</label>\n              <select id=\"jsonImportModeSelect\">\n                <option value=\"merge\">➕ আগের ডাটার সাথে মার্জ করুন (Merge — আগের ও নতুন সব থাকবে)</option>\n                <option value=\"replace\">🔄 পুরো ডাটাবেস রিপ্লেস করুন (Replace — ফাইলের ডাটা সেট হবে)</option>\n              </select>\n\n              <div class=\"btn-row\">\n                <button class=\"btn-primary\" onclick=\"importMasterDbJson()\">📤 JSON ডাটাবেস ইমপোর্ট করুন</button>\n                <a href=\"/api/master-db/export\" class=\"btn-link btn-blue\">⬇ Download master_db.json</a>\n              </div>\n              <div id=\"jsonImportStatusMsg\" style=\"margin-top:10px; font-size:0.85rem; font-weight:800;\"></div>\n            </div>\n\n            <div>\n              <label style=\"margin-top:0;\">📝 ২. ফাইল প্রিভিউ অথবা সরাসরি JSON কোড পেস্ট করুন (ঐচ্ছিক):</label>\n              <textarea id=\"jsonImportTextInput\" placeholder='{\"das\": [...], \"products\": [...], \"productGroups\": [...]}' style=\"min-height:165px; font-size:0.78rem;\"></textarea>\n            </div>\n          </div>\n        </div>\n      </div>\n    </div>\n\n  </div>\n\n  <script>\n    let masterData = { das: [], products: [], adminAlertPhones: [], authorizedImagePhones: [], pendingResolutions: [] };\n    let groupInputTouched = false;\n    let lastGroupsCount = -1;\n\n    function switchTab(tabId, btnEl) {\n      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));\n      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));\n      document.getElementById(tabId).classList.add('active');\n      btnEl.classList.add('active');\n      if (tabId !== 'tab-control') {\n        loadMasterDb();\n      }\n    }\n\n    function esc(s) {\n      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n    }\n\n    function onGroupNameManualInput() {\n      groupInputTouched = true;\n      document.getElementById('targetGroupIdInput').value = '';\n    }\n\n    async function loadMasterDb() {\n      try {\n        const res = await fetch('/api/master-db');\n        const data = await res.json();\n        if (data.ok) {\n          masterData = data;\n          document.getElementById('navDaCount').textContent = (data.das || []).length;\n          document.getElementById('navProdCount').textContent = (data.products || []).length;\n          const navGrp = document.getElementById('navGrpCount');\n          if (navGrp) navGrp.textContent = (data.productGroups || []).length;\n          document.getElementById('adminAlertPhonesInput').value = (data.adminAlertPhones || []).join(', ');\n          document.getElementById('authImagePhonesInput').value = (data.authorizedImagePhones || []).join(', ');\n          renderDaTable();\n          renderProductTable();\n          renderProductGroupsTable();\n        }\n      } catch (e) {}\n    }\n\n    function renderDaTable() {\n      const q = (document.getElementById('daSearchInput')?.value || '').trim().toLowerCase();\n      const list = (masterData.das || []).filter((d) => {\n        if (!q) return true;\n        return `${d.daId} ${d.altId} ${d.name} ${(d.phones || []).join(' ')} ${(d.aliases || []).join(' ')}`.toLowerCase().includes(q);\n      });\n\n      document.getElementById('daTotalLabel').textContent = list.length;\n      const tbody = document.getElementById('daDatabaseBody');\n      if (list.length === 0) {\n        tbody.innerHTML = '<tr><td colspan=\"7\" style=\"text-align:center; font-weight:700;\">কোনো প্রতিনিধি পাওয়া যায়নি।</td></tr>';\n        return;\n      }\n\n      tbody.innerHTML = list.map((d, idx) => `\n        <tr>\n          <td><b>#${idx + 1}</b></td>\n          <td><span class=\"badge info\">${esc(d.daId)}</span></td>\n          <td>${esc(d.altId || '-')}</td>\n          <td><b>${esc(d.name)}</b></td>\n          <td>${esc((d.phones || []).join(', ') || '-')}</td>\n          <td>${(d.aliases || []).map((a) => `<span class=\"alias-chip\">${esc(a)}</span>`).join(' ')}</td>\n          <td style=\"white-space:nowrap;\">\n            <button class=\"btn-blue btn-sm\" onclick=\"editDa('${esc(d.daId)}')\">✏️ Edit</button>\n            <button class=\"btn-danger btn-sm\" onclick=\"deleteSingleDa('${esc(d.daId)}')\">🗑️ Delete</button>\n          </td>\n        </tr>\n      `).join('');\n    }\n\n    function editDa(daId) {\n      const d = (masterData.das || []).find((x) => x.daId === daId);\n      if (!d) return;\n      document.getElementById('daOriginalId').value = d.daId;\n      document.getElementById('daIdInput').value = d.daId;\n      document.getElementById('daAltIdInput').value = d.altId || '';\n      document.getElementById('daNameInput').value = d.name || '';\n      document.getElementById('daPhonesInput').value = (d.phones || []).join(', ');\n      document.getElementById('daAliasesInput').value = (d.aliases || []).join(', ');\n      window.scrollTo({ top: 0, behavior: 'smooth' });\n    }\n\n    function resetDaForm() {\n      document.getElementById('daOriginalId').value = '';\n      document.getElementById('daIdInput').value = '';\n      document.getElementById('daAltIdInput').value = '';\n      document.getElementById('daNameInput').value = '';\n      document.getElementById('daPhonesInput').value = '';\n      document.getElementById('daAliasesInput').value = '';\n    }\n\n    async function saveDaRecord() {\n      const originalDaId = document.getElementById('daOriginalId').value;\n      const daId = document.getElementById('daIdInput').value;\n      const altId = document.getElementById('daAltIdInput').value;\n      const name = document.getElementById('daNameInput').value;\n      const phones = document.getElementById('daPhonesInput').value;\n      const aliases = document.getElementById('daAliasesInput').value;\n\n      const res = await fetch('/api/da/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ originalDaId, daId, altId, name, phones, aliases })\n      });\n      const data = await res.json();\n      if (!data.ok) {\n        alert(data.error || 'Error saving DA');\n        return;\n      }\n      resetDaForm();\n      await loadMasterDb();\n    }\n\n    async function deleteSingleDa(daId) {\n      if (!confirm(`আপনি কি নিশ্চিত যে [${daId}] প্রতিনিধিটি মুছে ফেলতে চান?`)) return;\n      await fetch('/api/da/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ daId })\n      });\n      await loadMasterDb();\n    }\n\n    async function deleteAllDas() {\n      if (!confirm('সতর্কবার্তা: আপনি কি ডেটাবেস থেকে সব প্রতিনিধি (All DAs) মুছে ফেলতে চান?')) return;\n      await fetch('/api/da/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ deleteAll: true })\n      });\n      await loadMasterDb();\n    }\n\n    async function resetAllDasToDefault() {\n      if (!confirm('ডিফল্ট ৪৬ জন প্রতিনিধির তালিকা রিস্টোর করতে চান?')) return;\n      await fetch('/api/da/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ resetDefault: true })\n      });\n      await loadMasterDb();\n    }\n\n    function renderProductGroupsTable() {\n      const q = (document.getElementById('groupSearchInput')?.value || '').trim().toLowerCase();\n      const allGroups = masterData.productGroups || [];\n      const prods = masterData.products || [];\n      const navGrp = document.getElementById('navGrpCount');\n      if (navGrp) navGrp.textContent = allGroups.length;\n      const groups = allGroups.filter((g) => {\n        if (!q) return true;\n        const members = prods.filter((p) => String(p.family || '').toUpperCase() === g.groupName.toUpperCase());\n        const memberNames = members.map((m) => `${m.code} ${m.name}`).join(' ');\n        return `${g.groupName} ${(g.keywords || []).join(' ')} ${memberNames}`.toLowerCase().includes(q);\n      });\n      const lbl = document.getElementById('grpTotalLabel');\n      if (lbl) lbl.textContent = groups.length;\n      const tbody = document.getElementById('productGroupsBody');\n      if (!tbody) return;\n      if (groups.length === 0) {\n        tbody.innerHTML = '<tr><td colspan=\"5\" style=\"text-align:center; font-weight:700;\">কোনো গ্রুপ নেই।</td></tr>';\n        return;\n      }\n      tbody.innerHTML = groups.map((g) => {\n        const members = prods.filter((p) => String(p.family || '').toUpperCase() === g.groupName.toUpperCase());\n        return `\n          <tr>\n            <td><span class=\"badge ok\">${esc(g.groupName)}</span></td>\n            <td style=\"font-size:0.78rem;\">\n              ${members.map((m) => `<div><b>[${esc(m.code)}]</b> ${esc(m.name)} (৳${Number(m.price).toFixed(2)})</div>`).join('') || '—'}\n            </td>\n            <td>\n              ${(g.keywords || []).map((kw) => `\n                <span class=\"alias-chip\">\n                  ${esc(kw)}\n                  <span style=\"cursor:pointer; color:#b91c1c; font-weight:900;\" onclick=\"modifyGroupKeyword('${esc(g.groupName)}', '${esc(kw)}', 'remove')\">×</span>\n                </span>\n              `).join('')}\n            </td>\n            <td>\n              <div style=\"display:flex; gap:4px; min-width:150px;\">\n                <input type=\"text\" id=\"grpKw_${esc(g.groupName)}\" placeholder=\"কমন বানান...\" style=\"padding:4px 8px; font-size:0.78rem;\" />\n                <button class=\"btn-primary btn-sm\" onclick=\"quickAddGroupKw('${esc(g.groupName)}')\">+ যোগ</button>\n              </div>\n            </td>\n            <td style=\"white-space:nowrap;\">\n              <button class=\"btn-blue btn-sm\" onclick=\"editBrandGroup('${esc(g.groupName)}')\">✏️</button>\n              <button class=\"btn-danger btn-sm\" onclick=\"deleteBrandGroup('${esc(g.groupName)}')\">🗑️</button>\n            </td>\n          </tr>\n        `;\n      }).join('');\n    }\n\n    function editBrandGroup(groupName) {\n      const g = (masterData.productGroups || []).find((x) => x.groupName === groupName);\n      if (!g) return;\n      document.getElementById('newGroupNameInput').value = g.groupName;\n      document.getElementById('newGroupKeywordsInput').value = (g.keywords || []).join(', ');\n    }\n\n    async function saveBrandGroup() {\n      const groupName = document.getElementById('newGroupNameInput').value;\n      const keywords = document.getElementById('newGroupKeywordsInput').value;\n      if (!groupName.trim()) return alert('গ্রুপের নাম দিন');\n      await fetch('/api/product-group/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ groupName, keywords })\n      });\n      document.getElementById('newGroupNameInput').value = '';\n      document.getElementById('newGroupKeywordsInput').value = '';\n      await loadMasterDb();\n    }\n\n    async function quickAddGroupKw(groupName) {\n      const inp = document.getElementById('grpKw_' + groupName);\n      if (!inp || !inp.value.trim()) return;\n      await modifyGroupKeyword(groupName, inp.value.trim(), 'add');\n      inp.value = '';\n    }\n\n    async function modifyGroupKeyword(groupName, keyword, action) {\n      await fetch('/api/product-group/keyword', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ groupName, keyword, action })\n      });\n      await loadMasterDb();\n    }\n\n    async function deleteBrandGroup(groupName) {\n      if (!confirm(`আপনি কি [${groupName}] গ্রুপটি মুছে ফেলতে চান?`)) return;\n      await fetch('/api/product-group/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ groupName })\n      });\n      await loadMasterDb();\n    }\n\n    async function resetBrandGroupsToDefault() {\n      if (!confirm('সব প্রোডাক্টের কমন ব্র্যান্ড গ্রুপ ডিফল্ট অবস্থায় রিস্টোর করতে চান?')) return;\n      await fetch('/api/product-group/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ resetDefault: true })\n      });\n      await loadMasterDb();\n    }\n\n    function handleJsonFileSelect(inputEl) {\n      const file = inputEl?.files?.[0];\n      const summaryEl = document.getElementById('jsonFileSummary');\n      if (!file) return;\n      const reader = new FileReader();\n      reader.onload = (ev) => {\n        const content = String(ev.target?.result || '').trim();\n        document.getElementById('jsonImportTextInput').value = content;\n        try {\n          const parsed = JSON.parse(content);\n          const dCount = Array.isArray(parsed.das) ? parsed.das.length : 0;\n          const pCount = Array.isArray(parsed.products) ? parsed.products.length : 0;\n          const gCount = Array.isArray(parsed.productGroups) ? parsed.productGroups.length : 0;\n          summaryEl.style.color = '#047857';\n          summaryEl.textContent = `✅ ফাইল লোড হয়েছে (${file.name}): প্রতিনিধি ${dCount} জন, প্রোডাক্ট ${pCount} টি` + (gCount ? `, গ্রুপ ${gCount} টি` : '');\n        } catch (err) {\n          summaryEl.style.color = '#b91c1c';\n          summaryEl.textContent = '⚠️ ফাইলটি সঠিক JSON ফরম্যাটে নেই: ' + err.message;\n        }\n      };\n      reader.readAsText(file, 'UTF-8');\n    }\n\n    async function importMasterDbJson() {\n      const rawText = (document.getElementById('jsonImportTextInput')?.value || '').trim();\n      const mode = document.getElementById('jsonImportModeSelect')?.value || 'merge';\n      const statusEl = document.getElementById('jsonImportStatusMsg');\n      if (!rawText) {\n        alert('অনুগ্রহ করে প্রথমে একটি .json ফাইল সিলেক্ট করুন অথবা টেক্সট বক্সে JSON পেস্ট করুন।');\n        return;\n      }\n      let parsedJson = null;\n      try {\n        parsedJson = JSON.parse(rawText);\n      } catch (err) {\n        alert('JSON ফরম্যাট সঠিক নয়: ' + err.message);\n        return;\n      }\n\n      if (mode === 'replace' && !confirm('সতর্কবার্তা: আপনি কি বর্তমান ডাটাবেস সম্পূর্ণ রিপ্লেস করে ফাইলের ডাটা বসাতে চান?')) {\n        return;\n      }\n\n      statusEl.style.color = '#1d4ed8';\n      statusEl.textContent = '⏳ JSON ডাটাবেস ইমপোর্ট হচ্ছে...';\n\n      try {\n        const res = await fetch('/api/master-db/import', {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify({ mode, dbData: parsedJson })\n        });\n        const data = await res.json();\n        if (!data.ok) {\n          statusEl.style.color = '#b91c1c';\n          statusEl.textContent = '❌ ' + (data.error || 'Import failed');\n          alert(data.error || 'Import failed');\n          return;\n        }\n        statusEl.style.color = '#047857';\n        statusEl.textContent = data.message || '✅ সফলভাবে ইমপোর্ট হয়েছে!';\n        alert(data.message || '✅ JSON ডাটাবেস সফলভাবে ইমপোর্ট হয়েছে!');\n        await loadMasterDb();\n        await fetchStatus();\n      } catch (e) {\n        statusEl.style.color = '#b91c1c';\n        statusEl.textContent = '❌ Error: ' + e.message;\n      }\n    }\n\n    function renderProductTable() {\n      const q = (document.getElementById('prodSearchInput')?.value || '').trim().toLowerCase();\n      const list = (masterData.products || []).filter((p) => {\n        if (!q) return true;\n        return `${p.code} ${p.name} ${p.unit} ${(p.aliases || []).join(' ')}`.toLowerCase().includes(q);\n      });\n\n      document.getElementById('prodTotalLabel').textContent = list.length;\n      const tbody = document.getElementById('productDatabaseBody');\n      if (list.length === 0) {\n        tbody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center; font-weight:700;\">কোনো প্রোডাক্ট পাওয়া যায়নি।</td></tr>';\n        return;\n      }\n\n      tbody.innerHTML = list.map((p) => `\n        <tr>\n          <td><span class=\"badge warn\">${esc(p.code)}</span></td>\n          <td><b>${esc(p.name)}</b><br/><span style=\"font-size:0.76rem;\">${esc(p.unit)}</span></td>\n          <td style=\"font-weight:800;\">৳${Number(p.price || 0).toFixed(2)}</td>\n          <td>\n            ${(p.aliases || []).map((a) => `\n              <span class=\"alias-chip\">\n                ${esc(a)}\n                <span style=\"cursor:pointer; color:#b91c1c; font-weight:900;\" onclick=\"modifyProductAlias('${esc(p.code)}', '${esc(a)}', 'remove')\" title=\"মুছুন\">×</span>\n              </span>\n            `).join('')}\n          </td>\n          <td>\n            <div style=\"display:flex; gap:4px; min-width:160px;\">\n              <input type=\"text\" id=\"quickAlias_${esc(p.code)}\" placeholder=\"ভুল বানান লিখুন...\" style=\"padding:4px 8px; font-size:0.78rem;\" />\n              <button class=\"btn-primary btn-sm\" onclick=\"quickAddAlias('${esc(p.code)}')\">+ যোগ</button>\n            </div>\n          </td>\n          <td style=\"white-space:nowrap;\">\n            <button class=\"btn-blue btn-sm\" onclick=\"editProduct('${esc(p.code)}')\">✏️ Edit</button>\n            <button class=\"btn-danger btn-sm\" onclick=\"deleteSingleProduct('${esc(p.code)}')\">🗑️</button>\n          </td>\n        </tr>\n      `).join('');\n    }\n\n    function editProduct(code) {\n      const p = (masterData.products || []).find((x) => String(x.code) === String(code));\n      if (!p) return;\n      document.getElementById('prodOriginalCode').value = p.code;\n      document.getElementById('prodCodeInput').value = p.code;\n      document.getElementById('prodNameInput').value = p.name;\n      document.getElementById('prodUnitInput').value = p.unit || '';\n      document.getElementById('prodPriceInput').value = p.price || 0;\n      document.getElementById('prodFamilyInput').value = p.family || '';\n      document.getElementById('prodAliasesInput').value = (p.aliases || []).join(', ');\n      window.scrollTo({ top: 0, behavior: 'smooth' });\n    }\n\n    function resetProductForm() {\n      document.getElementById('prodOriginalCode').value = '';\n      document.getElementById('prodCodeInput').value = '';\n      document.getElementById('prodNameInput').value = '';\n      document.getElementById('prodUnitInput').value = '';\n      document.getElementById('prodPriceInput').value = '';\n      document.getElementById('prodFamilyInput').value = '';\n      document.getElementById('prodAliasesInput').value = '';\n    }\n\n    async function saveProductRecord() {\n      const originalCode = document.getElementById('prodOriginalCode').value;\n      const code = document.getElementById('prodCodeInput').value;\n      const name = document.getElementById('prodNameInput').value;\n      const unit = document.getElementById('prodUnitInput').value;\n      const price = document.getElementById('prodPriceInput').value;\n      const family = document.getElementById('prodFamilyInput').value;\n      const aliases = document.getElementById('prodAliasesInput').value;\n\n      const res = await fetch('/api/product/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ originalCode, code, name, unit, price, family, aliases })\n      });\n      const data = await res.json();\n      if (!data.ok) {\n        alert(data.error || 'Error saving product');\n        return;\n      }\n      resetProductForm();\n      await loadMasterDb();\n    }\n\n    async function quickAddAlias(code) {\n      const inp = document.getElementById('quickAlias_' + code);\n      if (!inp || !inp.value.trim()) return;\n      await modifyProductAlias(code, inp.value.trim(), 'add');\n      inp.value = '';\n    }\n\n    async function modifyProductAlias(code, alias, action) {\n      await fetch('/api/product/alias', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ code, alias, action })\n      });\n      await loadMasterDb();\n    }\n\n    async function deleteSingleProduct(code) {\n      if (!confirm(`আপনি কি [${code}] প্রোডাক্টটি মুছে ফেলতে চান?`)) return;\n      await fetch('/api/product/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ code })\n      });\n      await loadMasterDb();\n    }\n\n    async function resetProductsToDefault() {\n      if (!confirm('ডিফল্ট ৭৯টি প্রোডাক্ট এবং অফিশিয়াল Trade Price রিস্টোর করতে চান?')) return;\n      await fetch('/api/product/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ resetDefault: true })\n      });\n      await loadMasterDb();\n    }\n\n    async function savePhoneSettings() {\n      const adminAlertPhones = document.getElementById('adminAlertPhonesInput').value;\n      const authorizedImagePhones = document.getElementById('authImagePhonesInput').value;\n      const res = await fetch('/api/phones/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ adminAlertPhones, authorizedImagePhones })\n      });\n      const data = await res.json();\n      if (data.ok) {\n        alert('✅ নম্বরগুলো সফলভাবে সেভ হয়েছে!');\n        await loadMasterDb();\n        await fetchStatus();\n      }\n    }\n\n    async function resolvePendingFromWeb(token, customAnswer) {\n      const ans = customAnswer !== undefined ? customAnswer : document.getElementById('pendingAns_' + token)?.value;\n      if (!ans || !ans.trim()) return;\n      const res = await fetch('/api/pending/resolve', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ token, answer: ans })\n      });\n      const data = await res.json();\n      alert(data.message || 'Done');\n      await fetchStatus();\n      await loadMasterDb();\n    }\n\n    async function fetchStatus() {\n      try {\n        const res = await fetch('/api/status');\n        const data = await res.json();\n\n        document.getElementById('navDaCount').textContent = data.daCount || 0;\n        document.getElementById('navProdCount').textContent = data.productCount || 0;\n\n        const waBadge = document.getElementById('waBadge');\n        if (data.waStatus === 'CONNECTED') {\n          waBadge.className = 'badge ok';\n          waBadge.textContent = '🟢 WhatsApp Connected';\n        } else if (data.waStatus === 'QR_READY') {\n          waBadge.className = 'badge warn';\n          waBadge.textContent = '📲 Scan QR Code';\n        } else {\n          waBadge.className = 'badge err';\n          waBadge.textContent = '⏳ ' + data.waStatus;\n        }\n\n        const sheetBadge = document.getElementById('sheetBadge');\n        if (data.googleAuthReady) {\n          sheetBadge.className = 'badge ok';\n          sheetBadge.textContent = '🟢 Sheet Connected';\n        } else {\n          sheetBadge.className = 'badge err';\n          sheetBadge.textContent = '⚠️ Sheet Auth Needed';\n        }\n\n        document.getElementById('ramBadge').textContent = '⚡ RAM: ' + (data.memoryMB || 0) + ' MB';\n        document.getElementById('openSheetBtn').href = data.googleSheetUrl;\n\n        document.getElementById('statGroup').textContent =\n          data.botConfig.targetGroupName || data.botConfig.targetGroupId || 'All Joined Groups';\n        document.getElementById('statSaved').textContent = data.stats.totalOrdersSaved;\n        document.getElementById('statAmount').textContent =\n          '৳' + Number(data.stats.totalAmountSaved || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\n\n        const pendings = data.pendingResolutions || [];\n        document.getElementById('statPending').textContent = pendings.length;\n        document.getElementById('statAdminPhones').innerHTML = (data.adminAlertPhones || []).join('<br/>');\n\n        window.latestPendingItems = pendings;\n        window.latestMessageLogs = data.messageLogs || [];\n        renderMessageLogsTable();\n\n        const pCard = document.getElementById('pendingCard');\n        const pList = document.getElementById('pendingListContainer');\n        const activeTag = document.activeElement ? document.activeElement.id || '' : '';\n        if (pendings.length > 0) {\n          pCard.style.display = 'block';\n          if (!activeTag.startsWith('pendingAns_')) {\n            pList.innerHTML = pendings.map((p, idx) => {\n              const phoneLabel = (p.displayPhone && p.displayPhone !== '-' ? p.displayPhone : (p.senderPhone || 'Unknown')) + (p.senderPushName ? ' (' + p.senderPushName + ')' : '');\n              const fullMsg = p.rawText || p.rawLine || '';\n              if (p.type === 'UNKNOWN_DA') {\n                return `\n                  <div style=\"border:2.5px solid #000; background:#FEF9C3; padding:12px; border-radius:8px; margin-bottom:10px;\">\n                    <div style=\"display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;\">\n                      <b>${esc(p.token)} — অপরিচিত প্রতিনিধি (Unknown DA) ${p.detectedDaId ? `[শনাক্তকৃত ID: ${esc(p.detectedDaId)}]` : ''}</b>\n                      <span class=\"badge info\">📱 প্রেরকের নম্বর: ${esc(phoneLabel)}</span>\n                    </div>\n                    <div style=\"font-size:0.84rem; margin:6px 0;\">💊 <b>শনাক্তকৃত অর্ডার:</b> ${esc((p.orders || []).map((o) => o.productName + ' (' + o.orderedQty + ')').join(', ') || 'প্রোডাক্ট লিস্ট নিচে দেখুন')}</div>\n                    <div style=\"font-size:0.8rem; font-weight:700; margin-top:4px;\">📩 সম্পূর্ণ মেসেজ (Full Message):</div>\n                    <div style=\"white-space:pre-wrap; background:#FFFDF7; border:2px solid #000; padding:8px 10px; border-radius:6px; font-family:monospace; font-size:0.82rem; margin:4px 0 8px 0;\">${esc(fullMsg)}</div>\n                    <div style=\"display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center;\">\n                      <input type=\"text\" id=\"pendingAns_${esc(p.token)}\" placeholder=\"ID ও নাম লিখুন (যেমন: CF4526 Seraj)\" style=\"max-width:300px;\" />\n                      <button class=\"btn-primary btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}')\">✅ ID/নাম সেভ করুন</button>\n                      <button class=\"btn-blue btn-sm\" onclick=\"openEditPendingByIdx(${idx})\">✏️ মেসেজ এডিট ও সাবমিট</button>\n                      <button class=\"btn-danger btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}', '/cnl')\">🗑️ বাতিল</button>\n                    </div>\n                  </div>\n                `;\n              } else {\n                return `\n                  <div style=\"border:2.5px solid #000; background:#E0F2FE; padding:12px; border-radius:8px; margin-bottom:10px;\">\n                    <div style=\"display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;\">\n                      <b>${esc(p.token)} — অপরিচিত প্রোডাক্ট/বানান: \"${esc(p.unknownProductText)}\" (পরিমাণ: ${esc(p.orderedQty)})</b>\n                      <span class=\"badge info\">📱 প্রেরকের নম্বর: ${esc(phoneLabel)}</span>\n                    </div>\n                    <div style=\"font-size:0.84rem; margin:6px 0;\">👤 <b>প্রতিনিধি:</b> ${esc(p.daInfo?.name)} (${esc(p.daInfo?.daId)}) | <b>অপরিচিত লাইন:</b> \"${esc(p.rawLine)}\"</div>\n                    <div style=\"font-size:0.8rem; font-weight:700; margin-top:4px;\">📩 সম্পূর্ণ মেসেজ (Full Message):</div>\n                    <div style=\"white-space:pre-wrap; background:#FFFDF7; border:2px solid #000; padding:8px 10px; border-radius:6px; font-family:monospace; font-size:0.82rem; margin:4px 0 8px 0;\">${esc(fullMsg)}</div>\n                    <div style=\"display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center;\">\n                      <input type=\"text\" id=\"pendingAns_${esc(p.token)}\" placeholder=\"সঠিক প্রোডাক্টের নাম বা কোড (যেমন: Totifen বা 919)\" style=\"max-width:320px;\" />\n                      <button class=\"btn-primary btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}')\">🧠 বানান শেখান ও সেভ করুন</button>\n                      <button class=\"btn-blue btn-sm\" onclick=\"openEditPendingByIdx(${idx})\">✏️ মেসেজ এডিট ও সাবমিট</button>\n                      <button class=\"btn-danger btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}', 'skip')\">🗑️ বাদ দিন</button>\n                    </div>\n                  </div>\n                `;\n              }\n            }).join('');\n          }\n        } else {\n          pCard.style.display = 'none';\n        }\n\n        const qrBox = document.getElementById('qrContainer');\n        if (data.waStatus === 'CONNECTED' && data.connectedUser) {\n          qrBox.innerHTML =\n            '<div style=\"font-size:2.4rem; margin-bottom:4px;\">✅</div>' +\n            '<h3 style=\"font-weight:800;\">WhatsApp সচল আছে!</h3>' +\n            '<p style=\"font-size:0.86rem; font-weight:700; margin-top:4px;\">Account: <b>' +\n            esc(data.connectedUser.name) +\n            '</b> (' +\n            esc(data.connectedUser.id.split(':')[0]) +\n            ')</p>' +\n            '<span class=\"badge ok\" style=\"margin-top:10px;\">☁️ Multi-Chunk Cloud Backup Active</span>';\n        } else if (data.qrDataUrl) {\n          qrBox.innerHTML =\n            '<img src=\"' +\n            data.qrDataUrl +\n            '\" alt=\"WhatsApp QR Code\" />' +\n            '<p style=\"font-weight:800; font-size:0.86rem;\">WhatsApp ➔ Linked Devices থেকে স্ক্যান করুন</p>';\n        } else {\n          qrBox.innerHTML = '<p style=\"font-weight:700;\">🔄 WhatsApp কানেক্ট হচ্ছে...</p>';\n        }\n\n        const jsonGrpEl = document.getElementById('jsonSavedGroupLabel');\n        if (jsonGrpEl) {\n          const tg = data.targetGroup || data.botConfig || {};\n          jsonGrpEl.textContent = (tg.targetGroupName || 'All Joined Groups') + (tg.targetGroupId && tg.targetGroupId !== 'ALL' ? ' [' + tg.targetGroupId + ']' : '');\n        }\n        const last5El = document.getElementById('last5MsgIdsLabel');\n        if (last5El) {\n          const ids = data.lastProcessedMsgIds || [];\n          last5El.textContent = ids.length > 0 ? ids.join(', ') : 'এখনো কোনো মেসেজ আইডি সেভ হয়নি';\n        }\n\n        const select = document.getElementById('groupSelect');\n        const groups = data.joinedGroups || [];\n        const savedGroupId = (data.targetGroup && data.targetGroup.targetGroupId) || data.botConfig.targetGroupId || '';\n        const savedGroupName = (data.targetGroup && data.targetGroup.targetGroupName) || data.botConfig.targetGroupName || '';\n        if (!groupInputTouched && document.activeElement !== select) {\n          select.innerHTML = '<option value=\"ALL\">🌐 All Joined Groups (সব গ্রুপ থেকে অর্ডার নিবে)</option>';\n          let matchedOption = (savedGroupId === 'ALL' || !savedGroupId);\n          groups.forEach((g) => {\n            const opt = document.createElement('option');\n            opt.value = g.id;\n            opt.dataset.name = g.subject;\n            opt.textContent = g.subject + ' (' + g.size + ' members)';\n            if (savedGroupId === g.id || (!savedGroupId && savedGroupName && g.subject.toLowerCase().trim() === savedGroupName.toLowerCase().trim())) {\n              opt.selected = true;\n              matchedOption = true;\n            }\n            select.appendChild(opt);\n          });\n          if (!matchedOption && savedGroupId && savedGroupId !== 'ALL') {\n            const pinnedOpt = document.createElement('option');\n            pinnedOpt.value = savedGroupId;\n            pinnedOpt.dataset.name = savedGroupName || savedGroupId;\n            pinnedOpt.textContent = '📌 ' + (savedGroupName || savedGroupId) + ' (Saved in master_db.json)';\n            pinnedOpt.selected = true;\n            select.appendChild(pinnedOpt);\n          }\n        }\n\n        if (!groupInputTouched) {\n          document.getElementById('targetGroupNameInput').value = data.botConfig.targetGroupName || '';\n          document.getElementById('targetGroupIdInput').value = data.botConfig.targetGroupId || '';\n          document.getElementById('autoReactCheckbox').checked = !!data.botConfig.autoReactOnOrder;\n        }\n\n        window.latestRecentOrders = data.recentOrders || [];\n        const tbody = document.getElementById('ordersTableBody');\n        if (data.recentOrders && data.recentOrders.length > 0) {\n          tbody.innerHTML = data.recentOrders\n            .map(\n              (o, oIdx) =>\n                '<tr>' +\n                '<td>' + (o.sheetRowNumber ? '<span class=\"badge ok\">📍 Row ' + esc(o.sheetRowNumber) + '</span>' : '<span class=\"badge warn\">Saved</span>') + '</td>' +\n                '<td><b>' + esc(o.date) + '</b><br/>' + esc(o.time) + '</td>' +\n                '<td><b>' + esc(o.daId) + '</b><br/><span>' + esc(o.daName) + '</span></td>' +\n                '<td><b>' + esc(o.psoCode) + '</b></td>' +\n                '<td>' + esc(o.pharmacyName) + '</td>' +\n                '<td><b>' + esc(o.rawText) + '</b></td>' +\n                '<td><b>[' + esc(o.crpCode) + ']</b> ' + esc(o.productName) + '</td>' +\n                '<td><b>' + esc(o.orderedQty) + '</b></td>' +\n                '<td>৳' + Number(o.unitPrice).toFixed(2) + '</td>' +\n                '<td style=\"font-weight:800;\">৳' + Number(o.totalAmount).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>' +\n                '<td style=\"white-space:nowrap;\">' + esc(o.matchType) + '<br/><button class=\"btn-blue btn-sm\" style=\"margin-top:4px;\" onclick=\"openEditOrderByIdx(' + oIdx + ')\">✏️ Edit</button></td>' +\n                '</tr>'\n            )\n            .join('');\n        } else {\n          tbody.innerHTML = '<tr><td colspan=\"11\" style=\"text-align:center; font-weight:700;\">মেমোরি বাফারে কোনো অর্ডার নেই।</td></tr>';\n        }\n\n        const logBox = document.getElementById('logBox');\n        logBox.innerHTML = (data.logs || []).map((l) => '<div>' + esc(l) + '</div>').join('');\n      } catch (e) {}\n    }\n\n    function onGroupDropdownChange() {\n      const sel = document.getElementById('groupSelect');\n      const opt = sel.options[sel.selectedIndex];\n      if (!opt) return;\n      groupInputTouched = true;\n      if (opt.value === 'ALL') {\n        document.getElementById('targetGroupIdInput').value = 'ALL';\n        document.getElementById('targetGroupNameInput').value = 'All Joined Groups (সব গ্রুপ)';\n      } else {\n        document.getElementById('targetGroupIdInput').value = opt.value;\n        document.getElementById('targetGroupNameInput').value = opt.dataset.name || '';\n      }\n    }\n\n    async function refreshGroups() {\n      const res = await fetch('/api/groups/refresh', { method: 'POST' });\n      const data = await res.json();\n      lastGroupsCount = -1;\n      groupInputTouched = false;\n      await fetchStatus();\n      alert('গ্রুপ লিস্ট আপডেট হয়েছে! মোট গ্রুপ: ' + (data.groups || []).length);\n    }\n\n    async function saveGroupConfig() {\n      const groupId = document.getElementById('targetGroupIdInput').value;\n      const groupName = document.getElementById('targetGroupNameInput').value;\n      const autoReactOnOrder = document.getElementById('autoReactCheckbox').checked;\n\n      const res = await fetch('/api/config/group', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ groupId, groupName, autoReactOnOrder })\n      });\n      const data = await res.json();\n      if (data.ok) {\n        document.getElementById('saveStatusMsg').textContent =\n          '✅ গ্রুপ সেটিংস সেভ হয়েছে: ' + (data.botConfig.targetGroupName || 'All');\n        groupInputTouched = false;\n        fetchStatus();\n      }\n    }\n\n    async function syncSheetStructure() {\n      const res = await fetch('/api/sheets/sync', { method: 'POST' });\n      const data = await res.json();\n      alert(data.ok ? '✅ Google Sheet-এ সব প্রোডাক্ট, DA তালিকা ও ক্লাউড ব্যাকআপ সিঙ্ক হয়েছে!' : '⚠️ Error: ' + data.googleAuthError);\n      fetchStatus();\n    }\n\n    async function clearLiveOrders() {\n      await fetch('/api/orders/clear', { method: 'POST' });\n      fetchStatus();\n    }\n\n    async function clearServerLogs() {\n      await fetch('/api/logs/clear', { method: 'POST' });\n      fetchStatus();\n    }\n\n    async function runTestParse(saveToSheet) {\n      const messageText = document.getElementById('testInput').value;\n      const res = await fetch('/api/test-parse', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ messageText, saveToSheet, isImageOrder: true })\n      });\n      const data = await res.json();\n      const box = document.getElementById('testResultBox');\n      let html = '';\n      if (data.daInfo) {\n        html += `<div style=\"margin-bottom:4px;\">👤 <b>DA:</b> ${esc(data.daInfo.name)} (${esc(data.daInfo.daId)}) — ${data.daInfo.isKnownDA ? '✅ পরিচিত' : '❓ অপরিচিত (Admin প্রশ্ন পাঠানো হবে)'}</div>`;\n      }\n      if (data.orders && data.orders.length > 0) {\n        html += `<div style=\"background:#A7F3D0; border:2px solid #000; padding:8px; border-radius:6px; margin-bottom:4px;\">✅ শনাক্তকৃত অর্ডার: ${data.orders.length}টি (PSO: ${esc(data.orders[0].psoCode)})</div>`;\n      }\n      if (data.unrecognizedItems && data.unrecognizedItems.length > 0) {\n        html += `<div style=\"background:#FEF08A; border:2px solid #000; padding:8px; border-radius:6px;\">🤔 অপরিচিত প্রোডাক্ট বানান: ${data.unrecognizedItems.map((u) => esc(u.unknownProductText) + ' (' + u.orderedQty + ')').join(', ')}</div>`;\n      }\n      box.innerHTML = html || 'কোনো অর্ডার পাওয়া যায়নি।';\n      fetchStatus();\n    }\n\n    function renderMessageLogsTable() {\n      const tbody = document.getElementById('messageLogsTableBody');\n      if (!tbody) return;\n      const filterVal = document.getElementById('msgLogFilterSelect')?.value || 'ALL';\n      const q = (document.getElementById('msgLogSearchInput')?.value || '').trim().toLowerCase();\n      const allLogs = window.latestMessageLogs || [];\n      const filtered = allLogs.filter((m) => {\n        if (filterVal === 'SAVED' && !m.isSaved) return false;\n        if (filterVal === 'UNSAVED' && m.isSaved) return false;\n        if (!q) return true;\n        return `${m.whatsappMsgId} ${m.senderPhone} ${m.senderPushName} ${m.daId} ${m.daName} ${m.fullMessage} ${m.sheetRowText} ${m.note}`.toLowerCase().includes(q);\n      });\n      if (filtered.length === 0) {\n        tbody.innerHTML = '<tr><td colspan=\"8\" style=\"text-align:center; font-weight:700;\">কোনো মেসেজ লগ পাওয়া যায়নি।</td></tr>';\n        return;\n      }\n      tbody.innerHTML = filtered.map((m) => {\n        const origIdx = allLogs.indexOf(m);\n        const statusBadge = m.isSaved\n          ? '<span class=\"badge ok\">✅ সেভ হয়েছে</span>'\n          : '<span class=\"badge err\">❌ সেভ হয়নি</span>';\n        const rowBadge = m.isSaved && m.sheetRowText && !m.sheetRowText.startsWith('❌')\n          ? `<span class=\"badge info\">📍 ${esc(m.sheetRowText)}</span>`\n          : '<span class=\"badge err\">❌ নেই</span>';\n        return `\n          <tr>\n            <td style=\"white-space:nowrap;\">${statusBadge}</td>\n            <td style=\"white-space:nowrap; font-weight:800;\">${rowBadge}</td>\n            <td style=\"white-space:nowrap;\"><b>${esc(m.date)}</b><br/>${esc(m.time)}</td>\n            <td><b>${esc(m.senderPhone || '-')}</b><br/><span style=\"font-size:0.76rem;\">${esc(m.senderPushName || '')}</span></td>\n            <td><b>${esc(m.daId || '-')}</b><br/><span>${esc(m.daName || '-')}</span></td>\n            <td style=\"white-space:pre-wrap; font-family:monospace; font-size:0.79rem; min-width:220px; max-width:360px;\">${esc(m.fullMessage || '-')}</td>\n            <td style=\"font-size:0.78rem; font-weight:700;\">${esc(m.note || '-')}</td>\n            <td style=\"white-space:nowrap;\">\n              <button class=\"btn-blue btn-sm\" onclick=\"openEditLogByIdx(${origIdx})\">✏️ এডিট ও সাবমিট</button>\n            </td>\n          </tr>\n        `;\n      }).join('');\n    }\n\n    function openEditMsgModal(msgId, token, phone, daText, fullText) {\n      document.getElementById('editModalMsgId').value = msgId || '';\n      document.getElementById('editModalToken').value = token || '';\n      document.getElementById('editModalPhone').value = phone && phone !== '-' ? phone : '';\n      document.getElementById('editModalDaText').value = daText && daText !== '-' && !daText.startsWith('UNRESOLVED') ? daText : '';\n      document.getElementById('editModalText').value = fullText || '';\n      document.getElementById('editModalStatus').textContent = '';\n      document.getElementById('editMsgModal').style.display = 'flex';\n    }\n\n    function closeEditMsgModal() {\n      document.getElementById('editMsgModal').style.display = 'none';\n    }\n\n    function openEditPendingByIdx(idx) {\n      const p = (window.latestPendingItems || [])[idx];\n      if (!p) return;\n      const ph = (p.displayPhone && p.displayPhone !== '-' ? p.displayPhone : p.senderPhone) || '';\n      const daStr = p.daInfo && p.daInfo.isKnownDA ? `${p.daInfo.daId} ${p.daInfo.name}` : (p.detectedDaId || '');\n      openEditMsgModal(p.whatsappMsgId || '', p.token || '', ph, daStr, p.rawText || p.rawLine || '');\n    }\n\n    function openEditLogByIdx(idx) {\n      const m = (window.latestMessageLogs || [])[idx];\n      if (!m) return;\n      const daStr = m.daId && m.daId !== '-' && m.daId !== 'UNRESOLVED' ? `${m.daId} ${m.daName !== '-' ? m.daName : ''}`.trim() : '';\n      openEditMsgModal(m.whatsappMsgId || '', '', m.senderPhone || '', daStr, m.fullMessage || '');\n    }\n\n    function openEditOrderByIdx(idx) {\n      const o = (window.latestRecentOrders || [])[idx];\n      if (!o) return;\n      const logMatch = (window.latestMessageLogs || []).find((m) => m.whatsappMsgId === o.whatsappMsgId);\n      const fullTxt = logMatch && logMatch.fullMessage ? logMatch.fullMessage : `${o.daId} ${o.daName}\\nPSO: ${o.psoCode}\\nCus: ${o.pharmacyName}\\n${o.rawText}`;\n      openEditMsgModal(o.whatsappMsgId || '', '', o.senderPhone || '', `${o.daId} ${o.daName}`, fullTxt);\n    }\n\n    async function submitEditedMessageFromWeb() {\n      const whatsappMsgId = document.getElementById('editModalMsgId').value;\n      const pendingToken = document.getElementById('editModalToken').value;\n      const senderPhone = document.getElementById('editModalPhone').value;\n      const overrideDaText = document.getElementById('editModalDaText').value;\n      const editedText = document.getElementById('editModalText').value;\n      const statusEl = document.getElementById('editModalStatus');\n\n      if (!editedText.trim()) {\n        alert('অনুগ্রহ করে মেসেজের লেখা দিন।');\n        return;\n      }\n      statusEl.style.color = '#1d4ed8';\n      statusEl.textContent = '⏳ মেসেজটি পার্স করে Google Sheet-এ সেভ করা হচ্ছে...';\n      try {\n        const res = await fetch('/api/message/edit-submit', {\n          method: 'POST',\n          headers: { 'Content-Type': 'application/json' },\n          body: JSON.stringify({ whatsappMsgId, pendingToken, senderPhone, overrideDaText, editedText })\n        });\n        const data = await res.json();\n        if (!data.ok) {\n          statusEl.style.color = '#b91c1c';\n          statusEl.textContent = '❌ ' + (data.error || 'Error saving edited message');\n          return;\n        }\n        statusEl.style.color = '#047857';\n        statusEl.textContent = data.message || '✅ সফলভাবে সেভ হয়েছে!';\n        setTimeout(() => {\n          closeEditMsgModal();\n          fetchStatus();\n          loadMasterDb();\n        }, 600);\n      } catch (e) {\n        statusEl.style.color = '#b91c1c';\n        statusEl.textContent = '❌ Error: ' + e.message;\n      }\n    }\n\n    async function syncRowsFromSheetNow() {\n      await fetch('/api/message-logs/sync-rows', { method: 'POST' });\n      await fetchStatus();\n    }\n\n    async function logoutWhatsApp() {\n      if (!confirm('নতুন WhatsApp অ্যাকাউন্ট কানেক্ট করতে চান?')) return;\n      await fetch('/api/whatsapp/logout', { method: 'POST' });\n      fetchStatus();\n    }\n\n    fetchStatus();\n    loadMasterDb();\n    setInterval(fetchStatus, 3500);\n  </script>\n</body>\n</html>");
});

// ============================================================================
// 13. RENDER 24/7 ANTI-SLEEP KEEP-ALIVE & SERVER BOOTSTRAP
// ============================================================================
function startKeepAliveLoop() {
  setInterval(async () => {
    const targetUrl = RENDER_EXTERNAL_URL
      ? `${RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health`
      : `http://127.0.0.1:${PORT}/health`;
    try {
      await fetch(targetUrl);
    } catch (e) {}
  }, 4 * 60 * 1000);
}

async function bootstrap() {
  loadLocalMasterDb();
  syncTargetGroupFromMasterDbToBotConfig();
  app.listen(PORT, '0.0.0.0', () => {
    addLog(`🚀 Renata CRP Order Tracker v6.0 running on port ${PORT}`);
  });

  await initGoogleSheetsClient();
  if (googleAuthReady) {
    await restoreAuthAndConfigFromSheet();
    syncTargetGroupFromMasterDbToBotConfig();
    await ensureSpreadsheetStructure(true);
    await syncExistingSheetMessageIds();
    await syncLiveSheetRowNumbers();
  }

  setInterval(() => {
    if (googleAuthReady) {
      syncLiveSheetRowNumbers().catch(() => {});
    }
  }, 15000);

  await startWhatsApp();
  startKeepAliveLoop();
}

bootstrap();
