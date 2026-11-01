/**
 * ============================================================================
 * RENATA PLC (NOAKHALI DEPOT) — WHATSAPP GROUP CRP ORDER TRACKER (v5.0 PRO)
 * DYNAMIC JSON MASTER DATABASE + SELF-LEARNING AI BOT + NEO-BRUTALISM UI
 * ============================================================================
 * What's New in v5.0:
 * 1. Fixed Image Order CF10145 Fallback Bug:
 *    - Removed admin phones (+8801793362829 / +8801732273944) from CF10145's phone
 *      list and disabled sender-phone/cache fallback on image/admin orders so an
 *      image without a written CF/RF/C ID NEVER wrongly saves as CF10145 (Moajjem)!
 * 2. Web-Manageable Dynamic JSON Master Database (master_db.json + _Bot_State GZIP):
 *    - Full Web CRUD for DAs (Add, Edit, Delete single, Remove All, Reset)
 *    - Full Web CRUD for Products (Add, Edit Code/Name/Price/Unit, Add/Edit Wrong
 *      Spellings/Aliases, Delete, Reset)
 *    - Multiple Admin Alert Numbers (default: +8801793362829) & Multiple Authorized
 *      Image Order Numbers (default: +8801732273944, +8801793362829) manageable from Web!
 *    - Zero extra RAM/CPU load: runs in-memory with instant local JSON + compressed
 *      cloud backup in Google Sheets (_Bot_State!MASTER_DB_GZIP).
 * 3. Self-Learning WhatsApp Interactive Resolution via 01793362829 (and Admin Numbers):
 *    - Unknown / Missing DA ID or Name (#DA...):
 *      * If a new ID + clear Name is written together, auto-adds to DA database!
 *      * If ID or Name is missing/unknown, holds the order and messages 01793362829.
 *        When Admin replies with ID/Name, auto-saves to DA DB and pushes order to Sheet!
 *    - Unknown Product / Unrecognized Spelling (#PR...):
 *      * If a group/image order line has a medicine + quantity that cannot be matched,
 *        holds that line and messages 01793362829 asking what product it is.
 *      * When Admin replies with the product name or code, auto-learns that wrong
 *        spelling into the product's aliases in the JSON DB and saves the order to Sheet!
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
const MASTER_DB_PATH = path.join(__dirname, 'master_db.json');

const DEFAULT_ADMIN_ALERT_PHONES = ['8801793362829'];
const DEFAULT_AUTHORIZED_IMAGE_PHONES = ['8801732273944', '8801793362829'];

// Pre-bound known WhatsApp Multi-Device @lid identifiers for +8801732273944 and +8801793362829
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

const DEFAULT_DA_MASTER = [
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
  { daId: 'CF10145', altId: 'RF9084', name: 'Moajjem', phones: [], aliases: ['moajjem', 'moazzem', 'rf9084'] }
];

// ============================================================================
// 3B. DYNAMIC JSON MASTER DATABASE ENGINE (IN-MEMORY + DISK + CLOUD GZIP)
// ============================================================================
let masterDb = {
  das: JSON.parse(JSON.stringify(DEFAULT_DA_MASTER)),
  products: JSON.parse(JSON.stringify(DEFAULT_CRP_PRODUCTS)),
  adminAlertPhones: [...DEFAULT_ADMIN_ALERT_PHONES],
  authorizedImagePhones: [...DEFAULT_AUTHORIZED_IMAGE_PHONES],
  updatedAt: new Date().toISOString()
};

// Pointers used by fast matching functions
let activeProducts = masterDb.products;
let activeDAs = masterDb.das;
let TRADE_PRICE_MAP = new Map(activeProducts.map((p) => [String(p.code), Number(p.price)]));

function rebuildMasterLookupCaches() {
  activeProducts = masterDb.products || [];
  activeDAs = masterDb.das || [];
  TRADE_PRICE_MAP = new Map(activeProducts.map((p) => [String(p.code), Number(p.price)]));
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
    // Ensure CF10145 does not carry admin phones in its phone fallback array unless explicitly added later
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
        ? Array.from(new Set(p.aliases.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean)))
        : []
    })).filter((p) => p.code && p.name);
  }
  if (Array.isArray(raw.adminAlertPhones) && raw.adminAlertPhones.length > 0) {
    masterDb.adminAlertPhones = Array.from(new Set(raw.adminAlertPhones.map((p) => normalizeBdPhone(p)).filter(Boolean)));
  }
  if (Array.isArray(raw.authorizedImagePhones) && raw.authorizedImagePhones.length > 0) {
    masterDb.authorizedImagePhones = Array.from(new Set(raw.authorizedImagePhones.map((p) => normalizeBdPhone(p)).filter(Boolean)));
  }
  masterDb.updatedAt = raw.updatedAt || new Date().toISOString();
  rebuildMasterLookupCaches();
  if (shouldSaveLocal) {
    saveLocalMasterDb();
  }
}

function saveLocalMasterDb() {
  try {
    masterDb.updatedAt = new Date().toISOString();
    rebuildMasterLookupCaches();
    fs.writeFileSync(MASTER_DB_PATH, JSON.stringify(masterDb, null, 2), 'utf8');
  } catch (e) {}
}

// ============================================================================
// 4. FUZZY SPELL-CHECKING, DYNAMIC ALIASES & VARIANT DISAMBIGUATION ENGINE
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
  return v1[b.length];
}

function stringSimilarity(s1, s2) {
  const longer = s1.length >= s2.length ? s1 : s2;
  const shorter = s1.length >= s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  if (shorter.length === 0) return 0.0;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function resolveBrandFamilyVariant(family, rawTextLower) {
  const byCode = (c) => activeProducts.find((p) => String(p.code).toUpperCase() === String(c).toUpperCase());
  const text = rawTextLower.replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2');

  switch (family) {
    case 'DOMIREN': {
      if (/\b(tab|tap|tb|tablet|fc|10\s*mg)\b/i.test(text)) return byCode('60');
      if (/\b60\s*(ml)?\b/i.test(text) && !/\b100\s*ml\b/i.test(text)) return byCode('286');
      return byCode('990');
    }
    case 'DELTASONE': {
      if (/\b(tab|tap|tb|tablet|5\s*mg|17\s*[\*x]\s*30)\b/i.test(text)) return byCode('CS7');
      if (/\b100\s*(ml)?\b/i.test(text) && !/\b50\s*ml\b/i.test(text)) return byCode('637');
      return byCode('636');
    }
    case 'ZITHRIN': {
      if (/\b50\s*(ml)?\b/i.test(text)) return byCode('290');
      if (/\b20\s*(ml)?\b/i.test(text)) return byCode('270');
      if (/\b15\s*(ml)?\b/i.test(text)) return byCode('173');
      if (/\b30\s*(ml)?\b/i.test(text)) return byCode('834');
      return byCode('271');
    }
    case 'LUCAN-R': {
      if (/\b200\s*(mg)?\b/i.test(text)) return byCode('621');
      if (/\b150\s*(mg)?\b/i.test(text)) return byCode('605');
      if (/\b50\s*(mg)?\b/i.test(text)) return byCode('876');
      if (/\b(cap|caps|capsule)\b/i.test(text) && !/\b(syp|syr|sry|susp|35)\b/i.test(text)) {
        return byCode('876');
      }
      return byCode('112');
    }
    case 'FLONTIN': {
      if (/\b(syp|syr|sry|sryp|syrp|srp|susp|60\s*ml)\b/i.test(text)) return byCode('226');
      return byCode('96');
    }
    case 'FUROCEF': {
      if (/\b(ds|50\s*ml)\b/i.test(text)) return byCode('S72');
      return byCode('102');
    }
    case 'VITA': {
      if (/\b(20000|20\s*k)\b/i.test(text)) return byCode('S15');
      return byCode('S16');
    }
    case 'NEXDEX': {
      if (/\b60\s*(mg)?\b/i.test(text)) return byCode('SA1');
      return byCode('SA4');
    }
    case 'PCAB': {
      if (/\b10\s*(mg)?\b/i.test(text)) return byCode('C2Y');
      return byCode('C2Z');
    }
    case 'BECONEX': {
      if (/\b(zi|z\s*i)\b/i.test(text)) return byCode('233');
      if (/\b100\s*(ml)?\b/i.test(text) && !/\b200\s*ml\b/i.test(text)) return byCode('33');
      return byCode('34');
    }
    case 'PROTONIL': {
      if (/\b40\s*(mg)?\b/i.test(text)) return byCode('267');
      return byCode('266');
    }
    case 'FLUSTAR': {
      if (/\b(syp|syr|sry|syrup|sys|dry|100\s*ml)\b/i.test(text)) return byCode('N33');
      return byCode('607');
    }
    case 'RECOX': {
      if (/\b120\s*(mg)?\b/i.test(text)) return byCode('N49');
      return byCode('N47');
    }
    case 'COPNAT': {
      if (/\b(cream|crem|creem|crm)\b/i.test(text)) return byCode('SZ4');
      return byCode('SZ5');
    }
    case 'MOODS': {
      if (/\b(electrify|electrifry)\b/i.test(text)) return byCode('H88');
      if (/\b(gold|gola|1500)\b/i.test(text)) return byCode('H89');
      if (/\b(dotted|dot)\b/i.test(text)) return byCode('H37');
      if (/\b(ulta|ultra|thin)\b/i.test(text)) return byCode('H34');
      return byCode('H39');
    }
    case 'FENADIN': {
      if (/\b(30\s*ml|small|smal)\b/i.test(text)) return byCode('69');
      return byCode('933');
    }
    case 'ALGIN': {
      if (/\b50\s*(ml)?\b/i.test(text)) return byCode('C62');
      return byCode('989');
    }
    case 'MAZIC': {
      if (/\b(jr|4\.05)\b/i.test(text)) return byCode('16');
      return byCode('18');
    }
    default: {
      return activeProducts.find((p) => p.family === family) || null;
    }
  }
}

const BRAND_FAMILY_PATTERNS = [
  { family: 'TOTIFEN', regex: /\b(tot[iey]?f[ei]?n|totipen|toti\s*fen|totifen)\b/i },
  { family: 'DOXICAP', regex: /\b(dox[iy]?c[auo]p|doxy\s*cap|doxecap)\b/i },
  { family: 'DOMIREN', regex: /\b(dom[iey]?r[ea]n|domniren|domira|dumiren|dmiren)\b/i },
  { family: 'DELTASONE', regex: /\b(d[ea]ltas[oa]ne?|d[ea]lt[ea]r?s[oa]n|delta\s*s[oa][mn]e?|dell?thesun|deltasonne)\b/i },
  { family: 'PRAZOLE', regex: /\b(pr?a[zj]ole?|parzol|frazol|pazal)\b/i },
  { family: 'ZITHRIN', regex: /\b(z[ri]?th?r[ie]n|zitrin|zitthrin|ziyhrin|zithirin)\b/i },
  { family: 'XAMIC', regex: /\b(xamic|xmaic|examic|zamic)\b/i },
  { family: 'RECOF', regex: /\b(recof|recop|rekof)\b/i },
  { family: 'TRULAX', regex: /\b(trul[ae]x|tulax|trulux)\b/i },
  { family: 'LUCAN-R', regex: /\b(l[ou]c?[ak]a?n\s*[\-_]?r?|luknar|lokanar|lucar|luna\s*r|lunch\s*150)\b/i },
  { family: 'FLONTIN', regex: /\b(fl?ont[ie]ne?|foltin|flotin|falntin)\b/i },
  { family: 'NORMANAL', regex: /\b(norm[ao]n[ao]l|narmonal|nomanal|normal\s*500|normal(?=\s*[\-:=]?\s*\d))\b/i },
  { family: 'FUROCEF', regex: /\b(fe?uroc[ce]fe?|furosef|reocef)\b/i },
  { family: 'VITA', regex: /\b([vb]ita\s*d\s*3?|[vb]ita\s*(40000|20000))\b/i },
  { family: 'NEXDEX', regex: /\b(nexdex|nex\s*dex)\b/i },
  { family: 'PCAB', regex: /\b(p[\s\-_]?ca[bp]|pacb|picap)\b/i },
  { family: 'FERIX-V', regex: /\b(f[ea]rix\s*[\-_]?v|frix\s*v)\b/i },
  { family: 'DESOLON', regex: /\b(d[ea]s[eo]l[oa]ne?|dasalon|deslon|deslor)\b/i },
  { family: 'EMCON-1', regex: /\b(em\s*con(\s*[\-_]?\s*1)?|incone|emon(?=\s*[\-:=]?\s*\d))\b/i },
  { family: 'CONASYD', regex: /\b(conas[yi]d|conased|conacid)\b/i },
  { family: 'REDUCOF', regex: /\b(red[ui]cof|rducof|reducop)\b/i },
  { family: 'GESTRENOL', regex: /\b(g[ea]st[re]*n[oa]l|gestonal|gestanol|gestnol)\b/i },
  { family: 'EXICOF', regex: /\b(exic[oa][fp])\b/i },
  { family: 'RENASONE', regex: /\b(renas[oa][nl]e?)\b/i },
  { family: 'BECONEX', regex: /\b(b[ei]c?ox?ne[xz]|be\s*conex)\b/i },
  { family: 'STARK', regex: /\b(stark|strak)\b/i },
  { family: 'PROTONIL', regex: /\b(proton[ie]l)\b/i },
  { family: 'POLYCEF', regex: /\b(pol[yi]cef)\b/i },
  { family: 'BREDICON', regex: /\b(b[ar]?e?d[ei]con|badicon)\b/i },
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

  // 1. Check Custom / Learned Aliases in activeProducts first (longest alias first so specific sizes/spellings win)
  const cleanNormSpace = ` ${normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let bestAliasProd = null;
  let bestAliasLen = 0;

  for (const prod of activeProducts) {
    for (const rawAlias of prod.aliases || []) {
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
    // If alias did not specify size, allow family variant disambiguation when size is present in normalized
    const hasSizeInAlias = /\b(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5)\b/.test(String(bestAliasProd.name));
    const resolved = hasSizeInAlias
      ? (resolveBrandFamilyVariant(bestAliasProd.family, normalized) || bestAliasProd)
      : bestAliasProd;
    return { product: resolved, matchType: 'Alias/Learned', confidence: 0.99 };
  }

  // 2. Check Brand Family Regex Patterns
  for (const item of BRAND_FAMILY_PATTERNS) {
    if (item.regex.test(normalized)) {
      const product = resolveBrandFamilyVariant(item.family, normalized);
      if (product) {
        return { product, matchType: 'Pattern/Alias', confidence: 0.98 };
      }
    }
  }

  // 3. Check Direct Product Name Prefix
  for (const prod of activeProducts) {
    const cleanProdName = prod.name.toLowerCase().split(/\s+/)[0];
    if (cleanProdName.length >= 4 && normalized.includes(cleanProdName)) {
      const resolved = resolveBrandFamilyVariant(prod.family || cleanProdName.toUpperCase(), normalized) || prod;
      return { product: resolved, matchType: 'Direct', confidence: 0.95 };
    }
  }

  // 4. Fuzzy Token Similarity across all Product Names & Aliases
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
 * Detects if a line that failed matchCRPProduct is actually an unrecognized medicine order line
 * (e.g. "Toti syp - 20", "Napa extra 50 pcs", "Domirn 100ml = 30")
 */
function detectUnrecognizedProductLine(seg) {
  if (!seg || typeof seg !== 'string') return null;
  const trimmed = seg.trim();
  if (trimmed.length < 4 || trimmed.length > 85) return null;

  // Ignore DA ID lines, PSO lines, Pharmacy lines, phone numbers, or casual chat
  if (/\b(cf|rf|c)\s*[\-_.]?\s*\d{4,6}\b/i.test(trimmed)) return null;
  if (/\b(2100\d{2}|122\d{3}|055167)\b/.test(trimmed)) return null;
  if (extractPSOCode(trimmed)) return null;
  if (isPharmacyCandidateLine(trimmed)) return null;
  if (/\b01[3-9]\d{8}\b/.test(trimmed)) return null;
  if (/^(assalamu|salam|walekum|hi\b|hello|ok\b|okay|hmm|thanks|thank\s+you|welcome|alhamdulillah|inshallah|good\s+morning|good\s+night|date\b|da\s+name|da\s+id|order\b|total\b|sl\b)/i.test(trimmed)) {
    return null;
  }

  // Check if any known DA name or alias matches this line
  const lower = trimmed.toLowerCase();
  for (const da of activeDAs) {
    if (da.name && lower === da.name.toLowerCase()) return null;
    for (const al of da.aliases || []) {
      if (al.length >= 4 && lower === al.toLowerCase()) return null;
    }
  }

  // Must have a clear order quantity pattern (e.g. "= 20", "- 50", "30 ta", "10 pcs", "20 box", or "MedicineName 20")
  const hasOrderShape =
    /([a-zA-Z]{3,}.*?[\-:=]+\s*\d+\s*(?:ta|tah|pes|pcs|pc|pic|box|bx|bot|pack)?$)/i.test(trimmed) ||
    /([a-zA-Z]{3,}.*?\s+\d+\s*(?:ta|tah|pes|pcs|pc|pic|box|bx|bot|pack)\.?$)/i.test(trimmed) ||
    /^[*\d\/.)\s]*([a-zA-Z][a-zA-Z0-9\-\s]{2,35}?)\s+(\d{1,4})\s*$/i.test(trimmed);

  if (!hasOrderShape) return null;

  const qty = extractOrderQuantity(trimmed, null);
  if (qty === null || qty <= 0 || qty > 5000) return null;

  // Extract clean unknown product text by removing leading numbering and trailing quantity
  let unknownName = trimmed
    .replace(/^[*\d\/.)\-\s]+/, '')
    .replace(/[\-:=]+\s*\d+(?:\+\d+)?\s*(?:ta|tah|pes|pcs|pc|pic|box|bx|bot|pack)?\.?\s*$/i, '')
    .replace(/\s+\d+(?:\+\d+)?\s*(?:ta|tah|pes|pcs|pc|pic|box|bx|bot|pack)?\.?\s*$/i, '')
    .replace(/[*_~]+/g, '')
    .trim();

  if (!unknownName || unknownName.length < 3 || /^\d+$/.test(unknownName)) return null;
  if (!/[a-zA-Z]{3,}/.test(unknownName)) return null;

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

/**
 * Extracts a person name written right next to a new DA ID (e.g. "CF9988 Karim Uddin" or "ID: RF3012 - Rahim")
 */
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

/**
 * Resolves DA from message text and sender info using dynamic masterDb.das!
 * NEVER falls back to CF10145 or senderContextCache on Image Orders!
 */
function resolveDAFromMessageAndSender(fullText, senderPhone, senderPushName, senderJid, options = {}) {
  const { isImageOrder = false } = options;
  const cleanText = (fullText || '').toUpperCase();
  const cleanPhone = normalizeBdPhone(senderPhone);
  const cleanPush = (senderPushName || '').toLowerCase().trim();
  const isSenderAdmin = getAuthorizedImagePhones().includes(cleanPhone) || getAdminAlertPhones().includes(cleanPhone);

  // 1. Check Explicit CF / RF / C ID written in the message/image text
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

    // New/Unknown ID written in the message! Check if a clear name was written right next to the ID:
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

    // ID was found (e.g. CF9988) but Name is NOT in database and not written next to it -> Ask Admin 01793362829!
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

  // 2. Check Bare 6-digit C-IDs (e.g. 210022, 122210)
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

  // 3. Check if DA Name or Alias is explicitly written inside the message text
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

  // CRITICAL FIX: If this is an Image Order (or sent by an Admin phone), NEVER fall back to senderPhone or senderContextCache!
  // Otherwise, any image without a written ID sent by +8801793362829 would falsely save as CF10145 (Moajjem)!
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

  // 4. For regular group text messages from DAs, check senderPhone in activeDAs
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

  // 5. Check senderPushName against activeDAs aliases for regular group text messages
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

  // Unknown sender in group with no ID/Name -> Needs Admin confirmation!
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

      // Check if this segment is an unrecognized product order line (has medicine-like text + quantity)
      const unknownCandidate = detectUnrecognizedProductLine(seg);
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
        !/^(cf|rf|c[\-_]?\d|pso\b|\d+$)/i.test(seg)
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
// 9. PERMANENT CLOUD SESSION, CONFIG & MASTER JSON DB BACKUP (_Bot_State)
// ============================================================================
let stateBackupTimer = null;

async function backupAuthAndConfigToSheet() {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return;
  try {
    const authFiles = {};
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
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

    const masterDbJson = JSON.stringify(masterDb);
    const masterDbGzip = zlib.gzipSync(Buffer.from(masterDbJson, 'utf8')).toString('base64');

    const chunks = [];
    for (let i = 0; i < compressedBase64.length; i += 40000) {
      chunks.push(compressedBase64.slice(i, i + 40000));
    }

    const stateRows = [
      ['Key', 'Value', 'Updated At'],
      ['BOT_CONFIG', JSON.stringify(botConfig), new Date().toISOString()],
      ['MASTER_DB_GZIP', masterDbGzip, masterDb.updatedAt || new Date().toISOString()],
      ['WA_AUTH_GZIP', chunks[0] || '', `${chunks.length} chunk(s)`]
    ];
    for (let c = 1; c < chunks.length; c++) {
      stateRows.push([`WA_AUTH_GZIP_${c}`, chunks[c], '']);
    }

    await sheetsClient.spreadsheets.values.clear({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.BOT_STATE}!A1:Z45`
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
      range: `${SHEET_TABS.BOT_STATE}!A1:C45`
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
      } else if (key === 'MASTER_DB_GZIP' && val) {
        try {
          const unzippedDb = zlib.gunzipSync(Buffer.from(val, 'base64')).toString('utf8');
          const parsedDb = JSON.parse(unzippedDb);
          applyMasterDbObject(parsedDb, true);
          addLog(`☁️ Restored Dynamic Master DB from Cloud (${masterDb.das.length} DAs, ${masterDb.products.length} Products).`);
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
// 11. WHATSAPP BAILEYS ENGINE + INTERACTIVE SELF-LEARNING ADMIN BOT (01793362829)
// ============================================================================
let sock = null;
let waStatus = 'DISCONNECTED';
let currentQrDataUrl = null;
let connectedUser = null;
let joinedGroups = [];
const recentOrders = [];
const activityLogs = [];

// Pending interactive resolutions waiting for Admin (01793362829) reply
// token -> { token, type: 'UNKNOWN_DA' | 'UNKNOWN_PRODUCT', createdAt, ... }
const pendingResolutions = new Map();
// WhatsApp Message ID of bot's question -> token
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

/**
 * Sends a WhatsApp message to all configured Admin Alert Numbers (default: 01793362829)
 * and registers the sent message IDs so quoting/replying to the message resolves the pending item!
 */
async function sendAdminResolutionPrompt(token, promptText) {
  if (!sock || waStatus !== 'CONNECTED') {
    addLog(`⚠️ Cannot send WhatsApp prompt for ${token} (WhatsApp not connected). Available in Web UI.`);
    return;
  }
  const adminPhones = getAdminAlertPhones();
  for (const ph of adminPhones) {
    const normPh = normalizeBdPhone(ph);
    if (!normPh) continue;
    const targetJid = `${normPh}@s.whatsapp.net`;
    try {
      const sent = await sock.sendMessage(targetJid, { text: promptText });
      if (sent?.key?.id) {
        pendingQuestionMsgIdMap.set(sent.key.id, token);
      }
      addLog(`📲 Sent interactive resolution prompt [${token}] to Admin +${normPh}`);
    } catch (err) {
      addLog(`⚠️ Failed to send prompt [${token}] to +${normPh}: ${err.message}`);
    }
  }
}

/**
 * Enqueues an order with an unknown/missing DA ID or Name and asks Admin (01793362829)
 */
async function createPendingDaResolution({
  orders,
  detectedDaId = null,
  rawText = '',
  senderPhone = '',
  senderPushName = '',
  originRemoteJid = '',
  originMsgKey = null,
  isImageOrder = false
}) {
  if (!orders || orders.length === 0) return null;
  pendingCounter++;
  const token = `#DA${pendingCounter}`;
  const totalSummaryAmt = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const itemsPreview = orders.map((o) => `${o.productName} (${o.orderedQty})`).join(', ');

  const pendingItem = {
    token,
    type: 'UNKNOWN_DA',
    createdAt: new Date().toISOString(),
    orders,
    detectedDaId,
    rawText: rawText.slice(0, 300),
    senderPhone,
    senderPushName,
    originRemoteJid,
    originMsgKey,
    isImageOrder
  };
  pendingResolutions.set(token, pendingItem);

  let promptMsg = '';
  if (detectedDaId) {
    promptMsg =
      `❓ *নতুন/অপরিচিত DA ID শনাক্ত হয়েছে!* (${token})\n` +
      `🆔 শনাক্তকৃত ID: *${detectedDaId}* (ডেটাবেসে নাম পাওয়া যায়নি)\n` +
      `🏪 ফার্মেসি: *${orders[0]?.pharmacyName || 'General Party'}*\n` +
      `💊 অর্ডার (${orders.length}টি): *${itemsPreview}*\n` +
      `💰 মোট টাকা: *৳${totalSummaryAmt.toFixed(2)}*\n\n` +
      `👉 এই মেসেজের *Reply*-তে প্রতিনিধির *নাম* (অথবা \`${detectedDaId} নাম\`) লিখে পাঠান।\n` +
      `উত্তর দিলেই এটি ডেটাবেসে স্থায়ীভাবে সেভ হয়ে অর্ডারটি Google Sheet-এ যুক্ত হয়ে যাবে! (বাতিল করতে লিখুন \`/cnl\`)`;
  } else {
    promptMsg =
      `❓ *অর্ডারে কোনো পরিচিত DA ID বা নাম পাওয়া যায়নি!* (${token})\n` +
      `👤 প্রেরক: *${senderPushName || 'Unknown'}* (${senderPhone ? '+' + normalizeBdPhone(senderPhone) : 'N/A'})\n` +
      `🏪 ফার্মেসি: *${orders[0]?.pharmacyName || 'General Party'}*\n` +
      `💊 অর্ডার (${orders.length}টি): *${itemsPreview}*\n` +
      `💰 মোট টাকা: *৳${totalSummaryAmt.toFixed(2)}*\n` +
      `📝 মূল লেখা: _"${rawText.replace(/\n/g, ' | ').slice(0, 140)}"_\n\n` +
      `👉 এই অর্ডারটি কার নামে সেভ হবে? এই মেসেজের *Reply*-তে *ID এবং নাম* লিখে পাঠান (যেমন: \`CF4526 Seraj\` বা \`CF9988 Rahim\`)।\n` +
      `উত্তর দিলেই এটি ডেটাবেসে ও Google Sheet-এ অটোমেটিক সেভ হয়ে যাবে! (বাতিল করতে লিখুন \`/cnl\`)`;
  }

  await sendAdminResolutionPrompt(token, promptMsg);
  return pendingItem;
}

/**
 * Enqueues an unrecognized product line and asks Admin (01793362829) what product it is
 */
async function createPendingProductResolution({
  unknownItem,
  daInfo,
  messageId,
  dateStr,
  timeStr,
  displayPhone,
  originRemoteJid = ''
}) {
  if (!unknownItem) return null;
  pendingCounter++;
  const token = `#PR${pendingCounter}`;

  const pendingItem = {
    token,
    type: 'UNKNOWN_PRODUCT',
    createdAt: new Date().toISOString(),
    unknownProductText: unknownItem.unknownProductText,
    orderedQty: unknownItem.orderedQty,
    rawLine: unknownItem.rawLine,
    pharmacyName: unknownItem.pharmacyName || 'General Party',
    psoCode: unknownItem.psoCode || '-',
    daInfo: daInfo || { daId: 'UNKNOWN', altId: '-', name: 'Unknown DA' },
    messageId: `${messageId}_${token.replace('#', '')}`,
    whatsappMsgId: messageId,
    dateStr,
    timeStr,
    displayPhone,
    originRemoteJid
  };
  pendingResolutions.set(token, pendingItem);

  const promptMsg =
    `🤔 *অপরিচিত প্রোডাক্ট বা ভুল বানান পাওয়া গেছে!* (${token})\n` +
    `👤 প্রতিনিধি: *${pendingItem.daInfo.name}* (${pendingItem.daInfo.daId})\n` +
    `🏪 ফার্মেসি: *${pendingItem.pharmacyName}* (PSO: ${pendingItem.psoCode})\n` +
    `📝 মেসেজে লিখেছে: *"${unknownItem.rawLine}"*\n` +
    `❓ শনাক্তকৃত বানান: *"${unknownItem.unknownProductText}"* | পরিমাণ: *${unknownItem.orderedQty}*\n\n` +
    `👉 এটি কোন প্রোডাক্ট? এই মেসেজের *Reply*-তে সঠিক প্রোডাক্টের *নাম অথবা কোড* পাঠান (যেমন: \`Totifen\` বা \`919\` বা \`Domiren 100ml\`)।\n` +
    `💡 নতুন প্রোডাক্ট হলে লিখুন: \`NEW | কোড | নাম | দাম\`\n` +
    `❌ এটি অর্ডার না হলে লিখুন: \`skip\` বা \`/cnl\``;

  await sendAdminResolutionPrompt(token, promptMsg);
  return pendingItem;
}

/**
 * Resolves a pending #DA... or #PR... item from Admin reply (via WhatsApp or Web Dashboard)
 */
async function resolvePendingItemWithAnswer(token, rawAnswerText) {
  const item = pendingResolutions.get(token);
  if (!item) {
    return { ok: false, message: `⚠️ টোকেন ${token} খুঁজে পাওয়া যায়নি বা আগেই সমাধান হয়েছে।` };
  }

  const answer = String(rawAnswerText || '').trim();
  if (!answer) {
    return { ok: false, message: '⚠️ উত্তর খালি রাখা যাবে না।' };
  }

  // Check if Admin wants to cancel/skip this pending item
  if (/^(\/?cnl|cancel|skip|no|bad|না|বাদ)$/i.test(answer)) {
    pendingResolutions.delete(token);
    addLog(`🗑️ Pending item ${token} skipped/cancelled by Admin.`);
    return { ok: true, cancelled: true, message: `🗑️ *${token}* বাতিল করা হয়েছে (Google Sheet-এ যোগ করা হয়নি)।` };
  }

  // ==========================================================================
  // CASE A: RESOLVE UNKNOWN DA (#DA...)
  // ==========================================================================
  if (item.type === 'UNKNOWN_DA') {
    let resolvedDA = null;

    // 1. Check if Admin's reply contains an explicit ID (e.g. "CF4526", "CF9988 Rahim")
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
        // Brand new ID provided by Admin!
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
      // 2. Admin only typed a Name (e.g. "Seraj" or "Karim Uddin")
      const lowerAns = answer.toLowerCase();
      const existingByName = activeDAs.find(
        (d) =>
          d.name.toLowerCase() === lowerAns ||
          d.name.toLowerCase().includes(lowerAns) ||
          (d.aliases && d.aliases.some((a) => a.toLowerCase() === lowerAns))
      );

      if (existingByName && !item.detectedDaId) {
        resolvedDA = existingByName;
      } else {
        // Create new DA using detectedDaId (if present) or an auto-generated CF ID
        const finalId = item.detectedDaId || `CF${Math.floor(10000 + Math.random() * 89999)}`;
        resolvedDA = {
          daId: finalId,
          altId: '',
          name: answer,
          phones: [],
          aliases: [answer.toLowerCase(), finalId.toLowerCase()]
        };
        masterDb.das.push(resolvedDA);
        saveLocalMasterDb();
        scheduleCloudStateBackup(2000);
      }
    }

    // Update held orders with the resolved DA and save to Google Sheets!
    const updatedOrders = item.orders.map((o) => ({
      ...o,
      daId: resolvedDA.daId,
      altId: resolvedDA.altId || '-',
      daName: resolvedDA.name,
      senderPhone:
        resolvedDA.phones && resolvedDA.phones.length > 0
          ? `+${resolvedDA.phones[0]}`
          : o.senderPhone
    }));

    await appendOrdersToSheet(updatedOrders);
    pendingResolutions.delete(token);

    const totalAmt = updatedOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    addLog(`✅ Resolved ${token} -> DA: ${resolvedDA.name} (${resolvedDA.daId}). Saved ${updatedOrders.length} order(s) to Sheet.`);

    return {
      ok: true,
      message:
        `✅ *ধন্যবাদ! প্রতিনিধি [${resolvedDA.daId} — ${resolvedDA.name}] ডেটাবেসে সেভ হয়েছে!*\n` +
        `📦 মোট *${updatedOrders.length}টি অর্ডার লাইন (৳${totalAmt.toFixed(2)})* সফলভাবে Google Sheet-এ যুক্ত করা হয়েছে।`
    };
  }

  // ==========================================================================
  // CASE B: RESOLVE UNKNOWN PRODUCT / WRONG SPELLING (#PR...)
  // ==========================================================================
  if (item.type === 'UNKNOWN_PRODUCT') {
    let matchedProd = null;

    // 1. Check if Admin typed "NEW | CODE | NAME | PRICE"
    if (/^new\s*\|/i.test(answer)) {
      const parts = answer.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 4) {
        const newCode = parts[1].toUpperCase();
        const newName = parts[2].toUpperCase();
        const newPrice = parseFloat(parts[3]) || 0;
        const newUnit = parts[4] || "Box/Bottle";
        matchedProd = {
          code: newCode,
          name: newName,
          unit: newUnit,
          price: newPrice,
          family: newName.split(/\s+/)[0],
          aliases: [newName.toLowerCase(), item.unknownProductText.toLowerCase()]
        };
        masterDb.products.push(matchedProd);
        saveLocalMasterDb();
        scheduleCloudStateBackup(2000);
      }
    }

    // 2. Otherwise match Admin's reply against existing products by Code or Name/Alias
    if (!matchedProd) {
      const cleanAns = answer.trim();
      matchedProd =
        activeProducts.find((p) => String(p.code).toLowerCase() === cleanAns.toLowerCase()) ||
        matchCRPProduct(cleanAns)?.product ||
        activeProducts.find((p) => p.name.toLowerCase().includes(cleanAns.toLowerCase()));
    }

    if (!matchedProd) {
      return {
        ok: false,
        message:
          `⚠️ *"${answer}"* দিয়ে কোনো প্রোডাক্ট খুঁজে পাওয়া যায়নি।\n` +
          `সঠিক প্রোডাক্টের কোড (যেমন \`919\`) বা নাম (যেমন \`Totifen\`) লিখুন, অথবা নতুন প্রোডাক্ট যোগ করতে লিখুন:\n` +
          `\`NEW | কোড | নাম | দাম\``
      };
    }

    // Add the unrecognized spelling to matchedProd.aliases in masterDb.products!
    const learnedAlias = item.unknownProductText.toLowerCase().trim();
    if (!matchedProd.aliases) matchedProd.aliases = [];
    if (learnedAlias && !matchedProd.aliases.includes(learnedAlias)) {
      matchedProd.aliases.push(learnedAlias);
    }
    saveLocalMasterDb();
    scheduleCloudStateBackup(2000);

    // Construct and save the order line to Google Sheets!
    const totalAmount = Number((item.orderedQty * matchedProd.price).toFixed(2));
    const newOrderRow = {
      orderLineId: item.messageId,
      whatsappMsgId: item.whatsappMsgId,
      date: item.dateStr,
      time: item.timeStr,
      daId: item.daInfo.daId,
      altId: item.daInfo.altId || '-',
      daName: item.daInfo.name,
      senderPhone: item.displayPhone || '-',
      psoCode: item.psoCode || '-',
      pharmacyName: item.pharmacyName || 'General Party',
      rawText: item.rawLine,
      crpCode: matchedProd.code,
      productName: matchedProd.name,
      packUnit: matchedProd.unit,
      orderedQty: item.orderedQty,
      unitPrice: matchedProd.price,
      totalAmount,
      matchType: 'AI-Learned',
      status: 'ACTIVE'
    };

    await appendOrdersToSheet([newOrderRow]);
    pendingResolutions.delete(token);

    addLog(
      `🧠 Self-Learned Alias: "${learnedAlias}" -> [${matchedProd.code}] ${matchedProd.name} & saved order (${item.orderedQty} pcs = ৳${totalAmount})!`
    );

    return {
      ok: true,
      message:
        `✅ *ডেটাবেস আপডেট ও অর্ডার সেভ হয়েছে!*\n` +
        `🧠 ভুল বানান *"${item.unknownProductText}"* এখন *[${matchedProd.code}] ${matchedProd.name}*-এর সাথে যুক্ত করা হয়েছে (ভবিষ্যতে কেউ এই বানান লিখলে বট অটো চিনে নেবে!)।\n` +
        `📦 অর্ডার: *${item.orderedQty} × ৳${matchedProd.price.toFixed(2)} = ৳${totalAmount.toFixed(2)}* Google Sheet-এ সেভ হয়েছে।`
    };
  }

  return { ok: false, message: '⚠️ Unknown resolution type.' };
}

function isAllowedTargetGroup(remoteJid) {
  if (!remoteJid || !remoteJid.endsWith('@g.us')) return false;
  const cfgId = (botConfig.targetGroupId || '').trim();
  const cfgName = (botConfig.targetGroupName || '').trim().toLowerCase();

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

          const textOrCaption = (inspected.text || inspected.caption || '').trim();

          // Ignore the bot's own outgoing prompts/confirmations so it never loops
          if (
            textOrCaption.includes('নতুন/অপরিচিত DA ID শনাক্ত হয়েছে!') ||
            textOrCaption.includes('অর্ডারে কোনো পরিচিত DA ID বা নাম পাওয়া যায়নি!') ||
            textOrCaption.includes('অপরিচিত প্রোডাক্ট বা ভুল বানান পাওয়া গেছে!') ||
            textOrCaption.includes('ডেটাবেস আপডেট ও অর্ডার সেভ হয়েছে!') ||
            textOrCaption.includes('ছবি থেকে অর্ডারটি Google Sheet-এ সেভ হয়েছে!') ||
            textOrCaption.includes('অর্ডারটি বাতিল (/cnl) করা হয়েছে!') ||
            textOrCaption.includes('ছবিটি ৩ বার অটো-রিচেক') ||
            textOrCaption.includes('ডেটাবেসে সেভ হয়েছে!')
          ) {
            continue;
          }

          // 0. Check "/bind" command across ALL groups and DMs
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

          // 1. CHECK IF THIS MESSAGE IS AN ADMIN REPLY TO A PENDING #DA... OR #PR... PROMPT!
          if (inspected.type === 'TEXT' && pendingResolutions.size > 0) {
            let matchedToken = null;
            let answerBody = inspected.text.trim();

            // Check if quoted message ID matches one of the bot's question messages
            if (inspected.quotedMsgId && pendingQuestionMsgIdMap.has(inspected.quotedMsgId)) {
              matchedToken = pendingQuestionMsgIdMap.get(inspected.quotedMsgId);
            }

            // Or check if text starts with explicit token like "#DA101 CF4526 Seraj" or "#PR102 Totifen"
            if (!matchedToken) {
              const tokenPrefix = answerBody.match(/^(#(?:DA|PR)\d+)\s+([\s\S]+)$/i);
              if (tokenPrefix && pendingResolutions.has(tokenPrefix[1].toUpperCase())) {
                matchedToken = tokenPrefix[1].toUpperCase();
                answerBody = tokenPrefix[2].trim();
              }
            }

            // Or if this is a direct DM from an Admin (01793362829) and there is a pending question, apply to the latest pending item!
            if (!matchedToken && !isGroup && isAdminAlertSender(msg, senderPhone)) {
              const allTokens = Array.from(pendingResolutions.keys());
              if (allTokens.length > 0 && !/^\/?cnl\b/i.test(answerBody)) {
                matchedToken = allTokens[allTokens.length - 1];
              }
            }

            if (matchedToken && isAdminAlertSender(msg, senderPhone)) {
              const resOut = await resolvePendingItemWithAnswer(matchedToken, answerBody);
              if (sock && resOut?.message) {
                try {
                  await sock.sendMessage(remoteJid, { text: resOut.message }, { quoted: msg });
                } catch (e) {}
              }
              continue;
            }
          }

          // 2. For group messages, check if group is allowed (unless it's an authorized image sender!)
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
              senderJid,
              isImageOrder: false
            });
            if (parsedEdit.isOrder && parsedEdit.orders.length > 0) {
              if (parsedEdit.daInfo && !parsedEdit.daInfo.isKnownDA) {
                await createPendingDaResolution({
                  orders: parsedEdit.orders,
                  detectedDaId: parsedEdit.daInfo.detectedDaId,
                  rawText: inspected.text,
                  senderPhone,
                  senderPushName,
                  originRemoteJid: remoteJid,
                  originMsgKey: msg.key,
                  isImageOrder: false
                });
              } else {
                await appendOrdersToSheet(parsedEdit.orders);
              }
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
            imageBuffer = null;

            const parsedImg = ocrPipelineResult.parsed;

            if (ocrPipelineResult.ok && parsedImg && (parsedImg.orders?.length > 0 || parsedImg.unrecognizedItems?.length > 0)) {
              const orders = parsedImg.orders || [];
              const daInfo = parsedImg.daInfo;

              // Notify Admin if a new DA was auto-added from ID + Name on the paper
              if (daInfo?.autoAddedNewDA) {
                await sendAdminResolutionPrompt(
                  `#AUTO_DA`,
                  `🆕 *নতুন প্রতিনিধি অটো-যুক্ত হয়েছে!*\n🆔 ID: *${daInfo.daId}*\n👤 নাম: *${daInfo.name}*\nএটি ডেটাবেসে স্থায়ীভাবে সেভ করে নেওয়া হয়েছে।`
                );
              }

              // Check if DA ID/Name was NOT found on the image (preventing false CF10145 save!)
              if (orders.length > 0 && daInfo && !daInfo.isKnownDA) {
                const pendingDa = await createPendingDaResolution({
                  orders,
                  detectedDaId: daInfo.detectedDaId,
                  rawText: ocrPipelineResult.extractedText || inspected.caption,
                  senderPhone,
                  senderPushName,
                  originRemoteJid: remoteJid,
                  originMsgKey: msg.key,
                  isImageOrder: true
                });

                if (sock && pendingDa) {
                  try {
                    await sock.sendMessage(
                      remoteJid,
                      {
                        text:
                          `⏳ *ছবি থেকে ${orders.length}টি অর্ডার শনাক্ত হয়েছে, কিন্তু প্রতিনিধির (DA) ID/নাম চেনা যায়নি! (${pendingDa.token})*\n` +
                          `অ্যাডমিন নম্বরে মেসেজ পাঠানো হয়েছে—ID ও নাম কনফার্ম করলেই অর্ডারটি Google Sheet-এ সেভ হয়ে যাবে।`
                      },
                      { quoted: msg }
                    );
                  } catch (e) {}
                }
              } else if (orders.length > 0) {
                // Known DA -> Save immediately to Google Sheets!
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
              }

              // If any unrecognized product lines were also found on the image, ask Admin 01793362829!
              for (const unk of parsedImg.unrecognizedItems || []) {
                await createPendingProductResolution({
                  unknownItem: unk,
                  daInfo: daInfo?.isKnownDA ? daInfo : { daId: daInfo?.detectedDaId || 'PENDING', name: 'Pending DA' },
                  messageId: inspected.msgId,
                  dateStr: parsedImg.dateStr,
                  timeStr: parsedImg.timeStr,
                  displayPhone: parsedImg.displayPhone,
                  originRemoteJid: remoteJid
                });
              }
            } else {
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

            if (parsed.daInfo?.autoAddedNewDA) {
              await sendAdminResolutionPrompt(
                `#AUTO_DA`,
                `🆕 *গ্রুপ মেসেজ থেকে নতুন প্রতিনিধি অটো-যুক্ত হয়েছে!*\n🆔 ID: *${parsed.daInfo.daId}*\n👤 নাম: *${parsed.daInfo.name}*`
              );
            }

            if (parsed.isOrder && parsed.orders.length > 0) {
              if (parsed.daInfo && !parsed.daInfo.isKnownDA) {
                // Unknown DA in group message -> Ask Admin 01793362829!
                await createPendingDaResolution({
                  orders: parsed.orders,
                  detectedDaId: parsed.daInfo.detectedDaId,
                  rawText: inspected.text,
                  senderPhone,
                  senderPushName,
                  originRemoteJid: remoteJid,
                  originMsgKey: msg.key,
                  isImageOrder: false
                });
              } else {
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
              }
            } else if (parsed.followUpPatch) {
              await applyFollowUpPatchToSheet(parsed.followUpPatch);
            }

            // If any unrecognized product lines were present in the group message, ask Admin 01793362829!
            if (parsed.unrecognizedItems && parsed.unrecognizedItems.length > 0) {
              for (const unk of parsed.unrecognizedItems) {
                await createPendingProductResolution({
                  unknownItem: unk,
                  daInfo: parsed.daInfo,
                  messageId: inspected.msgId,
                  dateStr: parsed.dateStr,
                  timeStr: parsed.timeStr,
                  displayPhone: parsed.displayPhone,
                  originRemoteJid: remoteJid
                });
              }
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
    version: '5.0-self-learning-db',
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
    pendingResolutions: Array.from(pendingResolutions.values())
  });
});

// Get full Master DB (DAs, Products, Admin Phones, Image Phones, Pending Questions)
app.get('/api/master-db', (req, res) => {
  res.json({
    ok: true,
    das: masterDb.das,
    products: masterDb.products,
    adminAlertPhones: getAdminAlertPhones(),
    authorizedImagePhones: getAuthorizedImagePhones(),
    pendingResolutions: Array.from(pendingResolutions.values()),
    updatedAt: masterDb.updatedAt
  });
});

// Export Master DB as downloadable JSON file
app.get('/api/master-db/export', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="crp_master_db_backup.json"');
  res.send(JSON.stringify(masterDb, null, 2));
});

// Import Master DB from JSON
app.post('/api/master-db/import', async (req, res) => {
  const payload = req.body;
  if (!payload || (!Array.isArray(payload.das) && !Array.isArray(payload.products))) {
    return res.status(400).json({ ok: false, error: 'Invalid Master DB JSON format.' });
  }
  applyMasterDbObject(payload, true);
  scheduleCloudStateBackup(1500);
  addLog(`📥 Imported Master DB JSON (${masterDb.das.length} DAs, ${masterDb.products.length} Products).`);
  res.json({ ok: true, daCount: masterDb.das.length, productCount: masterDb.products.length });
});

// ============================================================================
// DA DATABASE CRUD ENDPOINTS (ADD / EDIT / DELETE SINGLE / CLEAR ALL / RESET)
// ============================================================================
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

// ============================================================================
// PRODUCT & WRONG SPELLING (ALIASES) CRUD ENDPOINTS
// ============================================================================
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
        .filter(Boolean)
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

  if (existingIdx >= 0) {
    masterDb.products[existingIdx] = prodRecord;
    addLog(`✏️ Updated Product [${cleanCode}] ${cleanName} (TP: ৳${prodRecord.price}, Aliases: ${cleanAliases.length})`);
  } else {
    masterDb.products.unshift(prodRecord);
    addLog(`➕ Added New Product [${cleanCode}] ${cleanName} (TP: ৳${prodRecord.price})`);
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
  } else if (cleanAlias) {
    if (!prod.aliases.includes(cleanAlias)) {
      prod.aliases.push(cleanAlias);
      addLog(`🧠 Added wrong-spelling alias "${cleanAlias}" -> [${cleanCode}] ${prod.name}`);
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

// ============================================================================
// MULTIPLE PHONE NUMBERS (ADMIN ALERT & IMAGE AUTHORIZED) CRUD ENDPOINT
// ============================================================================
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

// ============================================================================
// PENDING RESOLUTION ACTION ENDPOINT (RESOLVE OR CANCEL FROM WEB DASHBOARD)
// ============================================================================
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

  saveLocalConfig();
  await backupAuthAndConfigToSheet();
  addLog(`🔒 Group Config Saved: "${botConfig.targetGroupName}" [ID: ${botConfig.targetGroupId || 'ALL'}]`);
  res.json({ ok: true, botConfig });
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

// Serve Neo-Brutalism v5.0 Master Command Center UI at "/"
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send("<!DOCTYPE html>\n<html lang=\"bn\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>Renata CRP Order Tracker v5.0 \u2014 Dynamic Master DB & Self-Learning AI</title>\n  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n  <link href=\"https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@500;600;700&family=Space+Grotesk:wght@600;700;800&display=swap\" rel=\"stylesheet\">\n  <style>\n    :root {\n      --bg: #FFFDF7;\n      --ink: #000000;\n      --yellow: #FFE600;\n      --mint: #6EE7B7;\n      --sky: #7DD3FC;\n      --pink: #FF90E8;\n      --coral: #FDA4AF;\n      --lavender: #C4B5FD;\n      --orange: #FDBA74;\n      --white: #FFFFFF;\n      --border: 3px solid #000000;\n      --shadow: 6px 6px 0px #000000;\n      --shadow-sm: 4px 4px 0px #000000;\n    }\n    * { box-sizing: border-box; margin: 0; padding: 0; }\n    body {\n      font-family: 'Space Grotesk', 'Hind Siliguri', sans-serif;\n      background-color: var(--bg);\n      background-image: radial-gradient(#000000 1.1px, transparent 1.1px);\n      background-size: 22px 22px;\n      color: var(--ink);\n      line-height: 1.5;\n      padding: 16px;\n    }\n    .container { max-width: 1320px; margin: 0 auto; }\n\n    header {\n      display: flex;\n      flex-wrap: wrap;\n      justify-content: space-between;\n      align-items: center;\n      gap: 14px;\n      background: var(--yellow);\n      border: 3.5px solid var(--ink);\n      box-shadow: 7px 7px 0px var(--ink);\n      padding: 18px 22px;\n      border-radius: 12px;\n      margin-bottom: 18px;\n    }\n    header h1 { font-size: 1.4rem; font-weight: 800; text-transform: uppercase; }\n    header p { font-size: 0.9rem; font-weight: 700; opacity: 0.85; margin-top: 2px; }\n\n    .badge {\n      display: inline-flex;\n      align-items: center;\n      gap: 5px;\n      padding: 6px 12px;\n      border-radius: 8px;\n      font-size: 0.8rem;\n      font-weight: 800;\n      border: 2.5px solid var(--ink);\n      box-shadow: 3px 3px 0px var(--ink);\n      background: var(--white);\n    }\n    .badge.ok { background: var(--mint); }\n    .badge.warn { background: var(--orange); }\n    .badge.err { background: var(--coral); }\n    .badge.info { background: var(--lavender); }\n\n    /* Navigation Tabs */\n    .nav-tabs {\n      display: flex;\n      flex-wrap: wrap;\n      gap: 10px;\n      margin-bottom: 20px;\n    }\n    .tab-btn {\n      cursor: pointer;\n      border: 3px solid var(--ink);\n      box-shadow: 4px 4px 0px var(--ink);\n      padding: 10px 18px;\n      border-radius: 10px;\n      font-weight: 800;\n      font-size: 0.92rem;\n      background: var(--white);\n      color: var(--ink);\n      transition: all 0.1s ease;\n    }\n    .tab-btn.active {\n      background: var(--ink) !important;\n      color: var(--yellow) !important;\n      transform: translate(2px, 2px);\n      box-shadow: 2px 2px 0px var(--ink);\n    }\n\n    .tab-panel { display: none; }\n    .tab-panel.active { display: block; }\n\n    .stats-row {\n      display: grid;\n      grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));\n      gap: 14px;\n      margin-bottom: 20px;\n    }\n    .stat-card {\n      border: var(--border);\n      box-shadow: var(--shadow-sm);\n      padding: 14px 16px;\n      border-radius: 10px;\n    }\n    .stat-card.c1 { background: #A7F3D0; }\n    .stat-card.c2 { background: #BAE6FD; }\n    .stat-card.c3 { background: #FEF08A; }\n    .stat-card.c4 { background: #FECDD3; }\n    .stat-card.c5 { background: #DDD6FE; }\n    .stat-card .lbl { font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }\n    .stat-card .val { font-size: 1.35rem; font-weight: 800; margin-top: 4px; }\n\n    .grid {\n      display: grid;\n      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));\n      gap: 20px;\n      margin-bottom: 22px;\n    }\n    .card {\n      background: var(--white);\n      border: var(--border);\n      box-shadow: var(--shadow);\n      border-radius: 12px;\n      overflow: hidden;\n      margin-bottom: 20px;\n    }\n    .card-header {\n      padding: 13px 18px;\n      border-bottom: var(--border);\n      display: flex;\n      align-items: center;\n      justify-content: space-between;\n      gap: 10px;\n      flex-wrap: wrap;\n      font-weight: 800;\n      font-size: 1rem;\n    }\n    .card-header.h-pink { background: var(--pink); }\n    .card-header.h-mint { background: var(--mint); }\n    .card-header.h-sky { background: var(--sky); }\n    .card-header.h-yellow { background: var(--yellow); }\n    .card-header.h-lavender { background: var(--lavender); }\n    .card-header.h-orange { background: var(--orange); }\n    .card-body { padding: 18px; }\n\n    .qr-box {\n      display: flex;\n      flex-direction: column;\n      align-items: center;\n      justify-content: center;\n      padding: 16px;\n      background: #FFFDF7;\n      border: 2.5px dashed var(--ink);\n      border-radius: 10px;\n      min-height: 220px;\n      text-align: center;\n    }\n    .qr-box img {\n      max-width: 210px;\n      border-radius: 8px;\n      border: 3px solid var(--ink);\n      box-shadow: var(--shadow-sm);\n      margin-bottom: 10px;\n      background: #fff;\n    }\n\n    label { display: block; font-size: 0.84rem; font-weight: 700; margin-bottom: 5px; margin-top: 10px; }\n    select, input[type=\"text\"], input[type=\"number\"], input[type=\"password\"], textarea {\n      width: 100%;\n      background: #FFFDF7;\n      border: 2.5px solid var(--ink);\n      box-shadow: 3px 3px 0px var(--ink);\n      color: var(--ink);\n      padding: 9px 12px;\n      border-radius: 8px;\n      font-size: 0.9rem;\n      font-weight: 600;\n      font-family: inherit;\n      outline: none;\n    }\n    select:focus, input:focus, textarea:focus { background: #FEF9C3; }\n    textarea { min-height: 100px; font-family: monospace; resize: vertical; }\n\n    .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }\n    button, .btn-link {\n      cursor: pointer;\n      border: 2.5px solid var(--ink);\n      box-shadow: 4px 4px 0px var(--ink);\n      padding: 9px 14px;\n      border-radius: 8px;\n      font-weight: 800;\n      font-size: 0.84rem;\n      font-family: inherit;\n      display: inline-flex;\n      align-items: center;\n      gap: 6px;\n      text-decoration: none;\n      color: var(--ink);\n      background: var(--white);\n      transition: transform 0.08s ease, box-shadow 0.08s ease;\n    }\n    button:hover, .btn-link:hover { transform: translate(1.5px, 1.5px); box-shadow: 2.5px 2.5px 0px var(--ink); }\n    button:active, .btn-link:active { transform: translate(3.5px, 3.5px); box-shadow: 0px 0px 0px var(--ink); }\n    .btn-primary { background: var(--mint); }\n    .btn-blue { background: var(--sky); }\n    .btn-yellow { background: var(--yellow); }\n    .btn-pink { background: var(--pink); }\n    .btn-danger { background: var(--coral); }\n    .btn-sm { padding: 5px 10px; font-size: 0.76rem; box-shadow: 2.5px 2.5px 0px var(--ink); }\n\n    .table-wrap {\n      overflow-x: auto;\n      max-height: 460px;\n      overflow-y: auto;\n      border: 2.5px solid var(--ink);\n      border-radius: 8px;\n    }\n    table { width: 100%; border-collapse: collapse; font-size: 0.84rem; background: var(--white); }\n    th, td {\n      padding: 9px 11px;\n      border-bottom: 2px solid var(--ink);\n      border-right: 1.5px solid var(--ink);\n      text-align: left;\n    }\n    th {\n      background: var(--ink);\n      color: var(--yellow);\n      font-weight: 800;\n      text-transform: uppercase;\n      position: sticky;\n      top: 0;\n      z-index: 2;\n    }\n    tr:nth-child(even) td { background: #FFFDF5; }\n    tr:hover td { background: #FEF08A; }\n\n    .alias-chip {\n      display: inline-flex;\n      align-items: center;\n      gap: 4px;\n      background: #FEF9C3;\n      border: 1.5px solid #000;\n      padding: 2px 7px;\n      border-radius: 6px;\n      font-size: 0.75rem;\n      font-weight: 700;\n      margin: 2px;\n    }\n\n    .log-box {\n      background: #111827;\n      border: 3px solid var(--ink);\n      border-radius: 8px;\n      padding: 12px;\n      height: 210px;\n      overflow-y: auto;\n      font-family: monospace;\n      font-size: 0.8rem;\n      color: #A7F3D0;\n    }\n    .log-box div { padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,0.12); }\n\n    @media (max-width: 640px) {\n      body { padding: 10px; }\n      .grid { grid-template-columns: 1fr; }\n    }\n  </style>\n</head>\n<body>\n  <div class=\"container\">\n    <header>\n      <div>\n        <h1>\u26a1 Renata PLC (NK Depot) \u2014 CRP Order Bot v5.0</h1>\n        <p>Dynamic JSON Master DB \u2022 Self-Learning WhatsApp Admin Bot (01793362829) \u2022 3x AI OCR</p>\n      </div>\n      <div style=\"display:flex; gap:8px; flex-wrap:wrap; align-items:center;\">\n        <span id=\"waBadge\" class=\"badge warn\">\u23f3 WhatsApp...</span>\n        <span id=\"sheetBadge\" class=\"badge warn\">\u23f3 Sheet...</span>\n        <span id=\"ramBadge\" class=\"badge info\">\u26a1 RAM: -- MB</span>\n        <a id=\"openSheetBtn\" href=\"#\" target=\"_blank\" class=\"btn-link btn-blue\">\ud83d\udcca Google Sheet \u2197</a>\n      </div>\n    </header>\n\n    <!-- NAVIGATION TABS -->\n    <div class=\"nav-tabs\">\n      <button class=\"tab-btn active\" onclick=\"switchTab('tab-control', this)\">\ud83d\udce1 \u09e7. \u09ac\u099f \u0995\u09a8\u09cd\u099f\u09cd\u09b0\u09cb\u09b2 \u0993 \u09b2\u09be\u0987\u09ad \u0985\u09b0\u09cd\u09a1\u09be\u09b0</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-da', this)\">\ud83d\udc65 \u09e8. \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf \u09a1\u09c7\u099f\u09be\u09ac\u09c7\u09b8 (<span id=\"navDaCount\">0</span>)</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-products', this)\">\ud83d\udc8a \u09e9. \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u0993 \u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 (<span id=\"navProdCount\">0</span>)</button>\n      <button class=\"tab-btn\" onclick=\"switchTab('tab-phones', this)\">\ud83d\udcf1 \u09ea. \u0985\u09cd\u09af\u09be\u09a1\u09ae\u09bf\u09a8 \u0993 \u0987\u09ae\u09c7\u099c \u09a8\u09ae\u09cd\u09ac\u09b0 \u09b8\u09c7\u099f\u09bf\u0982\u09b8</button>\n    </div>\n\n    <!-- =================================================================== -->\n    <!-- TAB 1: BOT CONTROL, PENDING RESOLUTIONS, LIVE ORDERS & LOGS         -->\n    <!-- =================================================================== -->\n    <div id=\"tab-control\" class=\"tab-panel active\">\n      <div class=\"stats-row\">\n        <div class=\"stat-card c1\">\n          <div class=\"lbl\">\ud83c\udfaf \u09b8\u0995\u09cd\u09b0\u09bf\u09df \u0997\u09cd\u09b0\u09c1\u09aa</div>\n          <div class=\"val\" id=\"statGroup\" style=\"font-size:1rem;\">Loading...</div>\n        </div>\n        <div class=\"stat-card c2\">\n          <div class=\"lbl\">\ud83d\udce6 \u09ae\u09cb\u099f \u09b8\u09c7\u09ad \u0985\u09b0\u09cd\u09a1\u09be\u09b0</div>\n          <div class=\"val\" id=\"statSaved\">0</div>\n        </div>\n        <div class=\"stat-card c3\">\n          <div class=\"lbl\">\ud83d\udcb0 \u09ae\u09cb\u099f \u0985\u09b0\u09cd\u09a1\u09be\u09b0 (\u09f3)</div>\n          <div class=\"val\" id=\"statAmount\">\u09f30.00</div>\n        </div>\n        <div class=\"stat-card c4\">\n          <div class=\"lbl\">\u2753 \u09aa\u09c7\u09a8\u09cd\u09a1\u09bf\u0982 \u09aa\u09cd\u09b0\u09b6\u09cd\u09a8 (Admin)</div>\n          <div class=\"val\" id=\"statPending\">0</div>\n        </div>\n        <div class=\"stat-card c5\">\n          <div class=\"lbl\">\ud83d\udcf2 \u0985\u09cd\u09af\u09be\u09a1\u09ae\u09bf\u09a8 \u0985\u09cd\u09af\u09be\u09b2\u09be\u09b0\u09cd\u099f \u09a8\u09ae\u09cd\u09ac\u09b0</div>\n          <div class=\"val\" id=\"statAdminPhones\" style=\"font-size:0.86rem; line-height:1.35;\">+8801793362829</div>\n        </div>\n      </div>\n\n      <!-- PENDING AI QUESTIONS CARD (When unknown DA or unknown Product is waiting for reply) -->\n      <div id=\"pendingCard\" class=\"card\" style=\"display:none;\">\n        <div class=\"card-header h-orange\">\n          <span>\u2753 \u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf (DA) \u0993 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09aa\u09cd\u09b0\u09b6\u09cd\u09a8\u09b8\u09ae\u09c2\u09b9 (WhatsApp 01793362829 \u0985\u09a5\u09ac\u09be \u098f\u0996\u09be\u09a8 \u09a5\u09c7\u0995\u09c7 \u0989\u09a4\u09cd\u09a4\u09b0 \u09a6\u09bf\u09a8)</span>\n        </div>\n        <div class=\"card-body\">\n          <div id=\"pendingListContainer\"></div>\n        </div>\n      </div>\n\n      <div class=\"grid\">\n        <!-- WHATSAPP QR -->\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-pink\">\n            <span>\u09e7. WhatsApp \u0995\u09be\u09a8\u09c7\u0995\u09b6\u09a8</span>\n            <button class=\"btn-danger btn-sm\" onclick=\"logoutWhatsApp()\">Change Account</button>\n          </div>\n          <div class=\"card-body\">\n            <div id=\"qrContainer\" class=\"qr-box\">\n              <p style=\"font-weight:700;\">Loading WhatsApp status...</p>\n            </div>\n          </div>\n        </div>\n\n        <!-- GROUP SELECTOR -->\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-mint\">\n            <span>\u09e8. WhatsApp \u0997\u09cd\u09b0\u09c1\u09aa \u09b8\u09c7\u099f\u09bf\u0982\u09b8</span>\n            <button class=\"btn-yellow btn-sm\" onclick=\"refreshGroups()\">\ud83d\udd04 \u0997\u09cd\u09b0\u09c1\u09aa \u09b0\u09bf\u09ab\u09cd\u09b0\u09c7\u09b6</button>\n          </div>\n          <div class=\"card-body\">\n            <label>\u0986\u09aa\u09a8\u09be\u09b0 WhatsApp \u0997\u09cd\u09b0\u09c1\u09aa \u09b8\u09bf\u09b2\u09c7\u0995\u09cd\u099f \u0995\u09b0\u09c1\u09a8:</label>\n            <select id=\"groupSelect\" onchange=\"onGroupDropdownChange()\">\n              <option value=\"ALL\">\ud83c\udf10 All Joined Groups (\u09b8\u09ac \u0997\u09cd\u09b0\u09c1\u09aa \u09a5\u09c7\u0995\u09c7 \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09a8\u09bf\u09ac\u09c7)</option>\n            </select>\n            <label>\u0985\u09a5\u09ac\u09be \u09a8\u09bf\u09b0\u09cd\u09a6\u09bf\u09b7\u09cd\u099f \u0997\u09cd\u09b0\u09c1\u09aa\u09c7\u09b0 \u09a8\u09be\u09ae:</label>\n            <input type=\"text\" id=\"targetGroupNameInput\" placeholder=\"e.g. CRP sales NK Depot\" oninput=\"onGroupNameManualInput()\" />\n            <input type=\"hidden\" id=\"targetGroupIdInput\" />\n\n            <label style=\"display:flex; align-items:center; gap:8px; margin-top:12px; cursor:pointer;\">\n              <input type=\"checkbox\" id=\"autoReactCheckbox\" style=\"width:18px; height:18px; accent-color:#000;\" checked />\n              \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09b8\u09c7\u09ad \u09b9\u09b2\u09c7 \u09ae\u09c7\u09b8\u09c7\u099c\u09c7 \u0985\u099f\u09cb\u09ae\u09c7\u099f\u09bf\u0995 \u2705 \u09b0\u09bf\u09df\u09c7\u0995\u09b6\u09a8 \u09a6\u09bf\u09ac\u09c7\n            </label>\n\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"saveGroupConfig()\">\ud83d\udcbe Save Group Settings</button>\n              <button class=\"btn-blue\" onclick=\"syncSheetStructure()\">\ud83d\udcb2 Sync DB to Sheet</button>\n            </div>\n            <p id=\"saveStatusMsg\" style=\"font-size:0.84rem; font-weight:800; color:#047857; margin-top:8px;\"></p>\n          </div>\n        </div>\n\n        <!-- TEST PARSER -->\n        <div class=\"card\" style=\"margin-bottom:0;\">\n          <div class=\"card-header h-sky\">\n            <span>\ud83e\uddea \u09e9. \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u0993 \u09b8\u09c7\u09b2\u09ab-\u09b2\u09be\u09b0\u09cd\u09a8\u09bf\u0982 \u099f\u09c7\u09b8\u09cd\u099f\u09be\u09b0</span>\n          </div>\n          <div class=\"card-body\">\n            <label>\u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09ae\u09c7\u09b8\u09c7\u099c \u09b2\u09bf\u0996\u09c7 \u099f\u09c7\u09b8\u09cd\u099f \u0995\u09b0\u09c1\u09a8 (\u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 \u09a8\u09be\u09ae/\u0993\u09b7\u09c1\u09a7 \u09a6\u09bf\u09b2\u09c7 01793362829-\u098f \u09aa\u09cd\u09b0\u09b6\u09cd\u09a8 \u09aa\u09be\u09a0\u09be\u09ac\u09c7):</label>\n            <textarea id=\"testInput\">CF4526 Seraj\nCus: Nipun pharmacy E71\nTotifen 50\nDoxicup 10 pes</textarea>\n            <div class=\"btn-row\">\n              <button class=\"btn-yellow\" onclick=\"runTestParse(false)\">\ud83d\udd0d Test Parser</button>\n              <button class=\"btn-primary\" onclick=\"runTestParse(true)\">\ud83d\ude80 Test & Save / Ask Admin</button>\n            </div>\n            <div id=\"testResultBox\" style=\"margin-top:10px; font-size:0.82rem; font-weight:600;\"></div>\n          </div>\n        </div>\n      </div>\n\n      <!-- LIVE ORDERS -->\n      <div class=\"card\">\n        <div class=\"card-header h-yellow\">\n          <span>\ud83d\udccb \u09b8\u09b0\u09cd\u09ac\u09b6\u09c7\u09b7 \u099f\u09cd\u09b0\u09cd\u09af\u09be\u0995 \u09b9\u0993\u09df\u09be \u0985\u09b0\u09cd\u09a1\u09be\u09b0\u09b8\u09ae\u09c2\u09b9 (Live Parsed Orders)</span>\n          <button class=\"btn-danger btn-sm\" onclick=\"clearLiveOrders()\">\ud83e\uddf9 Clear Orders List</button>\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\">\n            <table>\n              <thead>\n                <tr>\n                  <th>Date & Time</th>\n                  <th>DA ID & Name</th>\n                  <th>PSO</th>\n                  <th>Pharmacy</th>\n                  <th>Raw Text</th>\n                  <th>Product</th>\n                  <th>Qty</th>\n                  <th>TP</th>\n                  <th>Total</th>\n                  <th>Match</th>\n                </tr>\n              </thead>\n              <tbody id=\"ordersTableBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n\n      <!-- SERVER LOGS -->\n      <div class=\"card\">\n        <div class=\"card-header h-lavender\">\n          <span>\ud83d\udda5\ufe0f \u09b8\u09bf\u09b8\u09cd\u099f\u09c7\u09ae \u09b2\u0997 (Live Server Logs)</span>\n          <button class=\"btn-danger btn-sm\" onclick=\"clearServerLogs()\">\ud83e\uddf9 Clear Server Logs</button>\n        </div>\n        <div class=\"card-body\">\n          <div id=\"logBox\" class=\"log-box\"></div>\n        </div>\n      </div>\n    </div>\n\n    <!-- =================================================================== -->\n    <!-- TAB 2: DA DATABASE MANAGER (ADD / EDIT / DELETE / CLEAR ALL)        -->\n    <!-- =================================================================== -->\n    <div id=\"tab-da\" class=\"tab-panel\">\n      <div class=\"card\">\n        <div class=\"card-header h-mint\">\n          <span>\u2795 \u09a8\u09a4\u09c1\u09a8 \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf (DA) \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8 \u0985\u09a5\u09ac\u09be \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09c1\u09a8</span>\n          <div style=\"display:flex; gap:8px;\">\n            <button class=\"btn-yellow btn-sm\" onclick=\"resetDaForm()\">\ud83d\udd04 Clear Form</button>\n            <button class=\"btn-blue btn-sm\" onclick=\"resetAllDasToDefault()\">\u267b\ufe0f \u09a1\u09bf\u09ab\u09b2\u09cd\u099f \u09ea\u09ec \u099c\u09a8 \u09b0\u09bf\u09b8\u09cd\u099f\u09cb\u09b0 \u0995\u09b0\u09c1\u09a8</button>\n            <button class=\"btn-danger btn-sm\" onclick=\"deleteAllDas()\">\ud83d\uddd1\ufe0f \u09b8\u09ac DA \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09c1\u09a8 (Remove All)</button>\n          </div>\n        </div>\n        <div class=\"card-body\">\n          <input type=\"hidden\" id=\"daOriginalId\" />\n          <div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px;\">\n            <div>\n              <label>Primary DA ID (\u09af\u09c7\u09ae\u09a8: CF4526, RF20363):</label>\n              <input type=\"text\" id=\"daIdInput\" placeholder=\"e.g. CF9988\" />\n            </div>\n            <div>\n              <label>Alt / Old ID (\u0990\u099a\u09cd\u099b\u09bf\u0995):</label>\n              <input type=\"text\" id=\"daAltIdInput\" placeholder=\"e.g. C122210\" />\n            </div>\n            <div>\n              <label>\u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf\u09b0 \u09a8\u09be\u09ae (DA Name):</label>\n              <input type=\"text\" id=\"daNameInput\" placeholder=\"e.g. Md Karim Uddin\" />\n            </div>\n            <div>\n              <label>\u09ae\u09cb\u09ac\u09be\u0987\u09b2 \u09a8\u09ae\u09cd\u09ac\u09b0 (\u0995\u09ae\u09be \u09a6\u09bf\u09df\u09c7 \u098f\u0995\u09be\u09a7\u09bf\u0995 \u09a6\u09c7\u0993\u09df\u09be \u09af\u09be\u09ac\u09c7):</label>\n              <input type=\"text\" id=\"daPhonesInput\" placeholder=\"e.g. 01711223344\" />\n            </div>\n            <div>\n              <label>\u09a1\u09be\u0995\u09a8\u09be\u09ae / Aliases (\u0995\u09ae\u09be \u09a6\u09bf\u09df\u09c7):</label>\n              <input type=\"text\" id=\"daAliasesInput\" placeholder=\"e.g. karim, karim da\" />\n            </div>\n          </div>\n          <div class=\"btn-row\">\n            <button class=\"btn-primary\" onclick=\"saveDaRecord()\">\ud83d\udcbe \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf \u09b8\u09c7\u09ad \u0995\u09b0\u09c1\u09a8 (Save DA)</button>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-yellow\">\n          <span>\ud83d\udc65 \u09ac\u09b0\u09cd\u09a4\u09ae\u09be\u09a8 \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf \u09a4\u09be\u09b2\u09bf\u0995\u09be (Total DAs: <span id=\"daTotalLabel\">0</span>)</span>\n          <input type=\"text\" id=\"daSearchInput\" placeholder=\"\ud83d\udd0d ID, \u09a8\u09be\u09ae \u09ac\u09be \u09ae\u09cb\u09ac\u09be\u0987\u09b2 \u09a6\u09bf\u09df\u09c7 \u0996\u09c1\u0981\u099c\u09c1\u09a8...\" oninput=\"renderDaTable()\" style=\"max-width:280px; padding:6px 10px;\" />\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\">\n            <table>\n              <thead>\n                <tr>\n                  <th>#</th>\n                  <th>DA ID</th>\n                  <th>Alt ID</th>\n                  <th>\u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf\u09b0 \u09a8\u09be\u09ae (Name)</th>\n                  <th>\u09ae\u09cb\u09ac\u09be\u0987\u09b2 \u09a8\u09ae\u09cd\u09ac\u09b0</th>\n                  <th>Aliases / \u09a1\u09be\u0995\u09a8\u09be\u09ae</th>\n                  <th>\u0985\u09cd\u09af\u09be\u0995\u09b6\u09a8 (Edit / Delete)</th>\n                </tr>\n              </thead>\n              <tbody id=\"daDatabaseBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n    </div>\n\n    <!-- =================================================================== -->\n    <!-- TAB 3: PRODUCT & WRONG SPELLING (ALIASES) MANAGER                   -->\n    <!-- =================================================================== -->\n    <div id=\"tab-products\" class=\"tab-panel\">\n      <div class=\"card\">\n        <div class=\"card-header h-sky\">\n          <span>\ud83d\udc8a \u09a8\u09a4\u09c1\u09a8 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8 \u0985\u09a5\u09ac\u09be \u09a6\u09be\u09ae \u0993 \u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 (Aliases) \u098f\u09a1\u09bf\u099f \u0995\u09b0\u09c1\u09a8</span>\n          <div style=\"display:flex; gap:8px;\">\n            <button class=\"btn-yellow btn-sm\" onclick=\"resetProductForm()\">\ud83d\udd04 Clear Form</button>\n            <button class=\"btn-blue btn-sm\" onclick=\"resetProductsToDefault()\">\u267b\ufe0f \u09a1\u09bf\u09ab\u09b2\u09cd\u099f \u09ed\u09ef\u099f\u09bf \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09b0\u09bf\u09b8\u09cd\u099f\u09cb\u09b0 \u0995\u09b0\u09c1\u09a8</button>\n          </div>\n        </div>\n        <div class=\"card-body\">\n          <input type=\"hidden\" id=\"prodOriginalCode\" />\n          <div style=\"display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:12px;\">\n            <div>\n              <label>CRP Code (\u09af\u09c7\u09ae\u09a8: 919, CS7):</label>\n              <input type=\"text\" id=\"prodCodeInput\" placeholder=\"e.g. 919\" />\n            </div>\n            <div>\n              <label>\u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f\u09c7\u09b0 \u09a8\u09be\u09ae (Official Name):</label>\n              <input type=\"text\" id=\"prodNameInput\" placeholder=\"e.g. TOTIFEN SYRUP 100ML\" />\n            </div>\n            <div>\n              <label>\u09aa\u09cd\u09af\u09be\u0995 \u09b8\u09be\u0987\u099c (Pack Unit):</label>\n              <input type=\"text\" id=\"prodUnitInput\" placeholder=\"e.g. Bottle (100ml)\" />\n            </div>\n            <div>\n              <label>Trade Price (\u09f3 \u09a6\u09b0):</label>\n              <input type=\"number\" step=\"0.01\" id=\"prodPriceInput\" placeholder=\"e.g. 47.23\" />\n            </div>\n            <div>\n              <label>Brand Family (\u0990\u099a\u09cd\u099b\u09bf\u0995):</label>\n              <input type=\"text\" id=\"prodFamilyInput\" placeholder=\"e.g. TOTIFEN\" />\n            </div>\n          </div>\n          <label>\u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 \u09b2\u09bf\u09b8\u09cd\u099f / Aliases (\u0995\u09ae\u09be \u09a6\u09bf\u09df\u09c7 \u09b2\u09bf\u0996\u09c1\u09a8 \u2014 \u09af\u09c7\u0995\u09cb\u09a8\u09cb \u09ac\u09be\u09a8\u09be\u09a8 \u09b2\u09bf\u0996\u09b2\u09c7\u0987 \u098f\u0987 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u099a\u09bf\u09a8\u09c7 \u09a8\u09c7\u09ac\u09c7):</label>\n          <input type=\"text\" id=\"prodAliasesInput\" placeholder=\"e.g. totifen, totipen, totifin, toti syp, totifen 100\" />\n          <div class=\"btn-row\">\n            <button class=\"btn-primary\" onclick=\"saveProductRecord()\">\ud83d\udcbe \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u0993 \u09ac\u09be\u09a8\u09be\u09a8 \u09b8\u09c7\u09ad \u0995\u09b0\u09c1\u09a8 (Save Product)</button>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-pink\">\n          <span>\ud83d\udc8a \u09b8\u09ac \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u0993 \u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 \u09a1\u09c7\u099f\u09be\u09ac\u09c7\u09b8 (Total: <span id=\"prodTotalLabel\">0</span>)</span>\n          <input type=\"text\" id=\"prodSearchInput\" placeholder=\"\ud83d\udd0d \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f\u09c7\u09b0 \u09a8\u09be\u09ae, \u0995\u09cb\u09a1 \u09ac\u09be \u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 \u0996\u09c1\u0981\u099c\u09c1\u09a8...\" oninput=\"renderProductTable()\" style=\"max-width:300px; padding:6px 10px;\" />\n        </div>\n        <div class=\"card-body\">\n          <div class=\"table-wrap\">\n            <table>\n              <thead>\n                <tr>\n                  <th>Code</th>\n                  <th>\u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f\u09c7\u09b0 \u09a8\u09be\u09ae \u0993 \u09aa\u09cd\u09af\u09be\u0995</th>\n                  <th>Trade Price (\u09f3)</th>\n                  <th>\u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 \u09b8\u09ae\u09c2\u09b9 (Recognized Wrong Spellings / Aliases)</th>\n                  <th>\u09a8\u09a4\u09c1\u09a8 \u09ac\u09be\u09a8\u09be\u09a8 \u09af\u09cb\u0997</th>\n                  <th>\u0985\u09cd\u09af\u09be\u0995\u09b6\u09a8</th>\n                </tr>\n              </thead>\n              <tbody id=\"productDatabaseBody\"></tbody>\n            </table>\n          </div>\n        </div>\n      </div>\n    </div>\n\n    <!-- =================================================================== -->\n    <!-- TAB 4: MULTIPLE PHONE NUMBERS & JSON DATABASE BACKUP                -->\n    <!-- =================================================================== -->\n    <div id=\"tab-phones\" class=\"tab-panel\">\n      <div class=\"grid\">\n        <div class=\"card\">\n          <div class=\"card-header h-yellow\">\n            <span>\ud83d\udcf2 \u09e7. \u0985\u09cd\u09af\u09be\u09a1\u09ae\u09bf\u09a8 \u0985\u09cd\u09af\u09be\u09b2\u09be\u09b0\u09cd\u099f \u0993 \u09b0\u09bf\u09aa\u09cd\u09b2\u09be\u0987 \u09a8\u09ae\u09cd\u09ac\u09b0\u09b8\u09ae\u09c2\u09b9 (Multiple Admin Numbers)</span>\n          </div>\n          <div class=\"card-body\">\n            <p style=\"font-size:0.86rem; font-weight:600; margin-bottom:10px;\">\n              \u0995\u09cb\u09a8\u09cb \u0985\u09b0\u09cd\u09a1\u09be\u09b0\u09c7 <b>\u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 DA ID/\u09a8\u09be\u09ae</b> \u0985\u09a5\u09ac\u09be <b>\u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 \u0993\u09b7\u09c1\u09a7\u09c7\u09b0 \u09ac\u09be\u09a8\u09be\u09a8</b> \u09aa\u09be\u0993\u09df\u09be \u0997\u09c7\u09b2\u09c7 \u09ac\u099f \u09a8\u09bf\u099a\u09c7\u09b0 \u09a8\u09ae\u09cd\u09ac\u09b0\u0997\u09c1\u09b2\u09cb\u09a4\u09c7 WhatsApp \u09ae\u09c7\u09b8\u09c7\u099c \u09aa\u09be\u09a0\u09bf\u09df\u09c7 \u099c\u09bf\u099c\u09cd\u099e\u09c7\u09b8 \u0995\u09b0\u09ac\u09c7 \u098f\u09ac\u0982 \u098f\u0987 \u09a8\u09ae\u09cd\u09ac\u09b0\u0997\u09c1\u09b2\u09cb \u09a5\u09c7\u0995\u09c7 Reply \u09a6\u09bf\u09b2\u09c7 \u0985\u099f\u09cb\u09ae\u09c7\u099f\u09bf\u0995 \u09a1\u09c7\u099f\u09be\u09ac\u09c7\u09b8\u09c7 \u09af\u09c1\u0995\u09cd\u09a4 \u09b9\u09df\u09c7 \u09af\u09be\u09ac\u09c7:\n            </p>\n            <label>\u0985\u09cd\u09af\u09be\u09a1\u09ae\u09bf\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0\u09b8\u09ae\u09c2\u09b9 (\u0995\u09ae\u09be \u09a6\u09bf\u09df\u09c7 \u098f\u0995\u09be\u09a7\u09bf\u0995 \u09a8\u09ae\u09cd\u09ac\u09b0 \u09af\u09cb\u0997 \u0995\u09b0\u09c1\u09a8):</label>\n            <input type=\"text\" id=\"adminAlertPhonesInput\" placeholder=\"8801793362829, 8801732273944\" />\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"savePhoneSettings()\">\ud83d\udcbe \u0985\u09cd\u09af\u09be\u09a1\u09ae\u09bf\u09a8 \u09a8\u09ae\u09cd\u09ac\u09b0 \u09b8\u09c7\u09ad \u0995\u09b0\u09c1\u09a8</button>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-header h-mint\">\n            <span>\ud83d\udcf8 \u09e8. \u099b\u09ac\u09bf\u09b0 \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u0985\u09a8\u09c1\u09ae\u09cb\u09a6\u09bf\u09a4 \u09a8\u09ae\u09cd\u09ac\u09b0\u09b8\u09ae\u09c2\u09b9 (Authorized Image Senders)</span>\n          </div>\n          <div class=\"card-body\">\n            <p style=\"font-size:0.86rem; font-weight:600; margin-bottom:10px;\">\n              \u0996\u09be\u09a4\u09be\u09df \u09b2\u09bf\u0996\u09c7 \u099b\u09ac\u09bf \u09a4\u09c1\u09b2\u09c7 \u09aa\u09be\u09a0\u09be\u09b2\u09c7 \u09b6\u09c1\u09a7\u09c1\u09ae\u09be\u09a4\u09cd\u09b0 \u09a8\u09bf\u099a\u09c7\u09b0 \u09a8\u09ae\u09cd\u09ac\u09b0\u0997\u09c1\u09b2\u09cb \u09a5\u09c7\u0995\u09c7 \u09ac\u099f \u099b\u09ac\u09bf\u09b0 \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09b0\u09bf\u09a1 \u0995\u09b0\u09ac\u09c7 (\u0995\u09ae\u09be \u09a6\u09bf\u09df\u09c7 \u09af\u09a4\u0996\u09c1\u09b6\u09bf \u09a8\u09ae\u09cd\u09ac\u09b0 \u09af\u09cb\u0997 \u09ac\u09be \u09b0\u09bf\u09ae\u09c1\u09ad \u0995\u09b0\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u09a8):\n            </p>\n            <label>\u099b\u09ac\u09bf\u09b0 \u0985\u09b0\u09cd\u09a1\u09be\u09b0\u09c7\u09b0 \u0985\u09a8\u09c1\u09ae\u09cb\u09a6\u09bf\u09a4 \u09a8\u09ae\u09cd\u09ac\u09b0\u09b8\u09ae\u09c2\u09b9 (\u0995\u09ae\u09be \u09a6\u09bf\u09df\u09c7):</label>\n            <input type=\"text\" id=\"authImagePhonesInput\" placeholder=\"8801732273944, 8801793362829\" />\n            <div class=\"btn-row\">\n              <button class=\"btn-primary\" onclick=\"savePhoneSettings()\">\ud83d\udcbe \u099b\u09ac\u09bf\u09b0 \u0985\u09a8\u09c1\u09ae\u09cb\u09a6\u09bf\u09a4 \u09a8\u09ae\u09cd\u09ac\u09b0 \u09b8\u09c7\u09ad \u0995\u09b0\u09c1\u09a8</button>\n            </div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-header h-lavender\">\n          <span>\ud83d\udce6 \u09e9. JSON \u09a1\u09c7\u099f\u09be\u09ac\u09c7\u09b8 \u09ac\u09cd\u09af\u09be\u0995\u0986\u09aa \u0993 \u09b0\u09bf\u09b8\u09cd\u099f\u09cb\u09b0 (Master DB JSON)</span>\n        </div>\n        <div class=\"card-body\">\n          <p style=\"font-size:0.86rem; font-weight:600; margin-bottom:12px;\">\n            \u0986\u09aa\u09a8\u09be\u09b0 \u09b8\u09ae\u09b8\u09cd\u09a4 \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf (DA), \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f, \u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 (Aliases) \u098f\u09ac\u0982 \u09a8\u09ae\u09cd\u09ac\u09b0\u0997\u09c1\u09b2\u09cb \u09ae\u09c7\u09ae\u09cb\u09b0\u09bf\u09a4\u09c7 \u0993 Google Sheet-\u098f\u09b0 <code>_Bot_State</code>-\u098f \u0985\u099f\u09cb\u09ae\u09c7\u099f\u09bf\u0995 \u09b8\u09c7\u09ad \u09a5\u09be\u0995\u09c7\u0964 \u099a\u09be\u0987\u09b2\u09c7 JSON \u09ab\u09be\u0987\u09b2 \u09b9\u09bf\u09b8\u09c7\u09ac\u09c7 \u09a1\u09be\u0989\u09a8\u09b2\u09cb\u09a1 \u09ac\u09be \u0986\u09aa\u09b2\u09cb\u09a1\u0993 \u0995\u09b0\u09a4\u09c7 \u09aa\u09be\u09b0\u09ac\u09c7\u09a8:\n          </p>\n          <div class=\"btn-row\">\n            <a href=\"/api/master-db/export\" class=\"btn-link btn-blue\">\u2b07 Download master_db.json</a>\n          </div>\n        </div>\n      </div>\n    </div>\n\n  </div>\n\n  <script>\n    let masterData = { das: [], products: [], adminAlertPhones: [], authorizedImagePhones: [], pendingResolutions: [] };\n    let groupInputTouched = false;\n    let lastGroupsCount = -1;\n\n    function switchTab(tabId, btnEl) {\n      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));\n      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));\n      document.getElementById(tabId).classList.add('active');\n      btnEl.classList.add('active');\n      if (tabId !== 'tab-control') {\n        loadMasterDb();\n      }\n    }\n\n    function esc(s) {\n      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n    }\n\n    function onGroupNameManualInput() {\n      groupInputTouched = true;\n      document.getElementById('targetGroupIdInput').value = '';\n    }\n\n    async function loadMasterDb() {\n      try {\n        const res = await fetch('/api/master-db');\n        const data = await res.json();\n        if (data.ok) {\n          masterData = data;\n          document.getElementById('navDaCount').textContent = (data.das || []).length;\n          document.getElementById('navProdCount').textContent = (data.products || []).length;\n          document.getElementById('adminAlertPhonesInput').value = (data.adminAlertPhones || []).join(', ');\n          document.getElementById('authImagePhonesInput').value = (data.authorizedImagePhones || []).join(', ');\n          renderDaTable();\n          renderProductTable();\n        }\n      } catch (e) {}\n    }\n\n    function renderDaTable() {\n      const q = (document.getElementById('daSearchInput')?.value || '').trim().toLowerCase();\n      const list = (masterData.das || []).filter((d) => {\n        if (!q) return true;\n        return `${d.daId} ${d.altId} ${d.name} ${(d.phones || []).join(' ')} ${(d.aliases || []).join(' ')}`.toLowerCase().includes(q);\n      });\n\n      document.getElementById('daTotalLabel').textContent = list.length;\n      const tbody = document.getElementById('daDatabaseBody');\n      if (list.length === 0) {\n        tbody.innerHTML = '<tr><td colspan=\"7\" style=\"text-align:center; font-weight:700;\">\u0995\u09cb\u09a8\u09cb \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf \u09aa\u09be\u0993\u09df\u09be \u09af\u09be\u09df\u09a8\u09bf\u0964</td></tr>';\n        return;\n      }\n\n      tbody.innerHTML = list.map((d, idx) => `\n        <tr>\n          <td><b>#${idx + 1}</b></td>\n          <td><span class=\"badge info\">${esc(d.daId)}</span></td>\n          <td>${esc(d.altId || '-')}</td>\n          <td><b>${esc(d.name)}</b></td>\n          <td>${esc((d.phones || []).join(', ') || '-')}</td>\n          <td>${(d.aliases || []).map((a) => `<span class=\"alias-chip\">${esc(a)}</span>`).join(' ')}</td>\n          <td style=\"white-space:nowrap;\">\n            <button class=\"btn-blue btn-sm\" onclick=\"editDa('${esc(d.daId)}')\">\u270f\ufe0f Edit</button>\n            <button class=\"btn-danger btn-sm\" onclick=\"deleteSingleDa('${esc(d.daId)}')\">\ud83d\uddd1\ufe0f Delete</button>\n          </td>\n        </tr>\n      `).join('');\n    }\n\n    function editDa(daId) {\n      const d = (masterData.das || []).find((x) => x.daId === daId);\n      if (!d) return;\n      document.getElementById('daOriginalId').value = d.daId;\n      document.getElementById('daIdInput').value = d.daId;\n      document.getElementById('daAltIdInput').value = d.altId || '';\n      document.getElementById('daNameInput').value = d.name || '';\n      document.getElementById('daPhonesInput').value = (d.phones || []).join(', ');\n      document.getElementById('daAliasesInput').value = (d.aliases || []).join(', ');\n      window.scrollTo({ top: 0, behavior: 'smooth' });\n    }\n\n    function resetDaForm() {\n      document.getElementById('daOriginalId').value = '';\n      document.getElementById('daIdInput').value = '';\n      document.getElementById('daAltIdInput').value = '';\n      document.getElementById('daNameInput').value = '';\n      document.getElementById('daPhonesInput').value = '';\n      document.getElementById('daAliasesInput').value = '';\n    }\n\n    async function saveDaRecord() {\n      const originalDaId = document.getElementById('daOriginalId').value;\n      const daId = document.getElementById('daIdInput').value;\n      const altId = document.getElementById('daAltIdInput').value;\n      const name = document.getElementById('daNameInput').value;\n      const phones = document.getElementById('daPhonesInput').value;\n      const aliases = document.getElementById('daAliasesInput').value;\n\n      const res = await fetch('/api/da/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ originalDaId, daId, altId, name, phones, aliases })\n      });\n      const data = await res.json();\n      if (!data.ok) {\n        alert(data.error || 'Error saving DA');\n        return;\n      }\n      resetDaForm();\n      await loadMasterDb();\n    }\n\n    async function deleteSingleDa(daId) {\n      if (!confirm(`\u0986\u09aa\u09a8\u09bf \u0995\u09bf \u09a8\u09bf\u09b6\u09cd\u099a\u09bf\u09a4 \u09af\u09c7 [${daId}] \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf\u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09a4\u09c7 \u099a\u09be\u09a8?`)) return;\n      await fetch('/api/da/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ daId })\n      });\n      await loadMasterDb();\n    }\n\n    async function deleteAllDas() {\n      if (!confirm('\u09b8\u09a4\u09b0\u09cd\u0995\u09ac\u09be\u09b0\u09cd\u09a4\u09be: \u0986\u09aa\u09a8\u09bf \u0995\u09bf \u09a1\u09c7\u099f\u09be\u09ac\u09c7\u09b8 \u09a5\u09c7\u0995\u09c7 \u09b8\u09ac \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf (All DAs) \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09a4\u09c7 \u099a\u09be\u09a8?')) return;\n      await fetch('/api/da/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ deleteAll: true })\n      });\n      await loadMasterDb();\n    }\n\n    async function resetAllDasToDefault() {\n      if (!confirm('\u09a1\u09bf\u09ab\u09b2\u09cd\u099f \u09ea\u09ec \u099c\u09a8 \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf\u09b0 \u09a4\u09be\u09b2\u09bf\u0995\u09be \u09b0\u09bf\u09b8\u09cd\u099f\u09cb\u09b0 \u0995\u09b0\u09a4\u09c7 \u099a\u09be\u09a8?')) return;\n      await fetch('/api/da/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ resetDefault: true })\n      });\n      await loadMasterDb();\n    }\n\n    function renderProductTable() {\n      const q = (document.getElementById('prodSearchInput')?.value || '').trim().toLowerCase();\n      const list = (masterData.products || []).filter((p) => {\n        if (!q) return true;\n        return `${p.code} ${p.name} ${p.unit} ${(p.aliases || []).join(' ')}`.toLowerCase().includes(q);\n      });\n\n      document.getElementById('prodTotalLabel').textContent = list.length;\n      const tbody = document.getElementById('productDatabaseBody');\n      if (list.length === 0) {\n        tbody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center; font-weight:700;\">\u0995\u09cb\u09a8\u09cb \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09aa\u09be\u0993\u09df\u09be \u09af\u09be\u09df\u09a8\u09bf\u0964</td></tr>';\n        return;\n      }\n\n      tbody.innerHTML = list.map((p) => `\n        <tr>\n          <td><span class=\"badge warn\">${esc(p.code)}</span></td>\n          <td><b>${esc(p.name)}</b><br/><span style=\"font-size:0.76rem;\">${esc(p.unit)}</span></td>\n          <td style=\"font-weight:800;\">\u09f3${Number(p.price || 0).toFixed(2)}</td>\n          <td>\n            ${(p.aliases || []).map((a) => `\n              <span class=\"alias-chip\">\n                ${esc(a)}\n                <span style=\"cursor:pointer; color:#b91c1c; font-weight:900;\" onclick=\"modifyProductAlias('${esc(p.code)}', '${esc(a)}', 'remove')\" title=\"\u09ae\u09c1\u099b\u09c1\u09a8\">\u00d7</span>\n              </span>\n            `).join('')}\n          </td>\n          <td>\n            <div style=\"display:flex; gap:4px; min-width:160px;\">\n              <input type=\"text\" id=\"quickAlias_${esc(p.code)}\" placeholder=\"\u09ad\u09c1\u09b2 \u09ac\u09be\u09a8\u09be\u09a8 \u09b2\u09bf\u0996\u09c1\u09a8...\" style=\"padding:4px 8px; font-size:0.78rem;\" />\n              <button class=\"btn-primary btn-sm\" onclick=\"quickAddAlias('${esc(p.code)}')\">+ \u09af\u09cb\u0997</button>\n            </div>\n          </td>\n          <td style=\"white-space:nowrap;\">\n            <button class=\"btn-blue btn-sm\" onclick=\"editProduct('${esc(p.code)}')\">\u270f\ufe0f Edit</button>\n            <button class=\"btn-danger btn-sm\" onclick=\"deleteSingleProduct('${esc(p.code)}')\">\ud83d\uddd1\ufe0f</button>\n          </td>\n        </tr>\n      `).join('');\n    }\n\n    function editProduct(code) {\n      const p = (masterData.products || []).find((x) => String(x.code) === String(code));\n      if (!p) return;\n      document.getElementById('prodOriginalCode').value = p.code;\n      document.getElementById('prodCodeInput').value = p.code;\n      document.getElementById('prodNameInput').value = p.name;\n      document.getElementById('prodUnitInput').value = p.unit || '';\n      document.getElementById('prodPriceInput').value = p.price || 0;\n      document.getElementById('prodFamilyInput').value = p.family || '';\n      document.getElementById('prodAliasesInput').value = (p.aliases || []).join(', ');\n      window.scrollTo({ top: 0, behavior: 'smooth' });\n    }\n\n    function resetProductForm() {\n      document.getElementById('prodOriginalCode').value = '';\n      document.getElementById('prodCodeInput').value = '';\n      document.getElementById('prodNameInput').value = '';\n      document.getElementById('prodUnitInput').value = '';\n      document.getElementById('prodPriceInput').value = '';\n      document.getElementById('prodFamilyInput').value = '';\n      document.getElementById('prodAliasesInput').value = '';\n    }\n\n    async function saveProductRecord() {\n      const originalCode = document.getElementById('prodOriginalCode').value;\n      const code = document.getElementById('prodCodeInput').value;\n      const name = document.getElementById('prodNameInput').value;\n      const unit = document.getElementById('prodUnitInput').value;\n      const price = document.getElementById('prodPriceInput').value;\n      const family = document.getElementById('prodFamilyInput').value;\n      const aliases = document.getElementById('prodAliasesInput').value;\n\n      const res = await fetch('/api/product/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ originalCode, code, name, unit, price, family, aliases })\n      });\n      const data = await res.json();\n      if (!data.ok) {\n        alert(data.error || 'Error saving product');\n        return;\n      }\n      resetProductForm();\n      await loadMasterDb();\n    }\n\n    async function quickAddAlias(code) {\n      const inp = document.getElementById('quickAlias_' + code);\n      if (!inp || !inp.value.trim()) return;\n      await modifyProductAlias(code, inp.value.trim(), 'add');\n      inp.value = '';\n    }\n\n    async function modifyProductAlias(code, alias, action) {\n      await fetch('/api/product/alias', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ code, alias, action })\n      });\n      await loadMasterDb();\n    }\n\n    async function deleteSingleProduct(code) {\n      if (!confirm(`\u0986\u09aa\u09a8\u09bf \u0995\u09bf [${code}] \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f\u099f\u09bf \u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09a4\u09c7 \u099a\u09be\u09a8?`)) return;\n      await fetch('/api/product/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ code })\n      });\n      await loadMasterDb();\n    }\n\n    async function resetProductsToDefault() {\n      if (!confirm('\u09a1\u09bf\u09ab\u09b2\u09cd\u099f \u09ed\u09ef\u099f\u09bf \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u098f\u09ac\u0982 \u0985\u09ab\u09bf\u09b6\u09bf\u09df\u09be\u09b2 Trade Price \u09b0\u09bf\u09b8\u09cd\u099f\u09cb\u09b0 \u0995\u09b0\u09a4\u09c7 \u099a\u09be\u09a8?')) return;\n      await fetch('/api/product/delete', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ resetDefault: true })\n      });\n      await loadMasterDb();\n    }\n\n    async function savePhoneSettings() {\n      const adminAlertPhones = document.getElementById('adminAlertPhonesInput').value;\n      const authorizedImagePhones = document.getElementById('authImagePhonesInput').value;\n      const res = await fetch('/api/phones/save', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ adminAlertPhones, authorizedImagePhones })\n      });\n      const data = await res.json();\n      if (data.ok) {\n        alert('\u2705 \u09a8\u09ae\u09cd\u09ac\u09b0\u0997\u09c1\u09b2\u09cb \u09b8\u09ab\u09b2\u09ad\u09be\u09ac\u09c7 \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7!');\n        await loadMasterDb();\n        await fetchStatus();\n      }\n    }\n\n    async function resolvePendingFromWeb(token, customAnswer) {\n      const ans = customAnswer !== undefined ? customAnswer : document.getElementById('pendingAns_' + token)?.value;\n      if (!ans || !ans.trim()) return;\n      const res = await fetch('/api/pending/resolve', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ token, answer: ans })\n      });\n      const data = await res.json();\n      alert(data.message || 'Done');\n      await fetchStatus();\n      await loadMasterDb();\n    }\n\n    async function fetchStatus() {\n      try {\n        const res = await fetch('/api/status');\n        const data = await res.json();\n\n        document.getElementById('navDaCount').textContent = data.daCount || 0;\n        document.getElementById('navProdCount').textContent = data.productCount || 0;\n\n        const waBadge = document.getElementById('waBadge');\n        if (data.waStatus === 'CONNECTED') {\n          waBadge.className = 'badge ok';\n          waBadge.textContent = '\ud83d\udfe2 WhatsApp Connected';\n        } else if (data.waStatus === 'QR_READY') {\n          waBadge.className = 'badge warn';\n          waBadge.textContent = '\ud83d\udcf2 Scan QR Code';\n        } else {\n          waBadge.className = 'badge err';\n          waBadge.textContent = '\u23f3 ' + data.waStatus;\n        }\n\n        const sheetBadge = document.getElementById('sheetBadge');\n        if (data.googleAuthReady) {\n          sheetBadge.className = 'badge ok';\n          sheetBadge.textContent = '\ud83d\udfe2 Sheet Connected';\n        } else {\n          sheetBadge.className = 'badge err';\n          sheetBadge.textContent = '\u26a0\ufe0f Sheet Auth Needed';\n        }\n\n        document.getElementById('ramBadge').textContent = '\u26a1 RAM: ' + (data.memoryMB || 0) + ' MB';\n        document.getElementById('openSheetBtn').href = data.googleSheetUrl;\n\n        document.getElementById('statGroup').textContent =\n          data.botConfig.targetGroupName || data.botConfig.targetGroupId || 'All Joined Groups';\n        document.getElementById('statSaved').textContent = data.stats.totalOrdersSaved;\n        document.getElementById('statAmount').textContent =\n          '\u09f3' + Number(data.stats.totalAmountSaved || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });\n\n        const pendings = data.pendingResolutions || [];\n        document.getElementById('statPending').textContent = pendings.length;\n        document.getElementById('statAdminPhones').innerHTML = (data.adminAlertPhones || []).join('<br/>');\n\n        // Render Pending Resolutions Box\n        const pCard = document.getElementById('pendingCard');\n        const pList = document.getElementById('pendingListContainer');\n        if (pendings.length > 0) {\n          pCard.style.display = 'block';\n          pList.innerHTML = pendings.map((p) => {\n            if (p.type === 'UNKNOWN_DA') {\n              return `\n                <div style=\"border:2.5px solid #000; background:#FEF9C3; padding:12px; border-radius:8px; margin-bottom:10px;\">\n                  <div><b>${esc(p.token)} \u2014 \u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 \u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf (Unknown DA)</b> ${p.detectedDaId ? `[\u09b6\u09a8\u09be\u0995\u09cd\u09a4\u0995\u09c3\u09a4 ID: <b>${esc(p.detectedDaId)}</b>]` : ''}</div>\n                  <div style=\"font-size:0.84rem; margin:4px 0;\">\u0985\u09b0\u09cd\u09a1\u09be\u09b0: ${esc((p.orders || []).map((o) => o.productName + ' (' + o.orderedQty + ')').join(', '))}</div>\n                  <div style=\"display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;\">\n                    <input type=\"text\" id=\"pendingAns_${esc(p.token)}\" placeholder=\"ID \u0993 \u09a8\u09be\u09ae \u09b2\u09bf\u0996\u09c1\u09a8 (\u09af\u09c7\u09ae\u09a8: CF4526 Seraj)\" style=\"max-width:300px;\" />\n                    <button class=\"btn-primary btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}')\">\u2705 \u09b8\u09c7\u09ad \u0995\u09b0\u09c1\u09a8</button>\n                    <button class=\"btn-danger btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}', 'skip')\">\ud83d\uddd1\ufe0f \u09ac\u09be\u09a4\u09bf\u09b2</button>\n                  </div>\n                </div>\n              `;\n            } else {\n              return `\n                <div style=\"border:2.5px solid #000; background:#E0F2FE; padding:12px; border-radius:8px; margin-bottom:10px;\">\n                  <div><b>${esc(p.token)} \u2014 \u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f/\u09ac\u09be\u09a8\u09be\u09a8: \"${esc(p.unknownProductText)}\" (\u09aa\u09b0\u09bf\u09ae\u09be\u09a3: ${esc(p.orderedQty)})</b></div>\n                  <div style=\"font-size:0.84rem; margin:4px 0;\">\u09aa\u09cd\u09b0\u09a4\u09bf\u09a8\u09bf\u09a7\u09bf: ${esc(p.daInfo?.name)} (${esc(p.daInfo?.daId)}) | \u09ae\u09c2\u09b2 \u09b2\u09be\u0987\u09a8: \"${esc(p.rawLine)}\"</div>\n                  <div style=\"display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;\">\n                    <input type=\"text\" id=\"pendingAns_${esc(p.token)}\" placeholder=\"\u09b8\u09a0\u09bf\u0995 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f\u09c7\u09b0 \u09a8\u09be\u09ae \u09ac\u09be \u0995\u09cb\u09a1 (\u09af\u09c7\u09ae\u09a8: Totifen \u09ac\u09be 919)\" style=\"max-width:320px;\" />\n                    <button class=\"btn-primary btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}')\">\ud83e\udde0 \u09ac\u09be\u09a8\u09be\u09a8 \u09b6\u09c7\u0996\u09be\u09a8 \u0993 \u09b8\u09c7\u09ad \u0995\u09b0\u09c1\u09a8</button>\n                    <button class=\"btn-danger btn-sm\" onclick=\"resolvePendingFromWeb('${esc(p.token)}', 'skip')\">\ud83d\uddd1\ufe0f \u09ac\u09be\u09a6 \u09a6\u09bf\u09a8</button>\n                  </div>\n                </div>\n              `;\n            }\n          }).join('');\n        } else {\n          pCard.style.display = 'none';\n        }\n\n        const qrBox = document.getElementById('qrContainer');\n        if (data.waStatus === 'CONNECTED' && data.connectedUser) {\n          qrBox.innerHTML =\n            '<div style=\"font-size:2.4rem; margin-bottom:4px;\">\u2705</div>' +\n            '<h3 style=\"font-weight:800;\">WhatsApp \u09b8\u099a\u09b2 \u0986\u099b\u09c7!</h3>' +\n            '<p style=\"font-size:0.86rem; font-weight:700; margin-top:4px;\">Account: <b>' +\n            esc(data.connectedUser.name) +\n            '</b> (' +\n            esc(data.connectedUser.id.split(':')[0]) +\n            ')</p>' +\n            '<span class=\"badge ok\" style=\"margin-top:10px;\">\u2601\ufe0f Cloud Session & Master DB Active</span>';\n        } else if (data.qrDataUrl) {\n          qrBox.innerHTML =\n            '<img src=\"' +\n            data.qrDataUrl +\n            '\" alt=\"WhatsApp QR Code\" />' +\n            '<p style=\"font-weight:800; font-size:0.86rem;\">WhatsApp \u2794 Linked Devices \u09a5\u09c7\u0995\u09c7 \u09b8\u09cd\u0995\u09cd\u09af\u09be\u09a8 \u0995\u09b0\u09c1\u09a8</p>';\n        } else {\n          qrBox.innerHTML = '<p style=\"font-weight:700;\">\ud83d\udd04 WhatsApp \u0995\u09be\u09a8\u09c7\u0995\u09cd\u099f \u09b9\u099a\u09cd\u099b\u09c7...</p>';\n        }\n\n        const select = document.getElementById('groupSelect');\n        const groups = data.joinedGroups || [];\n        if (groups.length !== lastGroupsCount && !groupInputTouched) {\n          lastGroupsCount = groups.length;\n          select.innerHTML = '<option value=\"ALL\">\ud83c\udf10 All Joined Groups (\u09b8\u09ac \u0997\u09cd\u09b0\u09c1\u09aa \u09a5\u09c7\u0995\u09c7 \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09a8\u09bf\u09ac\u09c7)</option>';\n          groups.forEach((g) => {\n            const opt = document.createElement('option');\n            opt.value = g.id;\n            opt.dataset.name = g.subject;\n            opt.textContent = g.subject + ' (' + g.size + ' members)';\n            if (data.botConfig.targetGroupId === g.id) opt.selected = true;\n            select.appendChild(opt);\n          });\n        }\n\n        if (!groupInputTouched) {\n          document.getElementById('targetGroupNameInput').value = data.botConfig.targetGroupName || '';\n          document.getElementById('targetGroupIdInput').value = data.botConfig.targetGroupId || '';\n          document.getElementById('autoReactCheckbox').checked = !!data.botConfig.autoReactOnOrder;\n        }\n\n        const tbody = document.getElementById('ordersTableBody');\n        if (data.recentOrders && data.recentOrders.length > 0) {\n          tbody.innerHTML = data.recentOrders\n            .map(\n              (o) =>\n                '<tr>' +\n                '<td><b>' + esc(o.date) + '</b><br/>' + esc(o.time) + '</td>' +\n                '<td><b>' + esc(o.daId) + '</b><br/><span>' + esc(o.daName) + '</span></td>' +\n                '<td><b>' + esc(o.psoCode) + '</b></td>' +\n                '<td>' + esc(o.pharmacyName) + '</td>' +\n                '<td><b>' + esc(o.rawText) + '</b></td>' +\n                '<td><b>[' + esc(o.crpCode) + ']</b> ' + esc(o.productName) + '</td>' +\n                '<td><b>' + esc(o.orderedQty) + '</b></td>' +\n                '<td>\u09f3' + Number(o.unitPrice).toFixed(2) + '</td>' +\n                '<td style=\"font-weight:800;\">\u09f3' + Number(o.totalAmount).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>' +\n                '<td>' + esc(o.matchType) + '</td>' +\n                '</tr>'\n            )\n            .join('');\n        } else {\n          tbody.innerHTML = '<tr><td colspan=\"10\" style=\"text-align:center; font-weight:700;\">\u09ae\u09c7\u09ae\u09cb\u09b0\u09bf \u09ac\u09be\u09ab\u09be\u09b0\u09c7 \u0995\u09cb\u09a8\u09cb \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09a8\u09c7\u0987\u0964</td></tr>';\n        }\n\n        const logBox = document.getElementById('logBox');\n        logBox.innerHTML = (data.logs || []).map((l) => '<div>' + esc(l) + '</div>').join('');\n      } catch (e) {}\n    }\n\n    function onGroupDropdownChange() {\n      const sel = document.getElementById('groupSelect');\n      const opt = sel.options[sel.selectedIndex];\n      if (!opt) return;\n      groupInputTouched = true;\n      if (opt.value === 'ALL') {\n        document.getElementById('targetGroupIdInput').value = 'ALL';\n        document.getElementById('targetGroupNameInput').value = 'All Joined Groups (\u09b8\u09ac \u0997\u09cd\u09b0\u09c1\u09aa)';\n      } else {\n        document.getElementById('targetGroupIdInput').value = opt.value;\n        document.getElementById('targetGroupNameInput').value = opt.dataset.name || '';\n      }\n    }\n\n    async function refreshGroups() {\n      const res = await fetch('/api/groups/refresh', { method: 'POST' });\n      const data = await res.json();\n      lastGroupsCount = -1;\n      groupInputTouched = false;\n      await fetchStatus();\n      alert('\u0997\u09cd\u09b0\u09c1\u09aa \u09b2\u09bf\u09b8\u09cd\u099f \u0986\u09aa\u09a1\u09c7\u099f \u09b9\u09df\u09c7\u099b\u09c7! \u09ae\u09cb\u099f \u0997\u09cd\u09b0\u09c1\u09aa: ' + (data.groups || []).length);\n    }\n\n    async function saveGroupConfig() {\n      const groupId = document.getElementById('targetGroupIdInput').value;\n      const groupName = document.getElementById('targetGroupNameInput').value;\n      const autoReactOnOrder = document.getElementById('autoReactCheckbox').checked;\n\n      const res = await fetch('/api/config/group', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ groupId, groupName, autoReactOnOrder })\n      });\n      const data = await res.json();\n      if (data.ok) {\n        document.getElementById('saveStatusMsg').textContent =\n          '\u2705 \u0997\u09cd\u09b0\u09c1\u09aa \u09b8\u09c7\u099f\u09bf\u0982\u09b8 \u09b8\u09c7\u09ad \u09b9\u09df\u09c7\u099b\u09c7: ' + (data.botConfig.targetGroupName || 'All');\n        groupInputTouched = false;\n        fetchStatus();\n      }\n    }\n\n    async function syncSheetStructure() {\n      const res = await fetch('/api/sheets/sync', { method: 'POST' });\n      const data = await res.json();\n      alert(data.ok ? '\u2705 Google Sheet-\u098f \u09b8\u09ac \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u0993 DA \u09a4\u09be\u09b2\u09bf\u0995\u09be \u09b8\u09bf\u0999\u09cd\u0995 \u09b9\u09df\u09c7\u099b\u09c7!' : '\u26a0\ufe0f Error: ' + data.googleAuthError);\n      fetchStatus();\n    }\n\n    async function clearLiveOrders() {\n      await fetch('/api/orders/clear', { method: 'POST' });\n      fetchStatus();\n    }\n\n    async function clearServerLogs() {\n      await fetch('/api/logs/clear', { method: 'POST' });\n      fetchStatus();\n    }\n\n    async function runTestParse(saveToSheet) {\n      const messageText = document.getElementById('testInput').value;\n      const res = await fetch('/api/test-parse', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ messageText, saveToSheet, isImageOrder: true })\n      });\n      const data = await res.json();\n      const box = document.getElementById('testResultBox');\n      let html = '';\n      if (data.daInfo) {\n        html += `<div style=\"margin-bottom:4px;\">\ud83d\udc64 <b>DA:</b> ${esc(data.daInfo.name)} (${esc(data.daInfo.daId)}) \u2014 ${data.daInfo.isKnownDA ? '\u2705 \u09aa\u09b0\u09bf\u099a\u09bf\u09a4' : '\u2753 \u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 (Admin \u09aa\u09cd\u09b0\u09b6\u09cd\u09a8 \u09aa\u09be\u09a0\u09be\u09a8\u09cb \u09b9\u09ac\u09c7)'}</div>`;\n      }\n      if (data.orders && data.orders.length > 0) {\n        html += `<div style=\"background:#A7F3D0; border:2px solid #000; padding:8px; border-radius:6px; margin-bottom:4px;\">\u2705 \u09b6\u09a8\u09be\u0995\u09cd\u09a4\u0995\u09c3\u09a4 \u0985\u09b0\u09cd\u09a1\u09be\u09b0: ${data.orders.length}\u099f\u09bf</div>`;\n      }\n      if (data.unrecognizedItems && data.unrecognizedItems.length > 0) {\n        html += `<div style=\"background:#FEF08A; border:2px solid #000; padding:8px; border-radius:6px;\">\ud83e\udd14 \u0985\u09aa\u09b0\u09bf\u099a\u09bf\u09a4 \u09aa\u09cd\u09b0\u09cb\u09a1\u09be\u0995\u09cd\u099f \u09ac\u09be\u09a8\u09be\u09a8: ${data.unrecognizedItems.map((u) => esc(u.unknownProductText) + ' (' + u.orderedQty + ')').join(', ')}</div>`;\n      }\n      box.innerHTML = html || '\u0995\u09cb\u09a8\u09cb \u0985\u09b0\u09cd\u09a1\u09be\u09b0 \u09aa\u09be\u0993\u09df\u09be \u09af\u09be\u09df\u09a8\u09bf\u0964';\n      fetchStatus();\n    }\n\n    async function logoutWhatsApp() {\n      if (!confirm('\u09a8\u09a4\u09c1\u09a8 WhatsApp \u0985\u09cd\u09af\u09be\u0995\u09be\u0989\u09a8\u09cd\u099f \u0995\u09be\u09a8\u09c7\u0995\u09cd\u099f \u0995\u09b0\u09a4\u09c7 \u099a\u09be\u09a8?')) return;\n      await fetch('/api/whatsapp/logout', { method: 'POST' });\n      fetchStatus();\n    }\n\n    fetchStatus();\n    loadMasterDb();\n    setInterval(fetchStatus, 3500);\n  </script>\n</body>\n</html>");
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
  app.listen(PORT, '0.0.0.0', () => {
    addLog(`🚀 Renata CRP Order Tracker v5.0 running on port ${PORT}`);
  });

  await initGoogleSheetsClient();
  if (googleAuthReady) {
    // 1. Restore saved group config, Master DB & WhatsApp auth session FIRST
    await restoreAuthAndConfigFromSheet();
    // 2. Ensure spreadsheet tabs & official trade prices exist
    await ensureSpreadsheetStructure(true);
  }

  await startWhatsApp();
  startKeepAliveLoop();
}

bootstrap();
