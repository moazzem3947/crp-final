/**
 * ============================================================================
 * RENATA PLC (NOAKHALI DEPOT) — WHATSAPP GROUP CRP ORDER TRACKER (v4.0 PRO)
 * NEO-BRUTALISM EDITION + 3X AUTO-RETRY & KEYLESS AI VISION OCR
 * ============================================================================
 * What's New & Fixed in v4.0:
 * 1. 3-Stage Server-Side Image OCR Auto-Retry + Keyless Vision AI Fallback:
 *    - Pass 1: OCR.space Engine 2 (Neural Handwriting/Camera Mode) or Gemini Vision
 *    - Pass 2: Auto-Recheck with OCR.space Engine 1 (Contrast/Orientation Mode) + Raw Line Mode
 *    - Pass 3: Keyless Free Vision AI (Pollinations OpenAI Vision API — requires ZERO API key!)
 *    - Smart OCR Pre-Normalizer: Fixes handwritten digit lookalikes (5O->50, l0->10, I5->15),
 *      merges split product+quantity lines, and parses tab-separated columns & bottom party names.
 *    - Sends error message ONLY if all 3+ server-side attempts fail to find any order!
 * 2. Fixed +8801732273944 & +8801793362829 Image Authorization:
 *    - Pre-binds known WhatsApp @lid IDs (259794032148540 & 51243288424651 & 188738965659721)
 *    - Auto-resolves @lid for both numbers on startup via sock.onWhatsApp() & groupMetadata
 *    - Supports flexible /bind command in ANY group, DM, or image caption!
 * 3. Fixed Group Message Capture & Signal Decryption after Group Setup / Restart:
 *    - Backs up pre-key-*.json files in _Bot_State + calls uploadPreKeysToServerIfRequired()
 *      so group member messages never fail Signal decryption after Render restarts!
 *    - Flexible group matching (matches by targetGroupId OR targetGroupName, or "ALL" groups)
 *    - Smart First-Empty-Row insertion in Live_Orders (prevents blank row gaps when rows are cleared)
 * 4. Complete Neo-Brutalism UI Redesign + Clear Orders & Clear Logs Memory Buttons
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

// Strictly Authorized Phone Numbers for Image-to-Order OCR (Normalized to 8801XXXXXXXXX)
const AUTHORIZED_IMAGE_PHONES = ['8801732273944', '8801793362829'];

// Pre-bound known WhatsApp Multi-Device @lid identifiers for +8801732273944 and +8801793362829
// discovered directly from the user's WhatsApp session state
const DEFAULT_AUTHORIZED_LIDS = [
  '259794032148540', // +8801732273944
  '51243288424651',  // +8801793362829
  '188738965659721'  // Connected Bot Account (Moajjem)
];

const SHEET_TABS = {
  LIVE_ORDERS: 'Live_Orders',
  DA_SUMMARY: 'DA_Wise_Summary',
  PRODUCT_SUMMARY: 'Product_Wise_Summary',
  DELETED_LOG: 'Deleted_Unsent_Log',
  BOT_STATE: '_Bot_State'
};

// ============================================================================
// 2. MASTER DATABASE: 79 CRP PRODUCTS WITH EXACT TRADE PRICE (30-10-2026)
// ============================================================================
const DEFAULT_CRP_PRODUCTS = [
  { code: '919', name: 'TOTIFEN SYRUP 100ML', unit: 'Bottle (100ml)', price: 47.23, family: 'TOTIFEN', aliases: ['totifen', 'totipen', 'totifin', 'totefen', 'totifen syp', 'totifen syr', 'totifen sry', 'totifen 100ml', 'totifen syrh'] },
  { code: '81', name: "DOXICAP 100MG CAP 100'S", unit: "Box (100's)", price: 165.00, family: 'DOXICAP', aliases: ['doxicap', 'doxicup', 'doxycap', 'doxy cap', 'doxicap 100mg', 'doxicap cap', 'doxecap'] },
  { code: '990', name: "DOMIREN SUSPENSION 100ML 1X1'S", unit: 'Bottle (100ml)', price: 28.49, family: 'DOMIREN', aliases: ['domiren 100ml', 'domiren syp', 'domiren syr', 'domiren sry', 'domeren 100ml', 'domiren 100', 'domiren susp'] },
  { code: '286', name: "DOMIREN SUSPENSION 60ML 1'S", unit: 'Bottle (60ml)', price: 26.24, family: 'DOMIREN', aliases: ['domiren 60ml', 'domeren 60ml', 'domiren 60', 'sy domira 60'] },
  { code: '60', name: "DOMIREN FC TAB 10MG 100'S", unit: "Box (100's)", price: 151.00, family: 'DOMIREN', aliases: ['domiren tab', 'domeren tab', 'domiren fc tab', 'domiren 10mg', 'domiren tablet', 'domiren tb', 'domniren tab'] },
  { code: '636', name: "DELTASONE ORAL SOLUTION 50ML 1X1'S", unit: 'Bottle (50ml)', price: 44.98, family: 'DELTASONE', aliases: ['deltasone 50ml', 'deltason 50ml', 'daltasone 50ml', 'daltason 50ml', 'delta sone 50ml', 'delta som', 'dellthesun', 'deltasone syp', 'deltason syr', 'deltason sry', 'delterson 50ml', 'deltarson 50ml'] },
  { code: '637', name: "DELTASONE ORAL SOLUTION 100ML 1X1'S", unit: 'Bottle (100ml)', price: 71.21, family: 'DELTASONE', aliases: ['deltasone 100ml', 'deltason 100ml', 'daltasone 100ml', 'delta sone 100ml', 'deltasone 100'] },
  { code: 'CS7', name: "DELTASONE 5MG TAB 17X30'S", unit: "Box (17x30's)", price: 657.90, family: 'DELTASONE', aliases: ['deltasone tab', 'deltason tab', 'daltasone tap', 'deltasone 5mg', 'deltason 5mg', 'deltasonne tab', 'deltasone 17x30'] },
  { code: '922', name: "PRAZOLE 20MG CAP 6X10'S", unit: "Box (6x10's)", price: 225.00, family: 'PRAZOLE', aliases: ['prazole', 'prazol', 'parzol', 'prajol', 'frazol', 'pazal', 'prazole 20mg', 'prazol cap'] },
  { code: '271', name: 'ZITHRIN DRY SYRUP 35ML', unit: 'Bottle (35ml)', price: 104.95, family: 'ZITHRIN', aliases: ['zithrin 35ml', 'zitrin 35ml', 'zithrin 35', 'zitrin 35', 'zitthrin', 'zithren', 'zithrin dry syrup', 'zithrin syp', 'zithrin syr'] },
  { code: '290', name: 'ZITHRIN DRY SYRUP 50ML', unit: 'Bottle (50ml)', price: 149.93, family: 'ZITHRIN', aliases: ['zithrin 50ml', 'zitrin 50ml', 'zithrin 50', 'zitrin 50', 'zrithrin 50ml'] },
  { code: '270', name: 'ZITHRIN DRY SYRUP 20ML', unit: 'Bottle (20ml)', price: 74.96, family: 'ZITHRIN', aliases: ['zithrin 20ml', 'zitrin 20ml', 'zithirin 20ml', 'zithrin 20'] },
  { code: '173', name: 'ZITHRIN DRY SYRUP 15ML', unit: 'Bottle (15ml)', price: 71.21, family: 'ZITHRIN', aliases: ['zithrin 15ml', 'ziyhrin 15ml', 'zithrin 15'] },
  { code: '834', name: "ZITHRIN 30ML SUSPENSION 1'S", unit: 'Bottle (30ml)', price: 103.45, family: 'ZITHRIN', aliases: ['zithrin 30ml', 'zitrin 30ml', 'zithrin 30'] },
  { code: '278', name: "XAMIC 500MG CAP (2X10'S)", unit: "Box (2x10's)", price: 329.80, family: 'XAMIC', aliases: ['xamic', 'xamic cap', 'xamic 500mg', 'xamic capsule', 'xmaic', 'examic'] },
  { code: '635', name: "RECOF 100ML SYRUP 1X1'S", unit: 'Bottle (100ml)', price: 29.99, family: 'RECOF', aliases: ['recof', 'recop', 'recof syp', 'recof syr', 'recof sry', 'recof 100ml', 'recof syraf'] },
  { code: '299', name: "TRULAX SYRUP 1MG/5ML 100ML 1'S", unit: 'Bottle (100ml)', price: 33.73, family: 'TRULAX', aliases: ['trulax', 'tulax', 'trulex', 'trulax syr', 'trulax syp', 'trulax sry', 'trulax 100ml'] },
  { code: '112', name: 'LUCAN-R SUSP. 35ML', unit: 'Bottle (35ml)', price: 58.70, family: 'LUCAN-R', aliases: ['lucan r 35ml', 'lucan-r 35ml', 'locan r sry', 'lucan r syp', 'lucan r syr', 'lukan r syp', 'luknar syraf', 'lokanar', 'lucon r syp', 'lucanar syp', 'lucar sry', 'luna r'] },
  { code: '876', name: "LUCAN-R 50MG CAP 4x10'S", unit: "Box (4x10's)", price: 240.80, family: 'LUCAN-R', aliases: ['lucan r 50mg', 'locan r 50mg', 'lucan-r 50mg', 'lukan r 50', 'lacan r 50mg', 'lucan r 50'] },
  { code: '605', name: 'LUCAN-R 150MG CAPS 2X6', unit: "Box (2x6's)", price: 198.60, family: 'LUCAN-R', aliases: ['lucan r 150mg', 'locan r 150mg', 'lucan-r 150mg', 'lucan r 150', 'locan r 150', 'luknar 150', 'lucon r 150', 'lunch 150'] },
  { code: '621', name: 'LUCAN-R 200MG CAPS 2X6', unit: "Box (2x6's)", price: 224.88, family: 'LUCAN-R', aliases: ['lucan r 200mg', 'locan r 200mg', 'lucan-r 200mg', 'lucan r 200', 'locan r 200', 'lucanar 200'] },
  { code: '96', name: "FLONTIN 500MG TAB 3X10'S", unit: "Box (3x10's)", price: 337.20, family: 'FLONTIN', aliases: ['flontin tab', 'flontin 500mg', 'flontine tab', 'foltin', 'flotin tab', 'falntin', 'flonten tab'] },
  { code: '226', name: "FLONTIN SUSPENSION 60ML 1'S", unit: 'Bottle (60ml)', price: 74.96, family: 'FLONTIN', aliases: ['flontin syp', 'flontin syr', 'flontin sry', 'flontin sryp', 'flontin syrp', 'flontin 60ml', 'flotin sry', 'flontin susp'] },
  { code: '179', name: "NORMANAL 500MG FC TAB (3X10'S)", unit: "Box (3x10's)", price: 202.50, family: 'NORMANAL', aliases: ['normanal', 'normal', 'normanol', 'normonal', 'narmonal', 'nomanal', 'normanal 500mg', 'normanal tab'] },
  { code: '102', name: "FUROCEF FC SUSPENSION 70ML 1X1'S", unit: 'Bottle (70ml)', price: 168.67, family: 'FUROCEF', aliases: ['furocef 70ml', 'feurocef 70ml', 'furosef 70ml', 'furocef sry', 'furocef syrp', 'furoccfe 70ml', 'reocef'] },
  { code: 'S72', name: "FUROCEF DS SUSPENSION 50ML 1X1'S", unit: 'Bottle (50ml)', price: 187.41, family: 'FUROCEF', aliases: ['furocef ds', 'feurocef ds', 'furosef ds', 'furocef 50ml', 'furocef ds sry'] },
  { code: 'S16', name: "VITA D3 40000 IU CAP 2X5'S", unit: "Box (2x5's)", price: 262.40, family: 'VITA', aliases: ['vita d3 40000', 'vita 40000', 'vita d3', 'vita d', 'bita d3'] },
  { code: 'S15', name: "VITA D3 20000 IU CAP 2X5'S", unit: "Box (2x5's)", price: 149.90, family: 'VITA', aliases: ['vita d3 20000', 'vita 20000', 'bita d3 20000'] },
  { code: 'SA4', name: "NEXDEX 30MG CAP 6X10'S", unit: "Box (6x10's)", price: 450.00, family: 'NEXDEX', aliases: ['nexdex 30mg', 'nexdex 30', 'nexdex'] },
  { code: 'SA1', name: "NEXDEX 60MG CAP 5X6'S", unit: "Box (5x6's)", price: 404.70, family: 'NEXDEX', aliases: ['nexdex 60mg', 'nexdex 60'] },
  { code: 'C2Z', name: "PCAB FC 20MG TAB 3X10'S", unit: "Box (3x10's)", price: 225.00, family: 'PCAB', aliases: ['pcab 20mg', 'pcab 20', 'p cab 20', 'pcab', 'p cab', 'pacb', 'pcap', 'picap 20', 'p-cap'] },
  { code: 'C2Y', name: "PCAB FC 10MG TAB 3X10'S", unit: "Box (3x10's)", price: 157.50, family: 'PCAB', aliases: ['pcab 10mg', 'pcab 10', 'p cab 10', 'pcap 10'] },
  { code: 'C25', name: "FERIX-V CAP 6X10'S", unit: "Box (6x10's)", price: 202.20, family: 'FERIX-V', aliases: ['ferix v', 'ferix-v', 'farix v', 'frix v', 'ferix v cap'] },
  { code: '959', name: "DESOLON TAB 1X21'S", unit: "Pack (1x21's)", price: 90.51, family: 'DESOLON', aliases: ['desolon', 'desolone', 'deselon', 'desolan', 'dasalon', 'deslon', 'deslor', 'desolon tab'] },
  { code: '633', name: "EMCON-1 1X1'S", unit: "Pack (1x1's)", price: 60.34, family: 'EMCON-1', aliases: ['emcon', 'emcon-1', 'emcon 1', 'emcon tab', 'emon', 'incone', 'em con'] },
  { code: '67', name: 'CONASYD CREAM 10MG', unit: 'Tube (10g)', price: 47.23, family: 'CONASYD', aliases: ['conasyd', 'conasid', 'conased', 'conacid', 'conasyd cream', 'conasid creem', 'conased crem'] },
  { code: 'SA3', name: "REDUCOF 100ML SYRP 1X1'S", unit: 'Bottle (100ml)', price: 74.96, family: 'REDUCOF', aliases: ['reducof', 'redicof', 'rducof', 'reducop', 'reducof syr', 'reducof syp'] },
  { code: '961', name: "GESTRENOL TAB 5MG 3X10'S", unit: "Box (3x10's)", price: 180.60, family: 'GESTRENOL', aliases: ['gestrenol', 'gestronal', 'gestonal', 'gestrnol', 'gestanol', 'gestnol', 'gestronol', 'gastronal', 'gestrennol'] },
  { code: 'SM1', name: "EXICOF 100ML SYRUP 1X1'S", unit: 'Bottle (100ml)', price: 59.97, family: 'EXICOF', aliases: ['exicof', 'exicop', 'exicap', 'exicof syp', 'exicof syr'] },
  { code: 'SY1', name: "RENASONE 10G CREAM 1X1'S", unit: 'Tube (10g)', price: 38.98, family: 'RENASONE', aliases: ['renasone', 'renason', 'renasol', 'renasone cream', 'renason crem', 'renason creem', 'renasone crm', 'renasone crime'] },
  { code: '34', name: "BECONEX SYRUP 200ML 1'S", unit: 'Bottle (200ml)', price: 46.48, family: 'BECONEX', aliases: ['beconex 200ml', 'biconex 200ml', 'beconex 200', 'beconex syp', 'biconex', 'beconez'] },
  { code: '33', name: "BECONEX SYRUP 100ML 1'S", unit: 'Bottle (100ml)', price: 26.24, family: 'BECONEX', aliases: ['beconex 100ml', 'biconex 100ml', 'beconex 100', 'beconix 100'] },
  { code: '233', name: 'BECONEX ZI SYRUP 100ML', unit: 'Bottle (100ml)', price: 43.48, family: 'BECONEX', aliases: ['beconex zi', 'be conex zi', 'becoxnex zi', 'biconex zi'] },
  { code: 'C82', name: "STARK 60ML ORAL SOLUTION 1X1'S", unit: 'Bottle (60ml)', price: 56.22, family: 'STARK', aliases: ['stark', 'strak', 'stark syp', 'stark syr', 'stark sry', 'stark 60ml'] },
  { code: '267', name: "PROTONIL EC 40MG TAB 3X10'S", unit: "Box (3x10's)", price: 202.50, family: 'PROTONIL', aliases: ['protonil 40mg', 'protonil 40'] },
  { code: '266', name: "PROTONIL EC 20MG TAB 5X10'S", unit: "Box (5x10's)", price: 225.00, family: 'PROTONIL', aliases: ['protonil 20mg', 'protonil 20', 'protonil'] },
  { code: '138', name: 'POLYCEF SYRUP 100ML', unit: 'Bottle (100ml)', price: 67.47, family: 'POLYCEF', aliases: ['polycef', 'policef', 'polycef syp', 'policef sry'] },
  { code: '875', name: "BREDICON TAB 28'S", unit: "Pack (28's)", price: 52.08, family: 'BREDICON', aliases: ['bredicon', 'bedicon', 'bredecon', 'bredcon', 'baredicon', 'badicon', 'bredicon tab'] },
  { code: 'S34', name: "PANGESIC TAB 5X6'S", unit: "Box (5x6's)", price: 180.00, family: 'PANGESIC', aliases: ['pangesic', 'pengesic', 'pangisic', 'pangasic', 'pengecic', 'pengasice', 'pangesic tab'] },
  { code: '934', name: "CALCIN-D TAB 6X10'S", unit: "Box (6x10's)", price: 360.00, family: 'CALCIN-D', aliases: ['calcin d', 'calcin-d', 'calcind', 'calcin d tab'] },
  { code: '607', name: "FLUSTAR 500MG CAP 7X4'S", unit: "Box (7x4's)", price: 210.00, family: 'FLUSTAR', aliases: ['flustar 500mg', 'flustar cap', 'fluster cap', 'fullstar cap', 'fulustar cap', 'flustar 500'] },
  { code: 'N33', name: "FLUSTAR 100ML DRY SYS 1X1'S", unit: 'Bottle (100ml)', price: 44.98, family: 'FLUSTAR', aliases: ['flustar syp', 'flustar syr', 'fullstar syr', 'fulustar syrup', 'fluster syp', 'flustar 100ml'] },
  { code: '282', name: "NORRY 3MG TAB 5X10'S", unit: "Box (5x10's)", price: 262.50, family: 'NORRY', aliases: ['norry', 'nory', 'norry 3mg', 'norry tab'] },
  { code: 'CO6', name: "ZODEF 60ML SUSP 1X1'S", unit: 'Bottle (60ml)', price: 149.93, family: 'ZODEF', aliases: ['zodef', 'zodef sy', 'zodef sry', 'zodef syp', 'zodef 60ml'] },
  { code: '902', name: "SALINE-R 20'S", unit: "Box (20's)", price: 90.00, family: 'SALINE-R', aliases: ['saline r', 'saline-r', 'slain r', 'salaine r', 'seline r', 'salin r'] },
  { code: '232', name: 'HONYCOL LINCTUS 100ML', unit: 'Bottle (100ml)', price: 29.99, family: 'HONYCOL', aliases: ['honycol', 'hunycol', 'hanycol', 'hanicol', 'honeycol', 'honycal', 'hanicon', 'honycol syp'] },
  { code: '955', name: "THYROX 50MCG 3X30'S", unit: "Box (3x30's)", price: 148.50, family: 'THYROX', aliases: ['thyrox', 'thyrox 50mcg', 'thyrox 50'] },
  { code: 'T28', name: "NUTRILINA 500MG VEG CAP 5X6'S", unit: "Box (5x6's)", price: 310.35, family: 'NUTRILINA', aliases: ['nutrilina', 'neutilina', 'nutinila', 'nutrilina 500mg'] },
  { code: 'N49', name: "RECOX FC 120MG TAB 2X10'S", unit: "Box (2x10's)", price: 209.80, family: 'RECOX', aliases: ['recox 120mg', 'recox 120'] },
  { code: 'N47', name: "RECOX FC 90MG TAB 2X10'S", unit: "Box (2x10's)", price: 180.00, family: 'RECOX', aliases: ['recox 90mg', 'recox 90', 'recox'] },
  { code: 'SZ5', name: "COPNAT N OINTMENT 15GM 1'S", unit: 'Tube (15g)', price: 52.47, family: 'COPNAT', aliases: ['copnat n ointment', 'copnet n ointment', 'copnet n oientment', 'copnat n olntment', 'copnat n', 'copnet n'] },
  { code: 'SZ4', name: "COPNAT N CREAM 15GM 1'S", unit: 'Tube (15g)', price: 52.47, family: 'COPNAT', aliases: ['copnat n cream', 'copnat n crem', 'cophnet-n cream', 'copnet n cream', 'copmate n creem'] },
  { code: 'SI1', name: "FUROCLAV 70ML DRY PWD SUSP 1X1'S", unit: 'Bottle (70ml)', price: 198.65, family: 'FUROCLAV', aliases: ['furoclav', 'feuroclav', 'furoclav 70ml'] },
  { code: 'H39', name: 'MOODS ALL-NIGHT', unit: "Pack (3's)", price: 50.00, family: 'MOODS', aliases: ['moods all night', 'moods all-night', 'ps-moods all night'] },
  { code: 'H37', name: 'MOODS DOTTED', unit: "Pack (3's)", price: 50.00, family: 'MOODS', aliases: ['moods dotted', 'mood dotted'] },
  { code: 'H89', name: "MOODS GOLD 1500 DOTS 3'S", unit: "Pack (3's)", price: 65.00, family: 'MOODS', aliases: ['moods gold 1500', 'moods gold', 'moods gola'] },
  { code: 'H88', name: "MOODS GOLD ELECTRIFY 3'S", unit: "Pack (3's)", price: 65.00, family: 'MOODS', aliases: ['moods gold electrify', 'moods gold electrifry', 'moods electrify'] },
  { code: 'H34', name: 'MOODS ULTA-THIN', unit: "Pack (3's)", price: 50.00, family: 'MOODS', aliases: ['moods ulta thin', 'moods ulta-thin', 'moods ultra thin'] },
  { code: 'CY7', name: "HYDROGEST DS 2ML (500MG/2ML) INJ 1X1'S", unit: "Ampoule (1x1's)", price: 487.26, family: 'HYDROGEST', aliases: ['hydrogest ds', 'hydrogenst ds', 'hydrogest'] },
  { code: '73', name: "DELENTIN SUSPENSION 10ML 1'S", unit: 'Bottle (10ml)', price: 12.03, family: 'DELENTIN', aliases: ['delentin', 'dilentin', 'delentin 10ml'] },
  { code: '933', name: 'FENADIN SUSPENSION 50ML', unit: 'Bottle (50ml)', price: 41.23, family: 'FENADIN', aliases: ['fenadin 50ml', 'fenadin syr', 'fenadin sry', 'fenadin'] },
  { code: '69', name: "FENADIN 30ML SUSPENSION 1'S", unit: 'Bottle (30ml)', price: 26.24, family: 'FENADIN', aliases: ['fenadin 30ml', 'fenadin sry small', 'fenadin sry smal', 'fenadin small'] },
  { code: 'N45', name: "NOVELON LITE FC TAB 1X24'S", unit: "Pack (1x24's)", price: 366.38, family: 'NOVELON', aliases: ['novelon lite', 'novelon'] },
  { code: '840', name: "EMEREN 50ML SYRP 1X1'S", unit: 'Bottle (50ml)', price: 22.49, family: 'EMEREN', aliases: ['emeren', 'emiren', 'emiren syr', 'emeren 50ml'] },
  { code: '989', name: "ALGIN SYRP 100ML 1X1'S", unit: 'Bottle (100ml)', price: 67.47, family: 'ALGIN', aliases: ['algin 100ml', 'algin syrp', 'algin syr'] },
  { code: 'C62', name: "ALGIN 50ML SYRP 1X1'S", unit: 'Bottle (50ml)', price: 41.23, family: 'ALGIN', aliases: ['algin 50ml', 'algin 50'] },
  { code: '16', name: "MAZIC JR 100ML 4.05MG/5ML SYRP 1X1'S", unit: 'Bottle (100ml)', price: 28.49, family: 'MAZIC', aliases: ['mazic jr', 'mazic jr sy', 'magic jr'] },
  { code: '18', name: "MAZIC 10MG/5ML 100ML 1X1'S", unit: 'Bottle (100ml)', price: 26.24, family: 'MAZIC', aliases: ['mazic 100ml', 'mazic', 'magic syp'] },
  { code: 'DF4', name: 'ALLUREN 100G PWD', unit: 'Pack (100g)', price: 262.37, family: 'ALLUREN', aliases: ['alluren', 'aluren', 'alluren 100g'] }
];

const TRADE_PRICE_MAP = new Map(DEFAULT_CRP_PRODUCTS.map((p) => [p.code, p.price]));
let activeProducts = [...DEFAULT_CRP_PRODUCTS];

// ============================================================================
// 3. MASTER DATABASE: 46 DELIVERY ASSISTANTS (DA ID, ALT ID, NAME, PHONES)
// ============================================================================
const DA_MASTER = [
  { daId: 'CF9054', altId: '', name: 'Md Rakib Hossain', phones: ['8801602791043'], aliases: ['mehedi hasan rakib1 da nk', 'rakib hossain', 'mehedihasanrakib515'] },
  { daId: 'RF20363', altId: '', name: 'Ikbal Hossain (Sharif)', phones: ['8801839551851'], aliases: ['ikbal hossan sharif da nk', 'ikbal hossain', 'sharif'] },
  { daId: 'CF10593', altId: 'C122227', name: 'Abdul Alim', phones: [], aliases: ['abdul alim da', 'abdul alim'] },
  { daId: 'RF20360', altId: '', name: 'Dawdul Islam Sobuj', phones: ['8801805481935', '8801838675803'], aliases: ['dawdul islam sobuj', 'dawdul islam'] },
  { daId: 'CF8970', altId: '', name: 'Abdullah Al Mamun', phones: ['8801878160083'], aliases: ['abdullah al mamun'] },
  { daId: 'CF9012', altId: '', name: 'Abdur Rahim Saikat', phones: [], aliases: ['_saikat_khan_', 'saikat', 'abdur rahim saikat'] },
  { daId: 'C122210', altId: '', name: 'Jahid Mondol', phones: ['8801854272016', '8801804892343'], aliases: ['jahid mondol'] },
  { daId: 'C210015', altId: '', name: 'Daud Ul Islam', phones: [], aliases: ['daudmahmud5829', 'daudmahmud1', 'daud ul islam'] },
  { daId: 'CF8971', altId: '', name: 'Mehedi Hassan', phones: ['8801805481946', '8801617729981'], aliases: ['mehedi hassan'] },
  { daId: 'CF4526', altId: '', name: 'Seraj', phones: ['8801864482005'], aliases: ['seraj', 'seragul islam'] },
  { daId: 'C210012', altId: '', name: 'Arfin Rasel (Rasel Hossain 2)', phones: [], aliases: ['arfin rasel da nk', 'arfin rasel'] },
  { daId: 'CF9011', altId: '', name: 'Robiul Hossain (Robiul 1)', phones: ['8801845540077'], aliases: ['robiul 1 da', 'robiul hossain'] },
  { daId: 'C210006', altId: '', name: 'Md Sajib Uddin (Hatiya)', phones: [], aliases: ['sojib nk depot hatiya', 'sajib__hatiya', 'sajib uddin'] },
  { daId: 'C122184', altId: '', name: 'Rezaul Haque', phones: ['8801856006064', '8801782563961'], aliases: ['rezaul haque', 'rejaul hoque'] },
  { daId: 'CF10592', altId: 'C122225', name: 'Md Robiul', phones: ['8801805481962', '8801650287369'], aliases: ['md robiul', 'robiul matubar'] },
  { daId: 'CF9067', altId: '', name: 'Md Ajgor Hossen', phones: ['8801815499442'], aliases: ['ajgor hossen da nk', 'md ajgor hossen', 'ajgor hossen'] },
  { daId: 'C122229', altId: '', name: 'Md Abubakkar', phones: ['8801615197377'], aliases: ['abubakkar da nk', 'md abubakkar'] },
  { daId: 'C210004', altId: '', name: 'Sahadat Hossain', phones: ['8801850323315'], aliases: ['sahadat hossin da nk', 'sahadat hossain', 'md sahadat'] },
  { daId: 'CF10589', altId: 'C122197', name: 'DA ID CF10589 / C122197', phones: ['8801641195494'], aliases: ['c122197', 'cf10589'] },
  { daId: 'CF4706', altId: '', name: 'Md Sumon Miah', phones: ['8801805481944'], aliases: ['md sumon miah', 'afran sumon'] },
  { daId: 'C122231', altId: '', name: 'Md Rakib Molla', phones: ['8801805481966', '8801637011890'], aliases: ['md rakib molla', 'md rakibb molla'] },
  { daId: 'C210021', altId: '', name: 'Md Mahbubul Haque', phones: [], aliases: ['mdmahbubulhaque765', 'md mahbubul haque'] },
  { daId: 'C210025', altId: '', name: 'Mosharef Hossin', phones: ['8801865472523'], aliases: ['mosharef hossin'] },
  { daId: 'RF20359', altId: '', name: 'Mamunur Rashid', phones: ['8801805481934', '8801852118166'], aliases: ['mamunur rashid20359', 'mamunur rashid'] },
  { daId: 'CF10588', altId: 'C122185', name: 'Md Mamun Hossain', phones: [], aliases: ['mamun da nk depot ren', 'md mamun hossain'] },
  { daId: 'CF10590', altId: 'C122211', name: 'Md Rasel Hossen', phones: ['8801311821108'], aliases: ['md rasel hossen', 'md rasel'] },
  { daId: 'C210017', altId: '', name: 'Md Jihad', phones: ['8801887762770', '8801805481940'], aliases: ['md jihad'] },
  { daId: 'CF10587', altId: 'C122187', name: 'Tajul Islam (Sheikh Apon)', phones: ['8801999660289'], aliases: ['sheikhapon1', 'tajul islam', 'sheikh apon'] },
  { daId: 'CF3881', altId: '', name: 'Sorowar Hossain', phones: ['8801805481941', '8801837203147'], aliases: ['sorowar hossain'] },
  { daId: 'C122199', altId: '', name: 'Sojib (C122199)', phones: ['8801872496540'], aliases: ['sojib'] },
  { daId: 'C210022', altId: '', name: 'Rofiqul Islam', phones: ['8801823263485'], aliases: ['rofiqul islam'] },
  { daId: 'CF8987', altId: '', name: 'Md Saiful Islam', phones: ['8801890681777'], aliases: ['saiful da nk ren', 'saiful6045bd', 'md saiful islam'] },
  { daId: 'CF10591', altId: 'C122223', name: 'Amran Hossain', phones: ['8801805481961', '8801310735205'], aliases: ['amran hossain', 'emran hossain'] },
  { daId: 'CF9041', altId: '', name: 'Md Zihad', phones: [], aliases: ['md zihad nk depot ren', 'md zihad'] },
  { daId: 'C055167', altId: '', name: 'Rakib 2', phones: ['8801805481953'], aliases: ['rakib 2', 'mrmrakib6'] },
  { daId: 'C210016', altId: '', name: 'Md Roki Uddin', phones: ['8801805481973'], aliases: ['roki nk depot', 'md roki uddin'] },
  { daId: 'RF5709', altId: '', name: 'Shimul Dey', phones: [], aliases: ['shimul dey renata nk depot', 'shimul dey', 'shimuldey'] },
  { daId: 'CF4525', altId: '', name: 'Neymot Ullah', phones: ['8801841693411'], aliases: ['neymot da nk ren', 'neymot ullah', 'neymotullah56'] },
  { daId: 'C210011', altId: '', name: 'DA ID C210011', phones: ['8801915403253'], aliases: ['c210011'] },
  { daId: 'CF1568', altId: '', name: 'Mizanur Rahaman', phones: [], aliases: ['mizanur rahaman da nk', 'mizanur rahaman', 'mizan'] },
  { daId: 'C210018', altId: '', name: 'Safayat Hossen', phones: ['8801636190755'], aliases: ['safayat hossen'] },
  { daId: 'CF1603', altId: '', name: 'Ruhul Amin', phones: ['8801916682332'], aliases: ['ruhul amin'] },
  { daId: 'C210024', altId: '', name: 'Ilias Hossain', phones: ['8801621668496'], aliases: ['ilias hossain'] },
  { daId: 'C210028', altId: '', name: 'Abdur Rahman', phones: [], aliases: ['abdur rahman nk depot ren', 'abdur rahman'] },
  { daId: 'C122230', altId: '', name: 'DA ID C122230', phones: ['8801777824386'], aliases: ['c122230'] },
  { daId: 'CF10145', altId: 'RF9084', name: 'Moajjem', phones: ['8801732273944', '8801793362829'], aliases: ['moajjem', 'moazzem', 'rf9084'] }
];

// ============================================================================
// 4. FUZZY SPELL-CHECKING & VARIANT DISAMBIGUATION ENGINE
// ============================================================================

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Int32Array(b.length + 1);
  const v1 = new Int32Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v0[b.length];
}

function stringSimilarity(s1, s2) {
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  let score = 1 - dist / maxLen;
  if (a.slice(0, 3) === b.slice(0, 3)) score += 0.06;
  return Math.min(1.0, Math.max(0, score));
}

function resolveBrandFamilyVariant(family, rawTextLower) {
  const t = rawTextLower;
  const byCode = (c) => activeProducts.find((p) => p.code === c);

  switch (family) {
    case 'DELTASONE':
      if (/\b(tab|tap|tb|5\s*mg|17\s*[\*x]\s*30)\b/i.test(t)) return byCode('CS7');
      if (/\b50\s*ml\b/i.test(t) || /\bdeltas[oa]ne?\s*50\b/i.test(t)) return byCode('636');
      if (/\b100\s*ml\b/i.test(t) || /\bdeltas[oa]ne?\s*100\b(?=.*?\b\d+)/i.test(t)) return byCode('637');
      return byCode('636');

    case 'DOMIREN':
      if (/\b(tab|tap|tb|fc|tablet|10\s*mg)\b/i.test(t)) return byCode('60');
      if (/\b100\s*ml\b/i.test(t) || /\bdom[iey]?r[ea]n\s*100\b(?=.*?\b\d+)/i.test(t)) return byCode('990');
      if (/\b60\s*ml\b/i.test(t) || /\bdom[iey]?r[ea]n\s*60\b(?=.*?\b\d+)/i.test(t)) return byCode('286');
      return byCode('990');

    case 'ZITHRIN':
      if (/\b35\s*ml\b/i.test(t) || /\bz[ri]?th?r[ie]n\s*35\b/i.test(t)) return byCode('271');
      if (/\b50\s*ml\b/i.test(t) || /\bz[ri]?th?r[ie]n\s*(?:syr|syp|sry)?\s*50\b(?=.*?\b\d+)/i.test(t)) return byCode('290');
      if (/\b30\s*ml\b/i.test(t)) return byCode('834');
      if (/\b20\s*ml\b/i.test(t)) return byCode('270');
      if (/\b15\s*ml\b/i.test(t)) return byCode('173');
      return byCode('271');

    case 'LUCAN-R':
      if (/\b200\s*(mg)?\b/i.test(t)) return byCode('621');
      if (/\b150\s*(mg)?\b/i.test(t)) return byCode('605');
      if (/\b35\s*ml\b/i.test(t) || /\b(syp|syr|sry|srp|syrp|sryp|syrup|syraf|sarape|susp)\b/i.test(t)) return byCode('112');
      if (/\b50\s*mg\b/i.test(t) || (/\b(cap|caps|capsule)\b/i.test(t) && !/\b(150|200)\b/.test(t)) || /\b(lucan|locan|lukan|lucon|lacan)\s*[\-]?r?\s*50\b(?=.*?\b\d+)/i.test(t)) {
        return byCode('876');
      }
      return byCode('112');

    case 'FUROCEF':
      if (/\b(ds|50\s*ml)\b/i.test(t)) return byCode('S72');
      return byCode('102');

    case 'BECONEX':
      if (/\bzi\b/i.test(t)) return byCode('233');
      if (/\b200\s*ml\b/i.test(t) || /\bb[ei]conex\s*200\b/i.test(t)) return byCode('34');
      if (/\b100\s*ml\b/i.test(t) || /\bb[ei]conex\s*100\b(?=.*?\b\d+)/i.test(t)) return byCode('33');
      return byCode('34');

    case 'FLONTIN':
      if (/\b(syp|syr|sry|srp|sryp|syrp|sy|syrup|syrap|susp|60\s*ml)\b/i.test(t)) return byCode('226');
      return byCode('96');

    case 'FLUSTAR':
      if (/\b(cap|caps|500\s*mg|500)\b/i.test(t)) return byCode('607');
      return byCode('N33');

    case 'VITA':
      if (/\b(20000|20k)\b/i.test(t)) return byCode('S15');
      return byCode('S16');

    case 'NEXDEX':
      if (/\b60\s*mg\b/i.test(t) || /\bnexdex\s*60\b(?=.*?\b\d+)/i.test(t)) return byCode('SA1');
      return byCode('SA4');

    case 'PCAB':
      if (/\b10\s*mg\b/i.test(t) || /\bp\s*[\-]?ca[bp]\s*10\b(?=.*?\b\d+)/i.test(t)) return byCode('C2Y');
      return byCode('C2Z');

    case 'PROTONIL':
      if (/\b40\s*(mg)?\b/i.test(t)) return byCode('267');
      return byCode('266');

    case 'RECOX':
      if (/\b120\s*(mg)?\b/i.test(t)) return byCode('N49');
      return byCode('N47');

    case 'COPNAT':
      if (/\b(cream|crem|creem|crm)\b/i.test(t) && !/\boint/i.test(t)) return byCode('SZ4');
      return byCode('SZ5');

    case 'FENADIN':
      if (/\b(30\s*ml|small|smal)\b/i.test(t)) return byCode('69');
      return byCode('933');

    case 'ALGIN':
      if (/\b50\s*(ml)?\b/i.test(t)) return byCode('C62');
      return byCode('989');

    case 'MAZIC':
      if (/\bjr\b/i.test(t)) return byCode('16');
      return byCode('18');

    case 'MOODS':
      if (/\b(ulta|ultra|thin)\b/i.test(t)) return byCode('H34');
      if (/\belectr/i.test(t)) return byCode('H88');
      if (/\b(gold|gola|1500)\b/i.test(t)) return byCode('H89');
      if (/\bdot/i.test(t)) return byCode('H37');
      return byCode('H39');

    default:
      return activeProducts.find((p) => p.family === family);
  }
}

const BRAND_FAMILY_PATTERNS = [
  { family: 'TOTIFEN', regex: /\b(tot[iey]?[fpv][eai]?n|toti[fp]en|totifen|totipen|totifin)\b/i },
  { family: 'DOXICAP', regex: /\b(dox[iy]?\s*c[auo]p|doxicap|doxicup)\b/i },
  { family: 'DOMIREN', regex: /\b(dom[iey]?r[ea]n|domniren|domira)\b/i },
  { family: 'DELTASONE', regex: /\b(d[ea]ll?t[aeh]?r?\s*s[oa]n[ne]?|delta\s*som|dellthesun)\b/i },
  { family: 'PRAZOLE', regex: /\b(pr?a[zj]o?l[ea]?|parzol|frazol|pazal)\b/i },
  { family: 'ZITHRIN', regex: /\b(z[ri]?th?[i]?r[ie]n|zitrin|zitthrin|ziyhrin)\b/i },
  { family: 'XAMIC', regex: /\b(xamic|xmaic|examic)\b/i },
  { family: 'RECOF', regex: /\b(recof|recop)\b/i },
  { family: 'TRULAX', regex: /\b(tr?ul[ae]x)\b/i },
  { family: 'LUCAN-R', regex: /\b(l[ou]l?u?[ck][aeo]?n[a]?\s*[\-_]?r?|lukn?ar|lokanar|lacan\s*r|luncar|lunar|luna\s*[\-_]?r|lunch\s*(?:150|200|50))\b/i },
  { family: 'FLONTIN', regex: /\b(fl?o[nl]?t[ie]n[e]?|foltin|falntin)\b/i },
  { family: 'NORMANAL', regex: /\b(n[oa]rm[ao]n[ao]l|nomanal|normal)\b/i },
  { family: 'FUROCLAV', regex: /\b(f[eu]?roclav)\b/i },
  { family: 'FUROCEF', regex: /\b(f[eu]?ro[cs]c?e?f[e]?|reocef)\b/i },
  { family: 'VITA', regex: /\b([vb]ita\s*d\s*3?|[vb]ita\s*(40000|20000))\b/i },
  { family: 'NEXDEX', regex: /\b(nexdex|nexdax)\b/i },
  { family: 'PCAB', regex: /\b(p\s*[\-]?c[ae][bp]|pacb|picap)\b/i },
  { family: 'FERIX-V', regex: /\b(f[ea]?r?ix\s*[\-_]?\s*v)\b/i },
  { family: 'DESOLON', regex: /\b(d[ea]s[eo]l[oa][nr]e?|deslon)\b/i },
  { family: 'EMCON-1', regex: /\b(em\s*con|emon|incone)\b/i },
  { family: 'CONASYD', regex: /\b(conas[yiEAe]d|conacid)\b/i },
  { family: 'REDUCOF', regex: /\b(re?d[ui]co[fp])\b/i },
  { family: 'GESTRENOL', regex: /\b(g[ea]st[r]?[eoau]?n[oa]l)\b/i },
  { family: 'EXICOF', regex: /\b(exic[oa][fp])\b/i },
  { family: 'RENASONE', regex: /\b(renas[oa][nl]e?)\b/i },
  { family: 'BECONEX', regex: /\b(b[ei]\s*c[ox]?n[ei][xz])\b/i },
  { family: 'STARK', regex: /\b(st[ar][ra]k)\b/i },
  { family: 'PROTONIL', regex: /\b(protonil)\b/i },
  { family: 'POLYCEF', regex: /\b(pol[yi]cef)\b/i },
  { family: 'BREDICON', regex: /\b(b[ae]?r?e?d[ei]?con)\b/i },
  { family: 'PANGESIC', regex: /\b(p[ea]ng[eai]s?c?i?ce?)\b/i },
  { family: 'CALCIN-D', regex: /\b(calcin\s*[\-]?\s*d)\b/i },
  { family: 'FLUSTAR', regex: /\b(f[ul]+u?st[ea]r)\b/i },
  { family: 'NORRY', regex: /\b(norr?y)\b/i },
  { family: 'ZODEF', regex: /\b(zodef)\b/i },
  { family: 'SALINE-R', regex: /\b(s[ae]l[ai]?i?ne?\s*[\-]?\s*r|slain\s*r)\b/i },
  { family: 'HONYCOL', regex: /\b(h[oaue]n[eyi]?c[oa][ln])\b/i },
  { family: 'THYROX', regex: /\b(thyrox)\b/i },
  { family: 'NUTRILINA', regex: /\b(n[eu]u?t[ri]?[il]i?[nl]i?a)\b/i },
  { family: 'RECOX', regex: /\b(recox)\b/i },
  { family: 'COPNAT', regex: /\b(cop[hnm][ae]t[e]?\.?\s*[\-]?\s*n?)\b/i },
  { family: 'MOODS', regex: /\b(moods?)\b/i },
  { family: 'HYDROGEST', regex: /\b(hydroge?n?st)\b/i },
  { family: 'DELENTIN', regex: /\b(d[ei]lentin)\b/i },
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

  for (const item of BRAND_FAMILY_PATTERNS) {
    if (item.regex.test(normalized)) {
      const product = resolveBrandFamilyVariant(item.family, normalized);
      if (product) {
        return { product, matchType: 'Pattern/Alias', confidence: 0.98 };
      }
    }
  }

  for (const prod of activeProducts) {
    const cleanProdName = prod.name.toLowerCase().split(/\s+/)[0];
    if (cleanProdName.length >= 4 && normalized.includes(cleanProdName)) {
      const resolved = resolveBrandFamilyVariant(prod.family || cleanProdName.toUpperCase(), normalized) || prod;
      return { product: resolved, matchType: 'Direct', confidence: 0.95 };
    }
  }

  const STOP_WORDS = new Set([
    'syp', 'syr', 'sry', 'srp', 'syrup', 'syrap', 'syraf', 'sy', 'susp', 'tab', 'tap', 'tb', 'tablet',
    'cap', 'caps', 'capsule', 'cream', 'crem', 'creem', 'crm', 'ointment', 'ta', 'tah', 'pes', 'pcs',
    'pc', 'pic', 'box', 'bx', 'bc', 'bot', 'bottle', 'pack', 'er', 'ar', 'ml', 'mg', 'gm', 'iu', 'fc',
    'ec', 'ds', 'jr', 'pso', 'code', 'pharmacy', 'pharmechy', 'pharmecy', 'phy', 'pharma', 'medical',
    'medecal', 'hall', 'hal', 'mh', 'bazar', 'bazer', 'bz', 'market', 'road', 'hat', 'new', 'al', 'ma',
    'maa', 'jannat', 'janani', 'popular', 'model', 'unique', 'laxmipur', 'ramgonj', 'raipur', 'hatiya',
    'chowmuhani', 'noakhali', 'mandari', 'hasnabad', 'chatkhil', 'sonapur', 'kabirhat', 'company', 'dr',
    'cus', 'name', 'customer', 'party', 'pharmey'
  ]);

  const tokens = normalized
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));

  if (!tokens.length) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const token of tokens) {
    for (const prod of activeProducts) {
      const candidateAliases = [
        prod.name.split(/\s+/)[0].toLowerCase(),
        ...(prod.aliases || []).map((a) => a.split(/\s+/)[0].toLowerCase())
      ];
      for (const aliasWord of candidateAliases) {
        if (aliasWord.length < 4) continue;
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
// 5. QUANTITY EXTRACTOR, OCR PRE-NORMALIZER & MULTI-ITEM LINE SPLITTER
// ============================================================================

/**
 * Fixes common OCR handwriting digit misreads at the end of lines or before units:
 * e.g. "5O" -> "50", "l0" -> "10", "I0" -> "10", "l5" -> "15", "2O" -> "20", "S0" -> "50"
 */
function fixOcrDigitLookalikes(str) {
  if (!str) return '';
  return str
    // Fix lookalikes inside or adjacent to digits: e.g. "5O" -> "50", "1OO" -> "100"
    .replace(/(\d)[Oo](\b|\s|ta|pes|pcs|pc|box|bx)/gi, '$10$2')
    .replace(/(\d)[Oo][Oo](\b|\s|ta|pes|pcs|pc|box|bx)/gi, '$100$2')
    // Fix "l0", "I0", "l5", "I5", "S0" when preceded by space/=/dash and followed by end/unit
    .replace(/([\s\-:=])[lI|](\d\b)/g, '$11$2')
    .replace(/([\s\-:=])[lI|][Oo](\b|\s|ta|pes|pcs|pc|box|bx)/g, '$110$2')
    .replace(/([\s\-:=])S[0Oo](\b|\s|ta|pes|pcs|pc|box|bx)/g, '$150$2');
}

function extractOrderQuantity(rawLine, matchedProduct) {
  let s = fixOcrDigitLookalikes(rawLine);
  // Separate glued letters and digits like "Domiren100ml" -> "Domiren 100 ml"
  s = s.replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2');

  s = s.replace(/^\s*\d+\s*[\/)\.]\s*/, ' ');
  s = s.replace(/\b(cf|rf|c)\s*[\-_]?\s*\d{4,6}\b/gi, ' ');
  s = s.replace(/\bpso\s*[\-:=]?\s*[a-z]?\s*\d{2,3}\b/gi, ' ');
  s = s.replace(/\b(40000|20000|1500)\s*(iu|dots)?\b/gi, ' ');
  s = s.replace(/\b\d+\s*[\*x]\s*\d+\b/gi, ' ');
  s = s.replace(/\bd\s*3\b/gi, ' ');
  s = s.replace(/\bemcon\s*[\-_]?\s*1\b/gi, 'emcon ');
  s = s.replace(/\b(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5|3)\s*(ml|mg|mcg|gm|g)\b/gi, ' ');

  s = s.replace(/\b(dom[iey]?r[ea]n|deltas[oa]ne?|daltas[oa]ne?|beconex|biconex|zith?r[ie]n|zitrin|lucan\s*[\-]?r?|locan\s*[\-]?r?|lokanar|lunch|furocef|feurocef|p\s*[\-]?ca[bp]|nexdex|protonil|recox|flontin|flustar|algin|fenadin|normanal|pangesic)\s*(?:syp|syr|sry|srp|sarape|tab|tap|cap)?\s*[\-_:=.]*\s*(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5)\b(?=.*?\b\d+)/gi, '$1 ');

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

/**
 * Pre-normalizes OCR text from handwritten/printed images:
 * 1. Splits tab-separated cells gracefully (while keeping "Product \t Qty" together)
 * 2. Merges a Product line that has no quantity with the next line if the next line is purely a quantity!
 */
function normalizeOcrOrderText(rawText) {
  if (!rawText) return '';
  let text = fixOcrDigitLookalikes(rawText.replace(/\r\n/g, '\n'));

  // Handle tab-separated table output from OCR.space (e.g. "CF10145\tTOTifen SYP 10 Ta\tMA Pharmey" or "Totifen\t50")
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
      // If buffer has a product without quantity and current cell is a quantity (e.g. "10", "50 ta"), join them!
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

  // Pass 2: Merge consecutive lines where Line i is a Product without quantity and Line i+1 is just a quantity
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
      i++; // Skip next line since it was merged
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

/**
 * Checks if a message was sent by +8801732273944 or +8801793362829 (across all JID/LID/fromMe formats)
 */
function isAuthorizedForImageOrder(msg, resolvedPhone) {
  const norm = normalizeBdPhone(resolvedPhone);
  for (const authPhone of AUTHORIZED_IMAGE_PHONES) {
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
    if (mapped && AUTHORIZED_IMAGE_PHONES.includes(mapped)) return true;
    const normCand = normalizeBdPhone(rawId);
    if (AUTHORIZED_IMAGE_PHONES.includes(normCand)) return true;
  }

  return false;
}

function resolveDAFromMessageAndSender(fullText, senderPhone, senderPushName, senderJid) {
  const cleanText = (fullText || '').toUpperCase();
  const cleanPhone = normalizeBdPhone(senderPhone);
  const cleanPush = (senderPushName || '').toLowerCase().trim();

  const explicitMatch = cleanText.match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b/);
  if (explicitMatch) {
    const candidateId = `${explicitMatch[1]}${explicitMatch[2]}`;
    const foundByCode = DA_MASTER.find(
      (d) => d.daId === candidateId || d.altId === candidateId
    );
    if (foundByCode) {
      if (senderJid) senderContextCache.set(senderJid, { ...foundByCode });
      return foundByCode;
    }
    const customDA = {
      daId: candidateId,
      altId: '',
      name: senderPushName || `DA ${candidateId}`,
      phones: []
    };
    if (senderJid) senderContextCache.set(senderJid, customDA);
    return customDA;
  }

  const bareMatch = cleanText.match(/\b(2100\d{2}|122\d{3}|055167)\b/);
  if (bareMatch) {
    const candidateId = `C${bareMatch[1]}`;
    const foundBare = DA_MASTER.find((d) => d.daId === candidateId || d.altId === candidateId);
    if (foundBare) {
      if (senderJid) senderContextCache.set(senderJid, { ...foundBare });
      return foundBare;
    }
  }

  if (cleanPhone.length >= 10) {
    const last10 = cleanPhone.slice(-10);
    const foundByPhone = DA_MASTER.find((d) =>
      d.phones && d.phones.some((p) => p.endsWith(last10))
    );
    if (foundByPhone) {
      if (senderJid) senderContextCache.set(senderJid, { ...foundByPhone });
      return foundByPhone;
    }
  }

  for (const da of DA_MASTER) {
    for (const alias of da.aliases || []) {
      if (alias.length >= 4 && (cleanPush.includes(alias) || fullText.toLowerCase().includes(alias))) {
        if (senderJid) senderContextCache.set(senderJid, { ...da });
        return da;
      }
    }
  }

  if (senderJid && senderContextCache.has(senderJid)) {
    return senderContextCache.get(senderJid);
  }

  return {
    daId: cleanPhone ? `WA-${cleanPhone.slice(-6)}` : 'UNKNOWN',
    altId: '',
    name: senderPushName || (cleanPhone ? `+${cleanPhone}` : 'Unknown Sender'),
    phones: []
  };
}

function extractPSOCode(line) {
  if (!line) return null;
  const psoExplicit = line.match(/\bpso\s*(?:code)?\s*[\-:=_.]?\s*([A-Z]\s*\d{2,3}|\d{3})\b/i);
  if (psoExplicit) {
    return psoExplicit[1].replace(/\s+/g, '').toUpperCase();
  }
  const slashOrParen = line.match(/(?:\/|\(|,\s*\-|\s\-)\s*([A-TV-Z]\s*\d{2}|345|44\d|45\d|46\d|47\d)\b/i);
  if (slashOrParen) {
    const code = slashOrParen[1].replace(/\s+/g, '').toUpperCase();
    if (!['S16', 'S15', 'S34', 'S72', 'C25', 'C62', 'C82', 'N33', 'N45', 'N47', 'N49', 'T28', 'H34', 'H37', 'H39', 'H88', 'H89'].includes(code)) {
      return code;
    }
  }
  const standalone = line.trim().match(/^([A-Z]\d{2}|345|44\d|45\d|46\d|47\d)$/i);
  if (standalone) {
    return standalone[1].toUpperCase();
  }
  return null;
}

function isPharmacyCandidateLine(line) {
  const clean = line.trim();
  if (!clean || clean.length < 3) return false;
  if (/^(pso|cf|rf|c[\-_]?\d|assalamu|salam|hi|hello|crp\b)/i.test(clean)) return false;
  if (/^(cus|customer|party)\s*(?:name)?\s*[\-:=]/i.test(clean)) return true;
  if (/^(md\s+|ikbal\s+hossain|robiul\s+hossain|dawdul\s+islam|jahid\s+mondol|rezaul\s+haque|rejaul\s+hoque|mizan\b|sharif\b|rakib\b)/i.test(clean) && !/\b(pharmacy|pharmey|pharma|phy|p\/h|medical|med|hall|mh|m\.h|drug|clinic|hospital|store|corner|center|centre)\b/i.test(clean)) {
    return false;
  }
  if (/\b(pharmacy|pharmechy|pharmecy|pharmicy|pharmey|pharma|phy|p\/h|medical|medecal|med\s+hall|hall|hal|m\.?h\b|drug|clinic|hospital|medicine|medicen|corner|cornar|center|centre|store|point|paint|nikaton|ph\b)/i.test(clean)) {
    return true;
  }
  return false;
}

function cleanPharmacyName(raw) {
  return raw
    .replace(/^\s*\d+\s*[\)\/.]\s*\.*/, '')
    .replace(/^(?:cus|customer|party)\s*(?:name)?\s*[\-:=]+\s*/i, '')
    .replace(/\bpso\s*(?:code)?\s*[\-:=_.]?\s*[A-Z0-9]+/gi, '')
    .trim();
}

function parseWhatsAppOrderMessage({
  messageText,
  messageId = `MSG_${Date.now()}`,
  timestamp = new Date(),
  senderPhone = '',
  senderPushName = '',
  senderJid = ''
}) {
  if (!messageText || typeof messageText !== 'string') {
    return { isOrder: false, orders: [], followUpPatch: null };
  }

  const normalizedBlock = normalizeOcrOrderText(messageText);
  const rawLines = normalizedBlock
    .split('\n')
    .map((l) => l.replace(/<This message was edited>/gi, '').trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { isOrder: false, orders: [], followUpPatch: null };
  }

  const daInfo = resolveDAFromMessageAndSender(normalizedBlock, senderPhone, senderPushName, senderJid);

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
      } else if (
        !potentialPartyHeader &&
        seg.length >= 3 &&
        seg.length <= 45 &&
        !/^(cf|rf|c[\-_]?\d|pso\b|\d+$)/i.test(seg)
      ) {
        potentialPartyHeader = cleanPharmacyName(seg);
      }
    }
  }

  if (parsedItems.length === 0 && rawLines.length <= 2 && normalizedBlock.length <= 35) {
    const onlyDaMatch = normalizedBlock.toUpperCase().match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b|\b(2100\d{2}|122\d{3})\b/);
    const onlyPsoMatch = extractPSOCode(normalizedBlock);
    if (onlyDaMatch || onlyPsoMatch) {
      return {
        isOrder: false,
        orders: [],
        followUpPatch: {
          senderJid,
          senderPhone,
          daInfo: onlyDaMatch ? daInfo : null,
          psoCode: onlyPsoMatch || null
        }
      };
    }
    return { isOrder: false, orders: [], followUpPatch: null };
  }

  if (parsedItems.length === 0) {
    return { isOrder: false, orders: [], followUpPatch: null };
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
  if (!displayPhone.startsWith('8801') && daInfo.phones && daInfo.phones.length > 0) {
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
    isOrder: true,
    orders: finalOrders,
    daInfo,
    followUpPatch: null
  };
}

// ============================================================================
// 7. 3-STAGE AUTO-RETRY IMAGE OCR + KEYLESS VISION AI FALLBACK ENGINE
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call OCR.space with configurable engine (Engine 2 = Handwriting/Camera, Engine 1 = Fast Printed/Contrast)
 */
async function runOcrSpacePass(base64Image, mimeType, engineNumber = '2', isTable = 'true') {
  const ocrKey = (process.env.OCR_SPACE_API_KEY || 'helloworld').trim();
  const formBody = new URLSearchParams();
  formBody.append('apikey', ocrKey);
  formBody.append('base64Image', `data:${mimeType};base64,${base64Image}`);
  formBody.append('language', 'eng');
  formBody.append('isOverlayRequired', 'false');
  formBody.append('OCREngine', String(engineNumber));
  formBody.append('scale', 'true');
  formBody.append('detectOrientation', 'true');
  formBody.append('isTable', String(isTable));

  const res = await fetchWithTimeout('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody.toString()
  }, 15000);
  const json = await res.json();
  return (json?.ParsedResults || [])
    .map((r) => r.ParsedText || '')
    .join('\n')
    .trim();
}

/**
 * Keyless Free Vision AI Fallback (Pollinations OpenAI-Compatible Multimodal Vision Endpoint)
 * Works with ZERO API Key or account setup!
 */
async function runKeylessVisionAiFallback(base64Image, mimeType) {
  const productHint = activeProducts.slice(0, 45).map((p) => p.name.split(' ')[0]).join(', ');
  const promptText =
    'Read this handwritten or printed pharmaceutical order sheet photo from Bangladesh (Renata PLC). ' +
    'Extract and output ONLY the raw order lines: include DA Code (e.g. CF9054, RF20363, C122210), ' +
    'Customer/Pharmacy Name, PSO Code, and each Medicine Name with its ordered Quantity on the same line (e.g. "Totifen 50", "Doxicap 10", "Domiren 100ml 20"). ' +
    `Common medicine names include: ${productHint}. Output plain text lines only, no commentary.`;

  const res = await fetchWithTimeout('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      temperature: 0.1
    })
  }, 20000);

  if (!res.ok) return '';
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

/**
 * Optional Google Gemini Vision API (if user configured GEMINI_API_KEY)
 */
async function runGeminiVisionPass(base64Image, mimeType, geminiKey) {
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  const productNamesHint = activeProducts.map((p) => `${p.name} (${p.code})`).join(', ');
  const promptText =
    'Read this handwritten or printed order photo for Renata PLC Bangladesh and output ONLY the plain text lines: ' +
    'DA Code, Pharmacy/Customer Name, PSO Code, and each Product Name with its Quantity (one product per line, e.g. "Totifen 100ml 50"). ' +
    `Official products: ${productNamesHint}.`;

  for (const modelName of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: promptText },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      }, 15000);
      const data = await response.json();
      const extracted = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim();
      if (extracted) return { text: extracted, engine: `Gemini Vision (${modelName})` };
    } catch (e) {}
  }
  return null;
}

/**
 * 3-Stage Server-Side Auto-Retry + Keyless Vision AI Pipeline:
 * Automatically checks and parses the image up to 3+ times across different OCR & AI Vision engines
 * BEFORE returning failure, so the user NEVER has to resend an image multiple times!
 */
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
  const base64Image = imageBuffer.toString('base64');
  const geminiKey = (botConfig.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  const collectedTexts = [];

  // Define the 3 automatic retry stages + final keyless AI Vision stage
  const stages = [
    {
      name: 'Attempt 1/3 (Neural Handwriting & Table OCR Engine 2)',
      run: async () => {
        if (geminiKey) {
          const g = await runGeminiVisionPass(base64Image, mimeType, geminiKey);
          if (g && g.text) return g;
        }
        const t = await runOcrSpacePass(base64Image, mimeType, '2', 'true');
        return { text: t, engine: 'Cloud OCR Engine 2 (Table Mode)' };
      }
    },
    {
      name: 'Attempt 2/3 (Auto-Recheck: Raw Line Handwriting OCR + Orientation Engine 1)',
      run: async () => {
        const t2Raw = await runOcrSpacePass(base64Image, mimeType, '2', 'false');
        const t1 = await runOcrSpacePass(base64Image, mimeType, '1', 'true');
        return {
          text: [t2Raw, t1].filter(Boolean).join('\n'),
          engine: 'Cloud OCR Engine 1+2 (Multi-Pass)'
        };
      }
    },
    {
      name: 'Attempt 3/3 (Auto-Recheck: Keyless AI Vision Fallback — Zero API Key)',
      run: async () => {
        const aiText = await runKeylessVisionAiFallback(base64Image, mimeType);
        if (aiText) {
          return { text: aiText, engine: 'Keyless Vision AI (GPT-4o Vision Fallback)' };
        }
        // Final retry on OCR Engine 2 if Vision endpoint was unreachable
        const tRetry = await runOcrSpacePass(base64Image, mimeType, '2', 'true');
        return { text: tRetry, engine: 'Cloud OCR Engine 2 (Retry 3)' };
      }
    }
  ];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    try {
      if (i > 0) {
        addLog(`🔄 Image Recheck [${stage.name}] running automatically...`);
        await sleep(1200);
      }
      const res = await stage.run();
      const rawExtracted = (res?.text || '').trim();
      if (rawExtracted) {
        collectedTexts.push(rawExtracted);
      }

      const combinedText = [caption, rawExtracted].filter(Boolean).join('\n').trim();
      if (combinedText) {
        const parsed = parseWhatsAppOrderMessage({
          messageText: combinedText,
          messageId,
          timestamp,
          senderPhone,
          senderPushName,
          senderJid
        });
        if (parsed.isOrder && parsed.orders.length > 0) {
          addLog(`✅ Image Order succeeded on ${stage.name} (${parsed.orders.length} items matched via ${res.engine}).`);
          return {
            ok: true,
            attemptUsed: i + 1,
            engine: res.engine,
            extractedText: combinedText,
            parsed
          };
        }
      }
    } catch (err) {
      addLog(`⚠️ ${stage.name} warning: ${err.message}`);
    }
  }

  // Final Combined Pass: If individual passes had partial text (e.g. DA ID in Pass 1 and Product in Pass 2), try combined text!
  if (collectedTexts.length > 1) {
    const mergedAll = [caption, ...collectedTexts].filter(Boolean).join('\n');
    const parsedMerged = parseWhatsAppOrderMessage({
      messageText: mergedAll,
      messageId,
      timestamp,
      senderPhone,
      senderPushName,
      senderJid
    });
    if (parsedMerged.isOrder && parsedMerged.orders.length > 0) {
      // Deduplicate by crpCode + orderedQty in case multiple passes extracted the same line
      const seen = new Set();
      parsedMerged.orders = parsedMerged.orders.filter((o) => {
        const k = `${o.crpCode}_${o.orderedQty}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      addLog(`✅ Image Order succeeded via Combined Multi-Pass Text (${parsedMerged.orders.length} items).`);
      return {
        ok: true,
        attemptUsed: 3,
        engine: 'Combined Multi-Pass OCR',
        extractedText: mergedAll,
        parsed: parsedMerged
      };
    }
  }

  return {
    ok: false,
    attemptUsed: 3,
    engine: 'All 3 Retries Exhausted',
    extractedText: collectedTexts.join('\n').trim(),
    parsed: null
  };
}

function buildImageOrderReplyMessage(orders, ocrEngine = '', attemptUsed = 1) {
  const first = orders[0];
  const totalAmount = orders.reduce((sum, o) => sum + o.totalAmount, 0);

  const lines = [
    '✅ *ছবি থেকে অর্ডারটি Google Sheet-এ সেভ হয়েছে!*',
    `👤 *DA:* [${first.daId}] ${first.daName}`,
    `🏥 *Party:* ${first.pharmacyName} (PSO: ${first.psoCode})`,
    '',
    '📦 *অর্ডার বিস্তারিত (Trade Price অনুযায়ী):*'
  ];

  orders.forEach((o, i) => {
    lines.push(
      `${i + 1}. *${o.productName}* (Code: ${o.crpCode})\n   পরিমাণ: ${o.orderedQty} × ৳${o.unitPrice.toFixed(2)} = *৳${o.totalAmount.toFixed(2)}*`
    );
  });

  lines.push('');
  lines.push(`💰 *সর্বমোট (Grand Total): ৳${totalAmount.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`);
  if (attemptUsed > 1) {
    lines.push(`🔄 _Auto-Recheck Pass: ${attemptUsed}/3 (${ocrEngine})_`);
  }
  lines.push('');
  lines.push('⚠️ _এই অর্ডারটি বাতিল করতে চাইলে এই মেসেজের Reply-তে লিখুন:_ */cnl*');
  lines.push('_(অন্য কিছু লিখলে বা কিছু না লিখলে অর্ডারটি সেভ থাকবে)_');

  return lines.join('\n');
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
      )
    };
  } catch (e) {}
}

function saveLocalConfig() {
  try {
    fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(botConfig, null, 2), 'utf8');
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
      DA_MASTER.forEach((da, i) => {
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
      const totalRowNum = DA_MASTER.length + 2;
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
      DEFAULT_CRP_PRODUCTS.forEach((p, idx) => {
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
      const pTotalRow = DEFAULT_CRP_PRODUCTS.length + 2;
      prodRows.push([
        'TOTAL', `All ${DEFAULT_CRP_PRODUCTS.length} CRP Products`, '-',
        `=AVERAGE(D2:D${pTotalRow - 1})`,
        `=SUM(E2:E${pTotalRow - 1})`,
        `=SUM(F2:F${pTotalRow - 1})`,
        `=SUM(G2:G${pTotalRow - 1})`
      ]);
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${SHEET_TABS.PRODUCT_SUMMARY}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: prodRows }
      });

      await migrateExistingLiveOrdersToTradePrice();
    }

    return true;
  } catch (err) {
    addLog(`⚠️ Error ensuring spreadsheet structure: ${err.message}`);
    return false;
  }
}

async function migrateExistingLiveOrdersToTradePrice() {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A1:S`
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return;

    const updates = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[0]) continue;
      const crpCode = String(row[11] || '').trim();
      const qty = parseFloat(String(row[14] || '0').replace(/,/g, ''));
      const currentUnitPrice = parseFloat(String(row[15] || '0').replace(/[^\d.]/g, ''));

      if (crpCode && TRADE_PRICE_MAP.has(crpCode) && qty > 0) {
        const officialTp = TRADE_PRICE_MAP.get(crpCode);
        if (Math.abs(currentUnitPrice - officialTp) > 0.001) {
          const newTotal = Number((qty * officialTp).toFixed(2));
          const rowNum = r + 1;
          updates.push({
            range: `${SHEET_TABS.LIVE_ORDERS}!P${rowNum}:Q${rowNum}`,
            values: [[officialTp, newTotal]]
          });
        }
      }
    }

    if (updates.length > 0) {
      await sheetsClient.spreadsheets.values.batchUpdate({
        spreadsheetId: GOOGLE_SHEET_ID,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });
      addLog(`💲 Updated ${updates.length} existing order row(s) in Live_Orders to new TRADE PRICE.`);
    }
  } catch (err) {
    addLog(`⚠️ Trade price migration note: ${err.message}`);
  }
}

// ============================================================================
// 9. PERMANENT CLOUD SESSION & CONFIG BACKUP IN GOOGLE SHEETS (_Bot_State)
// ============================================================================
let stateBackupTimer = null;

async function backupAuthAndConfigToSheet() {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return;
  try {
    const authFiles = {};
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        // Back up ALL .json files including pre-key-*.json so Signal group decryption never fails after restart!
        if (file.endsWith('.json')) {
          const fullPath = path.join(AUTH_DIR, file);
          if (fs.statSync(fullPath).isFile()) {
            authFiles[file] = fs.readFileSync(fullPath, 'utf8');
          }
        }
      }
    }

    const payloadJson = JSON.stringify({ authFiles, savedAt: new Date().toISOString() });
    const compressedBase64 = zlib.gzipSync(Buffer.from(payloadJson, 'utf8')).toString('base64');

    const chunks = [];
    for (let i = 0; i < compressedBase64.length; i += 40000) {
      chunks.push(compressedBase64.slice(i, i + 40000));
    }

    const stateRows = [
      ['Key', 'Value', 'Updated At'],
      ['BOT_CONFIG', JSON.stringify(botConfig), new Date().toISOString()],
      ['WA_AUTH_GZIP', chunks[0] || '', `${chunks.length} chunk(s)`]
    ];
    for (let c = 1; c < chunks.length; c++) {
      stateRows.push([`WA_AUTH_GZIP_${c}`, chunks[c], '']);
    }

    await sheetsClient.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.BOT_STATE}!A1:Z40`
    });
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.BOT_STATE}!A1`,
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
      range: `${SHEET_TABS.BOT_STATE}!A1:C40`
    });
    const rows = res.data.values || [];
    let compressedChunks = [];

    for (const row of rows) {
      const [key, val] = row;
      if (key === 'BOT_CONFIG' && val) {
        try {
          const parsedConfig = JSON.parse(val);
          botConfig = {
            ...botConfig,
            ...parsedConfig,
            authorizedImageLids: Array.from(
              new Set([
                ...DEFAULT_AUTHORIZED_LIDS,
                ...(botConfig.authorizedImageLids || []),
                ...(parsedConfig.authorizedImageLids || [])
              ])
            )
          };
          saveLocalConfig();
          addLog(`☁️ Restored saved group config: "${botConfig.targetGroupName}" (${botConfig.targetGroupId || 'All Groups'})`);
        } catch (e) {}
      } else if (key && key.startsWith('WA_AUTH_GZIP') && val) {
        compressedChunks.push(val);
      }
    }

    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (!fs.existsSync(credsPath) && compressedChunks.length > 0) {
      const fullBase64 = compressedChunks.join('');
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
// 10. GOOGLE SHEETS ORDER CRUD: SMART FIRST-EMPTY-ROW WRITE, UNSEND & /CNL
// ============================================================================
let sheetQueue = Promise.resolve();
function enqueueSheetTask(taskFn) {
  sheetQueue = sheetQueue.then(taskFn).catch((err) => {
    addLog(`❌ Sheet Queue Error: ${err.message}`);
  });
  return sheetQueue;
}

/**
 * Writes new order rows into the exact first empty row of Live_Orders
 * (Prevents blank row gaps when rows were manually cleared in Google Sheets!)
 */
async function appendOrdersToSheet(orders) {
  if (!orders || orders.length === 0) return;
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
      return;
    }

    const values = orders.map((o) => [
      o.orderLineId,
      o.whatsappMsgId,
      `'${o.date}`,
      `'${o.time}`,
      o.daId,
      o.altId,
      o.daName,
      o.senderPhone,
      o.psoCode,
      o.pharmacyName,
      o.rawText,
      o.crpCode,
      o.productName,
      o.packUnit,
      o.orderedQty,
      o.unitPrice,
      o.totalAmount,
      o.matchType,
      o.status
    ]);

    // Find the exact first empty row in Column A of Live_Orders so there are NEVER blank gaps
    const colARes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A1:A1000`
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

    addLog(
      `✅ Saved ${orders.length} order line(s) at Row ${targetStartRow} from ${orders[0].daName} (${orders[0].daId}) to Google Sheets.`
    );
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
        const fullRow = [...rows[r]];
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

    addLog(
      `🗑️ Auto-removed ${matchingZeroBasedIndices.length} order line(s) from Google Sheet (${reason}, Msg ID: ${whatsappMsgId}).`
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
// 11. WHATSAPP BAILEYS ENGINE (QR, GROUP MATCHER, 3X OCR, /CNL & UNSEND)
// ============================================================================
let sock = null;
let waStatus = 'DISCONNECTED';
let currentQrDataUrl = null;
let connectedUser = null;
let joinedGroups = [];
const recentOrders = [];
const activityLogs = [];
const stats = {
  startedAt: new Date().toISOString(),
  totalMessagesChecked: 0,
  totalOrdersSaved: 0,
  totalOrdersDeleted: 0,
  totalAmountSaved: 0
};

function addLog(msg) {
  const time = new Date().toLocaleTimeString('en-US', {
    timeZone: 'Asia/Dhaka',
    hour12: true
  });
  const entry = `[${time}] ${msg}`;
  console.log(entry);
  activityLogs.unshift(entry);
  if (activityLogs.length > 60) activityLogs.length = 60;
}

/**
 * Checks whether a group JID matches the user's configured target group (by ID, by Name, or All Groups)
 */
function isAllowedTargetGroup(remoteJid) {
  if (!remoteJid || !remoteJid.endsWith('@g.us')) return false;
  const cfgId = (botConfig.targetGroupId || '').trim();
  const cfgName = (botConfig.targetGroupName || '').trim().toLowerCase();

  // If set to ALL groups or both empty, allow any group the bot is in
  if (cfgId === 'ALL' || (!cfgId && !cfgName) || cfgName === 'all' || cfgName === 'all groups') {
    return true;
  }
  if (cfgId && remoteJid === cfgId) {
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

function inspectBaileysMessage(msg) {
  if (!msg || !msg.message) return { type: 'IGNORE' };

  const m = msg.message;

  const proto =
    m.protocolMessage ||
    m.ephemeralMessage?.message?.protocolMessage ||
    m.viewOnceMessage?.message?.protocolMessage;

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
    m.ephemeralMessage?.message?.imageMessage ||
    m.viewOnceMessage?.message?.imageMessage ||
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

  const extMsg = m.extendedTextMessage || m.ephemeralMessage?.message?.extendedTextMessage;
  const text =
    m.conversation ||
    extMsg?.text ||
    m.ephemeralMessage?.message?.conversation ||
    '';

  const quotedMsgId = extMsg?.contextInfo?.stanzaId || null;

  if (text.trim()) {
    return {
      type: 'TEXT',
      msgId: msg.key.id,
      text: text.trim(),
      quotedMsgId,
      remoteJid: msg.key.remoteJid
    };
  }

  return { type: 'IGNORE' };
}

function harvestLidMappingsFromGroups(groupsList) {
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
        if (AUTHORIZED_IMAGE_PHONES.includes(phonePart)) {
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

    // Sync targetGroupId if targetGroupName matches one of the joined groups
    if (botConfig.targetGroupName && botConfig.targetGroupId !== 'ALL') {
      const autoFound = joinedGroups.find(
        (g) =>
          g.subject.toLowerCase().trim() === botConfig.targetGroupName.toLowerCase().trim() ||
          g.subject.toLowerCase().includes(botConfig.targetGroupName.toLowerCase().trim())
      );
      if (autoFound && botConfig.targetGroupId !== autoFound.id) {
        botConfig.targetGroupId = autoFound.id;
        botConfig.targetGroupName = autoFound.subject;
        saveLocalConfig();
        scheduleCloudStateBackup(2000);
        addLog(`🎯 Synced target WhatsApp group: "${autoFound.subject}" (${autoFound.id})`);
      }
    }
    return joinedGroups;
  } catch (err) {
    addLog(`⚠️ Could not fetch group list: ${err.message}`);
    return joinedGroups;
  }
}

/**
 * Queries WhatsApp server for the exact @lid of +8801732273944 & +8801793362829 on connection open
 */
async function autoBindAuthorizedImagePhones() {
  if (!sock || waStatus !== 'CONNECTED') return;
  try {
    if (typeof sock.onWhatsApp === 'function') {
      const results = await sock.onWhatsApp(...AUTHORIZED_IMAGE_PHONES);
      for (const r of results || []) {
        const phoneNorm = normalizeBdPhone((r.jid || '').split('@')[0].split(':')[0]);
        const lidClean = (r.lid || '').split('@')[0].split(':')[0];
        if (lidClean && phoneNorm) {
          lidToPhoneMap.set(lidClean, phoneNorm);
          if (!botConfig.authorizedImageLids) botConfig.authorizedImageLids = [];
          if (!botConfig.authorizedImageLids.includes(lidClean)) {
            botConfig.authorizedImageLids.push(lidClean);
            addLog(`🔐 Auto-bound authorized image phone +${phoneNorm} -> LID ${lidClean}`);
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

    waStatus = 'CONNECTING';
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Renata CRP Order Tracker'),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined
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
        addLog(`🟢 WhatsApp Connected as ${connectedUser.name} (${connectedUser.id})`);

        // Critical: Ensure pre-keys are uploaded so group member messages never fail decryption!
        if (typeof sock.uploadPreKeysToServerIfRequired === 'function') {
          try {
            await sock.uploadPreKeysToServerIfRequired();
          } catch (e) {}
        }

        await autoBindAuthorizedImagePhones();
        await refreshJoinedGroups();
        scheduleCloudStateBackup(3000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        addLog(`🔴 WhatsApp connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          waStatus = 'DISCONNECTED';
          connectedUser = null;
          currentQrDataUrl = null;
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (e) {}
          setTimeout(() => startWhatsApp(), 3000);
        } else if (shouldReconnect) {
          waStatus = 'CONNECTING';
          setTimeout(() => startWhatsApp(), 4000);
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

          // Check "/bind" command FIRST across ALL groups and DMs (even before group filter!)
          const textOrCaption = (inspected.text || inspected.caption || '').trim();
          const bindMatch = textOrCaption.match(/^\/?bind(?:\s+([\+\d\-\s]{10,18}))?$/i);
          if (bindMatch) {
            const targetPh = bindMatch[1]
              ? normalizeBdPhone(bindMatch[1])
              : AUTHORIZED_IMAGE_PHONES[0];
            if (AUTHORIZED_IMAGE_PHONES.includes(targetPh)) {
              lidToPhoneMap.set(rawSenderId, targetPh);
              if (!botConfig.authorizedImageLids) botConfig.authorizedImageLids = [];
              if (!botConfig.authorizedImageLids.includes(rawSenderId)) {
                botConfig.authorizedImageLids.push(rawSenderId);
              }
              saveLocalConfig();
              scheduleCloudStateBackup(2000);
              addLog(`🔗 Bound sender ID ${rawSenderId} to authorized image phone +${targetPh}`);
              if (sock) {
                try {
                  await sock.sendMessage(
                    remoteJid,
                    { text: `✅ আপনার অ্যাকাউন্টটি (+${targetPh}, ID: ${rawSenderId}) ছবির অর্ডারের জন্য স্থায়ীভাবে যুক্ত হয়েছে!` },
                    { quoted: msg }
                  );
                } catch (e) {}
              }
              continue;
            }
          }

          // For group messages, check if group is allowed (unless it's an authorized image sender!)
          if (isGroup && !isAllowedTargetGroup(remoteJid)) {
            if (!(inspected.type === 'IMAGE' && isAuthorizedForImageOrder(msg, senderPhone))) {
              continue;
            }
          }

          // CASE 1: Message Unsent / Deleted for Everyone
          if (inspected.type === 'REVOKE') {
            addLog(`🚨 Unsend/Delete detected for Msg ID: ${inspected.targetMsgId}`);
            await removeOrdersByMessageId(inspected.targetMsgId, 'UNSENT_BY_USER');
            continue;
          }

          // CASE 2: Message Edited
          if (inspected.type === 'EDIT') {
            addLog(`✏️ Message Edit detected for Msg ID: ${inspected.targetMsgId}`);
            await removeOrdersByMessageId(inspected.targetMsgId, 'REPLACED_BY_EDIT');
            const parsedEdit = parseWhatsAppOrderMessage({
              messageText: inspected.text,
              messageId: inspected.targetMsgId,
              timestamp: msgTimestamp,
              senderPhone,
              senderPushName,
              senderJid
            });
            if (parsedEdit.isOrder && parsedEdit.orders.length > 0) {
              await appendOrdersToSheet(parsedEdit.orders);
            }
            continue;
          }

          // CASE 3: Handwritten / Paper Image Order (3-Retry + Keyless Vision AI Pipeline)
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

            addLog(`📸 Authorized image received from +${senderPhone || rawSenderId}. Starting 3-Stage OCR Pipeline...`);
            if (sock) {
              try {
                await sock.sendMessage(remoteJid, { react: { text: '⏳', key: msg.key } });
              } catch (e) {}
            }

            let imageBuffer = null;
            try {
              imageBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
              );
            } catch (dlErr) {
              addLog(`❌ Failed to download image media: ${dlErr.message}`);
              continue;
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
            imageBuffer = null; // Free memory immediately

            if (ocrPipelineResult.ok && ocrPipelineResult.parsed?.orders?.length > 0) {
              const orders = ocrPipelineResult.parsed.orders;
              await appendOrdersToSheet(orders);

              cancellableOrderMap.set(inspected.msgId, inspected.msgId);
              lastOrderBySenderMap.set(rawSenderId, inspected.msgId);
              if (senderPhone) lastOrderBySenderMap.set(senderPhone, inspected.msgId);

              const replyText = buildImageOrderReplyMessage(
                orders,
                ocrPipelineResult.engine,
                ocrPipelineResult.attemptUsed
              );
              if (sock) {
                try {
                  const sentReply = await sock.sendMessage(
                    remoteJid,
                    { text: replyText },
                    { quoted: msg }
                  );
                  if (sentReply?.key?.id) {
                    cancellableOrderMap.set(sentReply.key.id, inspected.msgId);
                  }
                  await sock.sendMessage(remoteJid, { react: { text: '✅', key: msg.key } });
                } catch (sendErr) {
                  addLog(`⚠️ Could not send confirmation reply: ${sendErr.message}`);
                }
              }
            } else {
              // All 3 server-side retries + Keyless Vision AI fallback exhausted without finding any CRP product
              addLog(
                `❌ All 3 OCR retries & Vision AI fallback found no valid CRP order. Extracted: "${(ocrPipelineResult.extractedText || '').replace(/\n/g, ' | ').slice(0, 180)}"`
              );
              if (sock) {
                try {
                  await sock.sendMessage(remoteJid, { react: { text: '⚠️', key: msg.key } });
                  await sock.sendMessage(
                    remoteJid,
                    {
                      text:
                        '⚠️ *ছবিটি ৩ বার অটো-রিচেক ও AI Vision দিয়ে চেক করার পরও কোনো CRP প্রোডাক্টের অর্ডার পাওয়া যায়নি।*\n' +
                        'অনুগ্রহ করে খাতার লেখাটি আরেকটু পরিষ্কার করে ছবি তুলে পাঠান।' +
                        (ocrPipelineResult.extractedText
                          ? `\n\n_শনাক্তকৃত লেখা:_\n${ocrPipelineResult.extractedText.slice(0, 220)}`
                          : '')
                    },
                    { quoted: msg }
                  );
                } catch (e) {}
              }
            }
            continue;
          }

          // CASE 4: Text Messages ("/cnl" Cancel Reply OR Standard Group Text Order)
          if (inspected.type === 'TEXT') {
            if (
              inspected.text.includes('ছবি থেকে অর্ডারটি Google Sheet-এ সেভ হয়েছে!') ||
              inspected.text.includes('অর্ডারটি বাতিল (/cnl) করা হয়েছে!') ||
              inspected.text.includes('ছবিটি ৩ বার অটো-রিচেক')
            ) {
              continue;
            }

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
              senderJid
            });

            if (parsed.isOrder && parsed.orders.length > 0) {
              await appendOrdersToSheet(parsed.orders);
              cancellableOrderMap.set(inspected.msgId, inspected.msgId);
              lastOrderBySenderMap.set(rawSenderId, inspected.msgId);
              if (botConfig.autoReactOnOrder && sock) {
                try {
                  await sock.sendMessage(remoteJid, {
                    react: { text: '✅', key: msg.key }
                  });
                } catch (e) {}
              }
            } else if (parsed.followUpPatch) {
              await applyFollowUpPatchToSheet(parsed.followUpPatch);
            }
          }
        } catch (err) {
          addLog(`❌ Error processing message: ${err.message}`);
        }
      }
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
                senderJid
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
// 12. EXPRESS WEB SERVER & NEO-BRUTALISM DASHBOARD UI
// ============================================================================
const app = express();
app.use(express.json({ limit: '8mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    version: '4.0-neo-brutalism',
    waStatus,
    googleAuthReady,
    targetGroup: botConfig.targetGroupName,
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
    authorizedImagePhones: AUTHORIZED_IMAGE_PHONES.map((p) => '+' + p),
    joinedGroups,
    stats,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    recentOrders: recentOrders.slice(0, 40),
    logs: activityLogs.slice(0, 50),
    productCount: activeProducts.length,
    daCount: DA_MASTER.length
  });
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
    // If user typed a groupName or picked from dropdown, sync ID & Name accurately from joinedGroups
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

  saveLocalConfig();
  await backupAuthAndConfigToSheet();
  addLog(`🔒 Group Config Saved: "${botConfig.targetGroupName}" [ID: ${botConfig.targetGroupId || 'ALL'}]`);
  res.json({ ok: true, botConfig });
});

app.post('/api/test-parse', async (req, res) => {
  const { messageText, senderPhone, senderName, saveToSheet, simulateUnsendMsgId } = req.body || {};

  if (simulateUnsendMsgId) {
    const removedCount = await removeOrdersByMessageId(simulateUnsendMsgId, 'CANCELLED_BY_CNL');
    return res.json({ ok: true, action: 'UNSEND_SIMULATED', removedCount });
  }

  const msgId = `TEST_${Date.now()}`;
  const result = parseWhatsAppOrderMessage({
    messageText: messageText || '',
    messageId: msgId,
    timestamp: new Date(),
    senderPhone: senderPhone || '8801732273944',
    senderPushName: senderName || 'Moajjem',
    senderJid: `${senderPhone || '8801732273944'}@s.whatsapp.net`
  });

  if (saveToSheet && result.isOrder && result.orders.length > 0) {
    await appendOrdersToSheet(result.orders);
  }

  res.json({ ok: true, msgId, ...result });
});

app.post('/api/sheets/sync', async (req, res) => {
  if (!googleAuthReady) {
    await initGoogleSheetsClient();
  }
  const ok = await ensureSpreadsheetStructure(true);
  await backupAuthAndConfigToSheet();
  res.json({ ok, googleAuthReady, googleAuthError, productCount: activeProducts.length });
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

// Serve Neo-Brutalism Dashboard UI at "/"
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Renata CRP Order Tracker v4.0 — Neo-Brutalism Command Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;600;700&family=Space+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FFFDF7;
      --ink: #000000;
      --yellow: #FFE600;
      --mint: #6EE7B7;
      --sky: #7DD3FC;
      --pink: #FF90E8;
      --coral: #FDA4AF;
      --lavender: #C4B5FD;
      --orange: #FDBA74;
      --white: #FFFFFF;
      --border: 3px solid #000000;
      --shadow: 6px 6px 0px #000000;
      --shadow-sm: 4px 4px 0px #000000;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Space Grotesk', 'Hind Siliguri', sans-serif;
      background-color: var(--bg);
      background-image: radial-gradient(#000000 1.15px, transparent 1.15px);
      background-size: 24px 24px;
      color: var(--ink);
      line-height: 1.5;
      padding: 22px;
    }
    .container { max-width: 1280px; margin: 0 auto; }

    /* Neo-Brutalist Hero Header */
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: var(--yellow);
      border: 3.5px solid var(--ink);
      box-shadow: 8px 8px 0px var(--ink);
      padding: 22px 26px;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    header h1 {
      font-size: 1.55rem;
      font-weight: 800;
      color: var(--ink);
      letter-spacing: -0.5px;
      text-transform: uppercase;
    }
    header p {
      color: #1e293b;
      font-size: 0.95rem;
      font-weight: 600;
      margin-top: 4px;
    }

    /* Neo-Brutalist Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 0.84rem;
      font-weight: 800;
      border: 2.5px solid var(--ink);
      box-shadow: 3px 3px 0px var(--ink);
      background: var(--white);
      color: var(--ink);
    }
    .badge.ok { background: var(--mint); }
    .badge.warn { background: var(--orange); }
    .badge.err { background: var(--coral); }
    .badge.info { background: var(--lavender); }

    /* Stats Row */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      border: var(--border);
      box-shadow: var(--shadow);
      padding: 16px 18px;
      border-radius: 12px;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .stat-card:hover {
      transform: translate(-2px, -2px);
      box-shadow: 8px 8px 0px var(--ink);
    }
    .stat-card.c1 { background: #A7F3D0; }
    .stat-card.c2 { background: #BAE6FD; }
    .stat-card.c3 { background: #FEF08A; }
    .stat-card.c4 { background: #FECDD3; }
    .stat-card.c5 { background: #DDD6FE; }
    .stat-card .lbl {
      font-size: 0.8rem;
      font-weight: 800;
      text-transform: uppercase;
      color: var(--ink);
      opacity: 0.85;
    }
    .stat-card .val {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--ink);
      margin-top: 6px;
    }

    /* Main Grid & Cards */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 22px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--white);
      border: var(--border);
      box-shadow: var(--shadow);
      border-radius: 12px;
      overflow: hidden;
    }
    .card-header {
      padding: 14px 20px;
      border-bottom: var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      font-weight: 800;
      font-size: 1.05rem;
    }
    .card-header.h-pink { background: var(--pink); }
    .card-header.h-mint { background: var(--mint); }
    .card-header.h-sky { background: var(--sky); }
    .card-header.h-yellow { background: var(--yellow); }
    .card-header.h-lavender { background: var(--lavender); }
    .card-body { padding: 20px; }

    /* QR Box */
    .qr-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: #FFFDF7;
      border: 2.5px dashed var(--ink);
      border-radius: 10px;
      min-height: 245px;
      text-align: center;
    }
    .qr-box img {
      max-width: 225px;
      border-radius: 8px;
      border: 3px solid var(--ink);
      box-shadow: var(--shadow-sm);
      margin-bottom: 12px;
      background: #fff;
    }

    /* Inputs & Controls */
    label {
      display: block;
      font-size: 0.86rem;
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 6px;
      margin-top: 12px;
    }
    select, input[type="text"], input[type="password"], textarea {
      width: 100%;
      background: #FFFDF7;
      border: 2.5px solid var(--ink);
      box-shadow: 3px 3px 0px var(--ink);
      color: var(--ink);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 0.92rem;
      font-weight: 600;
      font-family: inherit;
      outline: none;
    }
    select:focus, input:focus, textarea:focus {
      background: #FEF9C3;
    }
    textarea { min-height: 112px; font-family: monospace; resize: vertical; }

    /* Neo-Brutalist Tactile Buttons */
    .btn-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    button, .btn-link {
      cursor: pointer;
      border: 2.5px solid var(--ink);
      box-shadow: 4px 4px 0px var(--ink);
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 0.88rem;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      color: var(--ink);
      background: var(--white);
      transition: transform 0.08s ease, box-shadow 0.08s ease;
    }
    button:hover, .btn-link:hover {
      transform: translate(2px, 2px);
      box-shadow: 2px 2px 0px var(--ink);
    }
    button:active, .btn-link:active {
      transform: translate(4px, 4px);
      box-shadow: 0px 0px 0px var(--ink);
    }
    .btn-primary { background: var(--mint); }
    .btn-blue { background: var(--sky); }
    .btn-yellow { background: var(--yellow); }
    .btn-danger { background: var(--coral); }
    .btn-sm { padding: 6px 12px; font-size: 0.8rem; box-shadow: 3px 3px 0px var(--ink); }

    /* Table */
    .table-wrap {
      overflow-x: auto;
      max-height: 390px;
      overflow-y: auto;
      border: 2.5px solid var(--ink);
      border-radius: 8px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; background: var(--white); }
    th, td {
      padding: 10px 12px;
      border-bottom: 2px solid var(--ink);
      border-right: 1.5px solid var(--ink);
      text-align: left;
    }
    th {
      background: var(--ink);
      color: var(--yellow);
      font-weight: 800;
      text-transform: uppercase;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    tr:nth-child(even) td { background: #FFFDF5; }
    tr:hover td { background: #FEF08A; }

    /* Log Terminal */
    .log-box {
      background: #111827;
      border: 3px solid var(--ink);
      box-shadow: inset 0 0 0 2px #000;
      border-radius: 8px;
      padding: 14px;
      height: 230px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.82rem;
      color: #A7F3D0;
    }
    .log-box div { padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.12); }

    .note-box {
      margin-top: 12px;
      padding: 10px 12px;
      background: #FEF08A;
      border: 2px solid var(--ink);
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>⚡ Renata PLC (NK Depot) — CRP Order Tracker v4.0</h1>
        <p>Neo-Brutalism Edition • 3x Auto-Retry + Keyless Vision AI OCR • Trade Price • /cnl Cancel</p>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
        <span id="waBadge" class="badge warn">⏳ WhatsApp...</span>
        <span id="sheetBadge" class="badge warn">⏳ Sheet...</span>
        <span id="ramBadge" class="badge info">⚡ RAM: -- MB</span>
        <a id="openSheetBtn" href="#" target="_blank" class="btn-link btn-blue">📊 Open Google Sheet</a>
      </div>
    </header>

    <div class="stats-row">
      <div class="stat-card c1">
        <div class="lbl">🎯 সক্রিয় গ্রুপ (Target Group)</div>
        <div class="val" id="statGroup" style="font-size:1.05rem;">Loading...</div>
      </div>
      <div class="stat-card c2">
        <div class="lbl">📦 মোট সেভ অর্ডার (Saved Lines)</div>
        <div class="val" id="statSaved">0</div>
      </div>
      <div class="stat-card c3">
        <div class="lbl">💰 মোট অর্ডার (Trade Price)</div>
        <div class="val" id="statAmount">৳0.00</div>
      </div>
      <div class="stat-card c4">
        <div class="lbl">🗑️ আনসেন্ড / /cnl রিমুভড</div>
        <div class="val" id="statDeleted">0</div>
      </div>
      <div class="stat-card c5">
        <div class="lbl">📸 ছবির অর্ডার অনুমোদিত নম্বর</div>
        <div class="val" style="font-size:0.88rem; line-height:1.35;">+8801732273944 ✅<br/>+8801793362829 ✅</div>
      </div>
    </div>

    <div class="grid">
      <!-- STEP 1: WHATSAPP LOGIN -->
      <div class="card">
        <div class="card-header h-pink">
          <span>১. WhatsApp কানেকশন (Cloud Auto-Save)</span>
          <button class="btn-danger btn-sm" onclick="logoutWhatsApp()">Change Account</button>
        </div>
        <div class="card-body">
          <div id="qrContainer" class="qr-box">
            <p style="font-weight:700;">Loading WhatsApp status...</p>
          </div>
          <div class="note-box">
            📸 <b>৩ বার অটো-রিচেক OCR:</b> <b>+8801732273944</b> এবং <b>+8801793362829</b> থেকে অর্ডারের ছবি পাঠালে সার্ভার নিজে থেকেই ৩ বার ভিন্ন ভিন্ন মেথডে (Handwriting OCR + Keyless AI Vision) রিচেক করবে—তাই একই ছবি বারবার পাঠাতে হবে না!
          </div>
        </div>
      </div>

      <!-- STEP 2: GROUP SELECTOR & SETTINGS -->
      <div class="card">
        <div class="card-header h-mint">
          <span>২. WhatsApp গ্রুপ ও সেটিংস</span>
          <button class="btn-yellow btn-sm" onclick="refreshGroups()">🔄 গ্রুপ রিফ্রেশ</button>
        </div>
        <div class="card-body">
          <label>আপনার WhatsApp গ্রুপ সিলেক্ট করুন:</label>
          <select id="groupSelect" onchange="onGroupDropdownChange()">
            <option value="ALL">🌐 All Joined Groups (সব গ্রুপ থেকে অর্ডার নিবে)</option>
          </select>

          <label>অথবা নির্দিষ্ট গ্রুপের নাম:</label>
          <input type="text" id="targetGroupNameInput" placeholder="e.g. CRP sales NK Depot" oninput="onGroupNameManualInput()" />
          <input type="hidden" id="targetGroupIdInput" />

          <label>অতিরিক্ত Gemini API Key (ঐচ্ছিক — না দিলেও ফ্রি AI Vision কাজ করবে):</label>
          <input type="password" id="geminiKeyInput" placeholder="কোনো API Key ছাড়াই 3-Stage AI OCR সচল আছে" />

          <label style="display:flex; align-items:center; gap:8px; margin-top:14px; cursor:pointer;">
            <input type="checkbox" id="autoReactCheckbox" style="width:18px; height:18px; accent-color:#000;" checked />
            অর্ডার সেভ হলে মেসেজে অটোমেটিক ✅ রিয়েকশন দিবে
          </label>

          <div class="btn-row">
            <button class="btn-primary" onclick="saveGroupConfig()">💾 Save Group Settings</button>
            <button class="btn-blue" onclick="syncSheetStructure()">💲 Sync Trade Price to Sheet</button>
          </div>
          <p id="saveStatusMsg" style="font-size:0.86rem; font-weight:800; color:#047857; margin-top:10px;"></p>
        </div>
      </div>

      <!-- STEP 3: LIVE ORDER & /CNL SIMULATOR -->
      <div class="card">
        <div class="card-header h-sky">
          <span>🧪 ৩. লাইভ অর্ডার ও /cnl টেস্টার</span>
        </div>
        <div class="card-body">
          <label>যেকোনো অর্ডার মেসেজ লিখে Trade Price হিসাব টেস্ট করুন:</label>
          <textarea id="testInput">Cf 4526 Seraj
Cus name: Nipun pharmacy pso E71
TotiFen 50
Doxicup 10 pes
Deltason 50ml 20 ta
Locan r 150mg = 10</textarea>
          <div class="btn-row">
            <button class="btn-yellow" onclick="runTestParse(false)">🔍 Test Parser</button>
            <button class="btn-primary" onclick="runTestParse(true)">🚀 Test & Save to Sheet</button>
            <button id="simUnsendBtn" class="btn-danger" style="display:none;" onclick="simulateUnsend()">🗑️ Test /cnl Cancel</button>
          </div>
          <div id="testResultBox" style="margin-top:12px; font-size:0.84rem; font-weight:600;"></div>
        </div>
      </div>
    </div>

    <!-- RECENT PARSED ORDERS TABLE WITH CLEAR BUTTON -->
    <div class="card" style="margin-bottom:24px;">
      <div class="card-header h-yellow">
        <span>📋 সর্বশেষ ট্র্যাক হওয়া অর্ডারসমূহ (Live Parsed Orders)</span>
        <button class="btn-danger btn-sm" onclick="clearLiveOrders()">🧹 Clear Orders List (মেমোরি খালি করুন)</button>
      </div>
      <div class="card-body">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>DA ID & Name</th>
                <th>PSO</th>
                <th>Pharmacy / Party</th>
                <th>Raw WhatsApp Text</th>
                <th>Official CRP Product</th>
                <th>Qty</th>
                <th>Trade Price</th>
                <th>Total (BDT)</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody id="ordersTableBody">
              <tr><td colspan="10" style="text-align:center; font-weight:700;">মেমোরি বাফারে কোনো অর্ডার নেই (Google Sheet-এ আপনার সব অর্ডার সুরক্ষিত আছে)।</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SYSTEM ACTIVITY LOGS WITH CLEAR BUTTON -->
    <div class="card">
      <div class="card-header h-lavender">
        <span>🖥️ সিস্টেম লগ (Live Server Logs)</span>
        <button class="btn-danger btn-sm" onclick="clearServerLogs()">🧹 Clear Server Logs (লগ ক্লিয়ার করুন)</button>
      </div>
      <div class="card-body">
        <div id="logBox" class="log-box"></div>
      </div>
    </div>
  </div>

  <script>
    let lastTestMsgId = null;
    let groupInputTouched = false;
    let lastGroupsCount = -1;

    function onGroupNameManualInput() {
      groupInputTouched = true;
      // Clear hidden ID so backend resolves the new group ID from the typed name!
      document.getElementById('targetGroupIdInput').value = '';
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const waBadge = document.getElementById('waBadge');
        if (data.waStatus === 'CONNECTED') {
          waBadge.className = 'badge ok';
          waBadge.textContent = '🟢 WhatsApp Connected';
        } else if (data.waStatus === 'QR_READY') {
          waBadge.className = 'badge warn';
          waBadge.textContent = '📲 Scan QR Code';
        } else {
          waBadge.className = 'badge err';
          waBadge.textContent = '⏳ ' + data.waStatus;
        }

        const sheetBadge = document.getElementById('sheetBadge');
        if (data.googleAuthReady) {
          sheetBadge.className = 'badge ok';
          sheetBadge.textContent = '🟢 Sheet Connected';
        } else {
          sheetBadge.className = 'badge err';
          sheetBadge.textContent = '⚠️ Sheet Auth Needed';
        }

        document.getElementById('ramBadge').textContent = '⚡ RAM: ' + (data.memoryMB || 0) + ' MB';
        document.getElementById('openSheetBtn').href = data.googleSheetUrl;

        document.getElementById('statGroup').textContent =
          data.botConfig.targetGroupName || data.botConfig.targetGroupId || 'All Joined Groups';
        document.getElementById('statSaved').textContent = data.stats.totalOrdersSaved;
        document.getElementById('statAmount').textContent =
          '৳' + Number(data.stats.totalAmountSaved || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('statDeleted').textContent = data.stats.totalOrdersDeleted;

        const qrBox = document.getElementById('qrContainer');
        if (data.waStatus === 'CONNECTED' && data.connectedUser) {
          qrBox.innerHTML =
            '<div style="font-size:2.6rem; margin-bottom:6px;">✅</div>' +
            '<h3 style="font-weight:800;">WhatsApp সচল এবং লগইন সেভ করা আছে!</h3>' +
            '<p style="font-size:0.9rem; font-weight:700; margin-top:4px;">Account: <b>' +
            data.connectedUser.name +
            '</b> (' +
            data.connectedUser.id.split(':')[0] +
            ')</p>' +
            '<span class="badge ok" style="margin-top:12px;">☁️ Permanent Cloud Backup Active</span>';
        } else if (data.qrDataUrl) {
          qrBox.innerHTML =
            '<img src="' +
            data.qrDataUrl +
            '" alt="WhatsApp QR Code" />' +
            '<p style="font-weight:800; font-size:0.9rem;">আপনার ফোনের WhatsApp ➔ Linked Devices থেকে এই QR কোডটি স্ক্যান করুন</p>';
        } else {
          qrBox.innerHTML =
            '<p style="font-weight:700;">🔄 WhatsApp কানেক্ট হচ্ছে / QR তৈরি হচ্ছে... অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করুন।</p>';
        }

        const select = document.getElementById('groupSelect');
        const groups = data.joinedGroups || [];
        if (groups.length !== lastGroupsCount && !groupInputTouched) {
          lastGroupsCount = groups.length;
          select.innerHTML = '<option value="ALL">🌐 All Joined Groups (সব গ্রুপ থেকে অর্ডার নিবে)</option>';
          groups.forEach((g) => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.dataset.name = g.subject;
            opt.textContent = g.subject + ' (' + g.size + ' members)';
            if (data.botConfig.targetGroupId === g.id) opt.selected = true;
            select.appendChild(opt);
          });
        }

        if (!groupInputTouched) {
          document.getElementById('targetGroupNameInput').value = data.botConfig.targetGroupName || '';
          document.getElementById('targetGroupIdInput').value = data.botConfig.targetGroupId || '';
          document.getElementById('autoReactCheckbox').checked = !!data.botConfig.autoReactOnOrder;
        }

        const tbody = document.getElementById('ordersTableBody');
        if (data.recentOrders && data.recentOrders.length > 0) {
          tbody.innerHTML = data.recentOrders
            .map(
              (o) =>
                '<tr>' +
                '<td><b>' + o.date + '</b><br/>' + o.time + '</td>' +
                '<td><b>' + o.daId + '</b><br/><span>' + o.daName + '</span></td>' +
                '<td><b>' + o.psoCode + '</b></td>' +
                '<td>' + o.pharmacyName + '</td>' +
                '<td><b>' + o.rawText + '</b></td>' +
                '<td><b>[' + o.crpCode + ']</b> ' + o.productName + '</td>' +
                '<td><b>' + o.orderedQty + '</b></td>' +
                '<td>৳' + Number(o.unitPrice).toFixed(2) + '</td>' +
                '<td style="font-weight:800;">৳' + Number(o.totalAmount).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>' +
                '<td>' + o.matchType + '</td>' +
                '</tr>'
            )
            .join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; font-weight:700;">মেমোরি বাফারে কোনো অর্ডার নেই (Google Sheet-এ আপনার সব অর্ডার সুরক্ষিত আছে)।</td></tr>';
        }

        const logBox = document.getElementById('logBox');
        logBox.innerHTML = (data.logs || []).map((l) => '<div>' + l + '</div>').join('');
      } catch (e) {}
    }

    function onGroupDropdownChange() {
      const sel = document.getElementById('groupSelect');
      const opt = sel.options[sel.selectedIndex];
      if (!opt) return;
      groupInputTouched = true;
      if (opt.value === 'ALL') {
        document.getElementById('targetGroupIdInput').value = 'ALL';
        document.getElementById('targetGroupNameInput').value = 'All Joined Groups (সব গ্রুপ)';
      } else {
        document.getElementById('targetGroupIdInput').value = opt.value;
        document.getElementById('targetGroupNameInput').value = opt.dataset.name || '';
      }
    }

    async function refreshGroups() {
      const res = await fetch('/api/groups/refresh', { method: 'POST' });
      const data = await res.json();
      lastGroupsCount = -1;
      groupInputTouched = false;
      await fetchStatus();
      alert('গ্রুপ লিস্ট আপডেট হয়েছে! মোট গ্রুপ: ' + (data.groups || []).length);
    }

    async function saveGroupConfig() {
      const groupId = document.getElementById('targetGroupIdInput').value;
      const groupName = document.getElementById('targetGroupNameInput').value;
      const autoReactOnOrder = document.getElementById('autoReactCheckbox').checked;
      const geminiApiKey = document.getElementById('geminiKeyInput').value;

      const res = await fetch('/api/config/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, groupName, autoReactOnOrder, geminiApiKey })
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('saveStatusMsg').textContent =
          '✅ গ্রুপ সেটিংস স্থায়ীভাবে সেভ হয়েছে: ' + (data.botConfig.targetGroupName || 'All');
        document.getElementById('geminiKeyInput').value = '';
        groupInputTouched = false;
        fetchStatus();
      }
    }

    async function syncSheetStructure() {
      const res = await fetch('/api/sheets/sync', { method: 'POST' });
      const data = await res.json();
      alert(data.ok ? '✅ Google Sheet-এর সব প্রোডাক্টের দাম অফিশিয়াল TRADE PRICE অনুযায়ী সিঙ্ক হয়েছে!' : '⚠️ Error: ' + data.googleAuthError);
      fetchStatus();
    }

    async function clearLiveOrders() {
      const res = await fetch('/api/orders/clear', { method: 'POST' });
      const data = await res.json();
      if (data.ok) fetchStatus();
    }

    async function clearServerLogs() {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      const data = await res.json();
      if (data.ok) fetchStatus();
    }

    async function runTestParse(saveToSheet) {
      const messageText = document.getElementById('testInput').value;
      const res = await fetch('/api/test-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText, saveToSheet })
      });
      const data = await res.json();
      const box = document.getElementById('testResultBox');
      if (data.orders && data.orders.length > 0) {
        if (saveToSheet) {
          lastTestMsgId = data.msgId;
          document.getElementById('simUnsendBtn').style.display = 'inline-flex';
        }
        box.innerHTML =
          '<div style="background:#A7F3D0; border:2px solid #000; padding:10px; border-radius:8px; margin-bottom:6px;">✅ শনাক্ত হয়েছে ' +
          data.orders.length +
          'টি অর্ডার লাইন (DA: ' +
          data.orders[0].daId +
          ' - ' +
          data.orders[0].daName +
          ', Party: ' +
          data.orders[0].pharmacyName +
          '):<br/>' +
          data.orders
            .map(
              (o) =>
                '• <b>' +
                o.rawText +
                '</b> ➔ <b>[' +
                o.crpCode +
                '] ' +
                o.productName +
                '</b> | Qty: <b>' +
                o.orderedQty +
                '</b> × ৳' +
                o.unitPrice.toFixed(2) +
                ' = <b>৳' +
                o.totalAmount.toFixed(2) +
                '</b>'
            )
            .join('<br/>') +
          '</div>';
      } else {
        box.innerHTML = '<div style="background:#FECDD3; border:2px solid #000; padding:10px; border-radius:8px;">⚠️ কোনো CRP প্রোডাক্ট অর্ডার পাওয়া যায়নি।</div>';
      }
      fetchStatus();
    }

    async function simulateUnsend() {
      if (!lastTestMsgId) return;
      const res = await fetch('/api/test-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulateUnsendMsgId: lastTestMsgId })
      });
      const data = await res.json();
      document.getElementById('testResultBox').innerHTML =
        '<div style="background:#FECDD3; border:2px solid #000; padding:10px; border-radius:8px;">❌ /cnl ক্যান্সেল সফল! মেসেজ (' +
        lastTestMsgId +
        ') এর ' +
        data.removedCount +
        'টি অর্ডার Google Sheet থেকে অটোমেটিক মুছে ফেলা হয়েছে!</div>';
      lastTestMsgId = null;
      document.getElementById('simUnsendBtn').style.display = 'none';
      fetchStatus();
    }

    async function logoutWhatsApp() {
      if (!confirm('আপনি কি নিশ্চিত যে বর্তমান WhatsApp অ্যাকাউন্ট পরিবর্তন করে নতুন QR কোড নিতে চান?')) return;
      await fetch('/api/whatsapp/logout', { method: 'POST' });
      fetchStatus();
    }

    fetchStatus();
    setInterval(fetchStatus, 3500);
  </script>
</body>
</html>`);
});

// ============================================================================
// 13. RENDER FREE-TIER SELF-PING KEEP-ALIVE & SERVER BOOTSTRAP
// ============================================================================
function startKeepAliveLoop() {
  setInterval(async () => {
    const targetUrl = RENDER_EXTERNAL_URL
      ? `${RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health`
      : `http://127.0.0.1:${PORT}/health`;
    try {
      await fetch(targetUrl);
    } catch (e) {}
  }, 10 * 60 * 1000);
}

async function bootstrap() {
  app.listen(PORT, '0.0.0.0', async () => {
    addLog(`🚀 Server v4.0 (Neo-Brutalism Edition) listening on port ${PORT}`);
    await initGoogleSheetsClient();
    if (googleAuthReady) {
      // Restore cloud config & WhatsApp auth session FIRST before ensuring spreadsheet structure!
      await restoreAuthAndConfigFromSheet();
      await ensureSpreadsheetStructure(true);
    }
    await startWhatsApp();
    startKeepAliveLoop();
  });
}

if (require.main === module) {
  bootstrap();
}

module.exports = {
  DEFAULT_CRP_PRODUCTS,
  DA_MASTER,
  AUTHORIZED_IMAGE_PHONES,
  DEFAULT_AUTHORIZED_LIDS,
  matchCRPProduct,
  extractOrderQuantity,
  normalizeOcrOrderText,
  parseWhatsAppOrderMessage,
  inspectBaileysMessage,
  isAuthorizedForImageOrder,
  isAllowedTargetGroup,
  processImageOrderWithThreeRetries,
  buildImageOrderReplyMessage
};
