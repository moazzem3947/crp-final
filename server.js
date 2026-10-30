/**
 * ============================================================================
 * RENATA PLC (NOAKHALI DEPOT) — WHATSAPP GROUP CRP ORDER TRACKER & AUTO SYNC
 * ============================================================================
 * Features:
 * 1. Baileys Multi-Device WhatsApp Web Client (Lightweight <80MB RAM for Render Free Tier)
 * 2. Web Dashboard with Live QR Scanner & 1-Click WhatsApp Group Selector
 * 3. Permanent Cloud Session & Group Config Persistence inside Google Sheets (_Bot_State)
 *    -> Never lose WhatsApp login or group selection even when Render restarts!
 * 4. Built-in Master Data of all 78 CRP Products & 46 Delivery Assistants (DAs)
 * 5. Multi-Layer Fuzzy Spell-Checker & Variant Disambiguator (handles severe typos)
 * 6. Unsend ("Delete for Everyone") & Message Edit Auto-Sync:
 *    -> Automatically removes unsent orders from Live_Orders & logs to Deleted_Unsent_Log
 *    -> Automatically updates edited messages in Live_Orders
 * 7. Render Free-Tier Keep-Alive Self-Pinger (prevents 15-minute idle spin-down)
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
  Browsers
} = require('@whiskeysockets/baileys');

// ============================================================================
// 1. CONFIGURATION & ENVIRONMENT VARIABLES
// ============================================================================
const PORT = process.env.PORT || 3000;
const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || '1lvZG2PWV0HjjbVBZjrV14brxYDizfmGm4yYj2mUYkF0').trim();
const RENDER_EXTERNAL_URL = (process.env.RENDER_EXTERNAL_URL || '').trim();
const ADMIN_PIN = (process.env.ADMIN_PIN || '').trim(); // Optional PIN protection for dashboard
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const LOCAL_CONFIG_PATH = path.join(__dirname, 'bot_config.json');

const SHEET_TABS = {
  LIVE_ORDERS: 'Live_Orders',
  DA_SUMMARY: 'DA_Wise_Summary',
  PRODUCT_SUMMARY: 'Product_Wise_Summary',
  DELETED_LOG: 'Deleted_Unsent_Log',
  BOT_STATE: '_Bot_State'
};

// ============================================================================
// 2. MASTER DATABASE: 78 OFFICIAL CRP PRODUCTS (FROM CRP.XLSX)
// ============================================================================
const DEFAULT_CRP_PRODUCTS = [
  { code: '919', name: 'TOTIFEN SYRUP 100ML', unit: 'Bottle (100ml)', price: 63.00, family: 'TOTIFEN', aliases: ['totifen', 'totipen', 'totifin', 'totefen', 'totifen syp', 'totifen syr', 'totifen sry', 'totifen 100ml', 'totifen syrh'] },
  { code: '81', name: "DOXICAP 100MG CAP 100'S", unit: "Box (100's)", price: 220.00, family: 'DOXICAP', aliases: ['doxicap', 'doxicup', 'doxycap', 'doxy cap', 'doxicap 100mg', 'doxicap cap', 'doxecap'] },
  { code: '990', name: "DOMIREN SUSPENSION 100ML 1X1'S", unit: 'Bottle (100ml)', price: 55.00, family: 'DOMIREN', aliases: ['domiren 100ml', 'domiren syp', 'domiren syr', 'domiren sry', 'domeren 100ml', 'domiren 100', 'domiren susp'] },
  { code: '286', name: "DOMIREN SUSPENSION 60ML 1'S", unit: 'Bottle (60ml)', price: 35.00, family: 'DOMIREN', aliases: ['domiren 60ml', 'domeren 60ml', 'domiren 60', 'sy domira 60'] },
  { code: '60', name: "DOMIREN FC TAB 10MG 100'S", unit: "Box (100's)", price: 350.00, family: 'DOMIREN', aliases: ['domiren tab', 'domeren tab', 'domiren fc tab', 'domiren 10mg', 'domiren tablet', 'domiren tb', 'domniren tab'] },
  { code: '636', name: "DELTASONE ORAL SOLUTION 50ML 1X1'S", unit: 'Bottle (50ml)', price: 60.00, family: 'DELTASONE', aliases: ['deltasone 50ml', 'deltason 50ml', 'daltasone 50ml', 'daltason 50ml', 'delta sone 50ml', 'delta som', 'dellthesun', 'deltasone syp', 'deltason syr', 'deltason sry', 'delterson 50ml', 'deltarson 50ml'] },
  { code: '637', name: "DELTASONE ORAL SOLUTION 100ML 1X1'S", unit: 'Bottle (100ml)', price: 95.00, family: 'DELTASONE', aliases: ['deltasone 100ml', 'deltason 100ml', 'daltasone 100ml', 'delta sone 100ml', 'deltasone 100'] },
  { code: 'CS7', name: "DELTASONE 5MG TAB 17X30'S", unit: "Box (17x30's)", price: 969.00, family: 'DELTASONE', aliases: ['deltasone tab', 'deltason tab', 'daltasone tap', 'deltasone 5mg', 'deltason 5mg', 'deltasonne tab', 'deltasone 17x30'] },
  { code: '922', name: "PRAZOLE 20MG CAP 6X10'S", unit: "Box (6x10's)", price: 300.00, family: 'PRAZOLE', aliases: ['prazole', 'prazol', 'parzol', 'prajol', 'frazol', 'prazole 20mg', 'prazol cap'] },
  { code: '271', name: 'ZITHRIN DRY SYRUP 35ML', unit: 'Bottle (35ml)', price: 125.00, family: 'ZITHRIN', aliases: ['zithrin 35ml', 'zitrin 35ml', 'zithrin 35', 'zitrin 35', 'zitthrin', 'zithren', 'zithrin dry syrup', 'zithrin syp', 'zithrin syr'] },
  { code: '290', name: 'ZITHRIN DRY SYRUP 50ML', unit: 'Bottle (50ml)', price: 165.00, family: 'ZITHRIN', aliases: ['zithrin 50ml', 'zitrin 50ml', 'zithrin 50', 'zitrin 50', 'zrithrin 50ml'] },
  { code: '270', name: 'ZITHRIN DRY SYRUP 20ML', unit: 'Bottle (20ml)', price: 90.00, family: 'ZITHRIN', aliases: ['zithrin 20ml', 'zitrin 20ml', 'zithirin 20ml', 'zithrin 20'] },
  { code: '173', name: 'ZITHRIN DRY SYRUP 15ML', unit: 'Bottle (15ml)', price: 75.00, family: 'ZITHRIN', aliases: ['zithrin 15ml', 'ziyhrin 15ml', 'zithrin 15'] },
  { code: '834', name: "ZITHRIN 30ML SUSPENSION 1'S", unit: 'Bottle (30ml)', price: 115.00, family: 'ZITHRIN', aliases: ['zithrin 30ml', 'zitrin 30ml', 'zithrin 30'] },
  { code: '278', name: "XAMIC 500MG CAP (2X10'S)", unit: "Box (2x10's)", price: 440.00, family: 'XAMIC', aliases: ['xamic', 'xamic cap', 'xamic 500mg', 'xamic capsule', 'xmaic', 'examic'] },
  { code: '635', name: "RECOF 100ML SYRUP 1X1'S", unit: 'Bottle (100ml)', price: 50.00, family: 'RECOF', aliases: ['recof', 'recop', 'recof syp', 'recof syr', 'recof sry', 'recof 100ml', 'recof syraf'] },
  { code: '299', name: "TRULAX SYRUP 1MG/5ML 100ML 1'S", unit: 'Bottle (100ml)', price: 45.00, family: 'TRULAX', aliases: ['trulax', 'tulax', 'trulex', 'trulax syr', 'trulax syp', 'trulax sry', 'trulax 100ml'] },
  { code: '112', name: 'LUCAN-R SUSP. 35ML', unit: 'Bottle (35ml)', price: 92.00, family: 'LUCAN-R', aliases: ['lucan r 35ml', 'lucan-r 35ml', 'locan r sry', 'lucan r syp', 'lucan r syr', 'lukan r syp', 'luknar syraf', 'lokanar', 'lucon r syp', 'lucanar syp', 'lucar sry'] },
  { code: '876', name: "LUCAN-R 50MG CAP 4x10'S", unit: "Box (4x10's)", price: 360.00, family: 'LUCAN-R', aliases: ['lucan r 50mg', 'locan r 50mg', 'lucan-r 50mg', 'lukan r 50', 'lacan r 50mg', 'lucan r 50'] },
  { code: '605', name: 'LUCAN-R 150MG CAPS 2X6', unit: "Box (2x6's)", price: 264.96, family: 'LUCAN-R', aliases: ['lucan r 150mg', 'locan r 150mg', 'lucan-r 150mg', 'lucan r 150', 'locan r 150', 'luknar 150', 'lucon r 150', 'lunch 150'] },
  { code: '621', name: 'LUCAN-R 200MG CAPS 2X6', unit: "Box (2x6's)", price: 336.00, family: 'LUCAN-R', aliases: ['lucan r 200mg', 'locan r 200mg', 'lucan-r 200mg', 'lucan r 200', 'locan r 200', 'lucanar 200'] },
  { code: '96', name: "FLONTIN 500MG TAB 3X10'S", unit: "Box (3x10's)", price: 450.00, family: 'FLONTIN', aliases: ['flontin tab', 'flontin 500mg', 'flontine tab', 'foltin', 'flotin tab', 'falntin', 'flonten tab'] },
  { code: '226', name: "FLONTIN SUSPENSION 60ML 1'S", unit: 'Bottle (60ml)', price: 100.00, family: 'FLONTIN', aliases: ['flontin syp', 'flontin syr', 'flontin sry', 'flontin sryp', 'flontin syrp', 'flontin 60ml', 'flotin sry', 'flontin susp'] },
  { code: '179', name: "NORMANAL 500MG FC TAB (3X10'S)", unit: "Box (3x10's)", price: 270.00, family: 'NORMANAL', aliases: ['normanal', 'normal', 'normanol', 'normonal', 'narmonal', 'nomanal', 'normanal 500mg', 'normanal tab'] },
  { code: '102', name: "FUROCEF FC SUSPENSION 70ML 1X1'S", unit: 'Bottle (70ml)', price: 205.00, family: 'FUROCEF', aliases: ['furocef 70ml', 'feurocef 70ml', 'furosef 70ml', 'furocef sry', 'furocef syrp', 'furoccfe 70ml', 'reocef'] },
  { code: 'S72', name: "FUROCEF DS SUSPENSION 50ML 1X1'S", unit: 'Bottle (50ml)', price: 250.00, family: 'FUROCEF', aliases: ['furocef ds', 'feurocef ds', 'furosef ds', 'furocef 50ml', 'furocef ds sry'] },
  { code: 'S16', name: "VITA D3 40000 IU CAP 2X5'S", unit: "Box (2x5's)", price: 300.00, family: 'VITA', aliases: ['vita d3 40000', 'vita 40000', 'vita d3', 'vita d', 'bita d3'] },
  { code: 'S15', name: "VITA D3 20000 IU CAP 2X5'S", unit: "Box (2x5's)", price: 200.00, family: 'VITA', aliases: ['vita d3 20000', 'vita 20000', 'bita d3 20000'] },
  { code: 'SA4', name: "NEXDEX 30MG CAP 6X10'S", unit: "Box (6x10's)", price: 600.00, family: 'NEXDEX', aliases: ['nexdex 30mg', 'nexdex 30', 'nexdex'] },
  { code: 'SA1', name: "NEXDEX 60MG CAP 5X6'S", unit: "Box (5x6's)", price: 600.00, family: 'NEXDEX', aliases: ['nexdex 60mg', 'nexdex 60'] },
  { code: 'C2Z', name: "PCAB FC 20MG TAB 3X10'S", unit: "Box (3x10's)", price: 600.00, family: 'PCAB', aliases: ['pcab 20mg', 'pcab 20', 'p cab 20', 'pcab', 'p cab', 'pacb', 'pcap', 'picap 20', 'p-cap'] },
  { code: 'C2Y', name: "PCAB FC 10MG TAB 3X10'S", unit: "Box (3x10's)", price: 360.00, family: 'PCAB', aliases: ['pcab 10mg', 'pcab 10', 'p cab 10', 'pcap 10'] },
  { code: 'C25', name: "FERIX-V CAP 6X10'S", unit: "Box (6x10's)", price: 270.00, family: 'FERIX-V', aliases: ['ferix v', 'ferix-v', 'farix v', 'frix v', 'ferix v cap'] },
  { code: '959', name: "DESOLON TAB 1X21'S", unit: "Pack (1x21's)", price: 75.00, family: 'DESOLON', aliases: ['desolon', 'desolone', 'deselon', 'desolan', 'dasalon', 'deslon', 'deslor', 'desolon tab'] },
  { code: '633', name: "EMCON-1 1X1'S", unit: "Pack (1x1's)", price: 70.00, family: 'EMCON-1', aliases: ['emcon', 'emcon-1', 'emcon 1', 'emcon tab', 'emon', 'incone', 'em con'] },
  { code: '67', name: 'CONASYD CREAM 10MG', unit: 'Tube (10g)', price: 63.00, family: 'CONASYD', aliases: ['conasyd', 'conasid', 'conased', 'conacid', 'conasyd cream', 'conasid creem', 'conased crem'] },
  { code: 'SA3', name: "REDUCOF 100ML SYRP 1X1'S", unit: 'Bottle (100ml)', price: 100.00, family: 'REDUCOF', aliases: ['reducof', 'redicof', 'rducof', 'reducop', 'reducof syr', 'reducof syp'] },
  { code: '961', name: "GESTRENOL TAB 5MG 3X10'S", unit: "Box (3x10's)", price: 270.00, family: 'GESTRENOL', aliases: ['gestrenol', 'gestronal', 'gestonal', 'gestrnol', 'gestanol', 'gestnol', 'gestronol', 'gastronal', 'gestrennol'] },
  { code: 'SM1', name: "EXICOF 100ML SYRUP 1X1'S", unit: 'Bottle (100ml)', price: 65.00, family: 'EXICOF', aliases: ['exicof', 'exicop', 'exicap', 'exicof syp', 'exicof syr'] },
  { code: 'SY1', name: "RENASONE 10G CREAM 1X1'S", unit: 'Tube (10g)', price: 50.00, family: 'RENASONE', aliases: ['renasone', 'renason', 'renasol', 'renasone cream', 'renason crem', 'renason creem', 'renasone crm', 'renasone crime'] },
  { code: '34', name: "BECONEX SYRUP 200ML 1'S", unit: 'Bottle (200ml)', price: 65.00, family: 'BECONEX', aliases: ['beconex 200ml', 'biconex 200ml', 'beconex 200', 'beconex syp', 'biconex', 'beconez'] },
  { code: '33', name: "BECONEX SYRUP 100ML 1'S", unit: 'Bottle (100ml)', price: 35.00, family: 'BECONEX', aliases: ['beconex 100ml', 'biconex 100ml', 'beconex 100', 'beconix 100'] },
  { code: '233', name: 'BECONEX ZI SYRUP 100ML', unit: 'Bottle (100ml)', price: 55.00, family: 'BECONEX', aliases: ['beconex zi', 'be conex zi', 'becoxnex zi', 'biconex zi'] },
  { code: 'C82', name: "STARK 60ML ORAL SOLUTION 1X1'S", unit: 'Bottle (60ml)', price: 75.00, family: 'STARK', aliases: ['stark', 'strak', 'stark syp', 'stark syr', 'stark sry', 'stark 60ml'] },
  { code: '267', name: "PROTONIL EC 40MG TAB 3X10'S", unit: "Box (3x10's)", price: 240.00, family: 'PROTONIL', aliases: ['protonil 40mg', 'protonil 40'] },
  { code: '266', name: "PROTONIL EC 20MG TAB 5X10'S", unit: "Box (5x10's)", price: 250.00, family: 'PROTONIL', aliases: ['protonil 20mg', 'protonil 20', 'protonil'] },
  { code: '138', name: 'POLYCEF SYRUP 100ML', unit: 'Bottle (100ml)', price: 140.00, family: 'POLYCEF', aliases: ['polycef', 'policef', 'polycef syp', 'policef sry'] },
  { code: '875', name: "BREDICON TAB 28'S", unit: "Pack (28's)", price: 80.00, family: 'BREDICON', aliases: ['bredicon', 'bedicon', 'bredecon', 'bredcon', 'baredicon', 'badicon', 'bredicon tab'] },
  { code: 'S34', name: "PANGESIC TAB 5X6'S", unit: "Box (5x6's)", price: 240.00, family: 'PANGESIC', aliases: ['pangesic', 'pengesic', 'pangisic', 'pangasic', 'pengecic', 'pengasice', 'pangesic tab'] },
  { code: '934', name: "CALCIN-D TAB 6X10'S", unit: "Box (6x10's)", price: 480.00, family: 'CALCIN-D', aliases: ['calcin d', 'calcin-d', 'calcind', 'calcin d tab'] },
  { code: '607', name: "FLUSTAR 500MG CAP 7X4'S", unit: "Box (7x4's)", price: 364.00, family: 'FLUSTAR', aliases: ['flustar 500mg', 'flustar cap', 'fluster cap', 'fullstar cap', 'fulustar cap', 'flustar 500'] },
  { code: 'N33', name: "FLUSTAR 100ML DRY SYS 1X1'S", unit: 'Bottle (100ml)', price: 80.00, family: 'FLUSTAR', aliases: ['flustar syp', 'flustar syr', 'fullstar syr', 'fulustar syrup', 'fluster syp', 'flustar 100ml'] },
  { code: '282', name: "NORRY 3MG TAB 5X10'S", unit: "Box (5x10's)", price: 250.00, family: 'NORRY', aliases: ['norry', 'nory', 'norry 3mg', 'norry tab'] },
  { code: 'CO6', name: "ZODEF 60ML SUSP 1X1'S", unit: 'Bottle (60ml)', price: 85.00, family: 'ZODEF', aliases: ['zodef', 'zodef sy', 'zodef sry', 'zodef syp', 'zodef 60ml'] },
  { code: '902', name: "SALINE-R 20'S", unit: "Box (20's)", price: 100.00, family: 'SALINE-R', aliases: ['saline r', 'saline-r', 'slain r', 'salaine r', 'seline r', 'salin r'] },
  { code: '232', name: 'HONYCOL LINCTUS 100ML', unit: 'Bottle (100ml)', price: 40.00, family: 'HONYCOL', aliases: ['honycol', 'hunycol', 'hanycol', 'hanicol', 'honeycol', 'honycal', 'hanicon', 'honycol syp'] },
  { code: '955', name: "THYROX 50MCG 3X30'S", unit: "Box (3x30's)", price: 180.00, family: 'THYROX', aliases: ['thyrox', 'thyrox 50mcg', 'thyrox 50'] },
  { code: 'T28', name: "NUTRILINA 500MG VEG CAP 5X6'S", unit: "Box (5x6's)", price: 450.00, family: 'NUTRILINA', aliases: ['nutrilina', 'neutilina', 'nutinila', 'nutrilina 500mg'] },
  { code: 'N49', name: "RECOX FC 120MG TAB 2X10'S", unit: "Box (2x10's)", price: 300.00, family: 'RECOX', aliases: ['recox 120mg', 'recox 120'] },
  { code: 'N47', name: "RECOX FC 90MG TAB 2X10'S", unit: "Box (2x10's)", price: 240.00, family: 'RECOX', aliases: ['recox 90mg', 'recox 90', 'recox'] },
  { code: 'SZ5', name: "COPNAT N OINTMENT 15GM 1'S", unit: 'Tube (15g)', price: 65.00, family: 'COPNAT', aliases: ['copnat n ointment', 'copnet n ointment', 'copnet n oientment', 'copnat n olntment', 'copnat n', 'copnet n'] },
  { code: 'SZ4', name: "COPNAT N CREAM 15GM 1'S", unit: 'Tube (15g)', price: 65.00, family: 'COPNAT', aliases: ['copnat n cream', 'copnat n crem', 'cophnet-n cream', 'copnet n cream', 'copmate n creem'] },
  { code: 'SI1', name: "FUROCLAV 70ML DRY PWD SUSP 1X1'S", unit: 'Bottle (70ml)', price: 265.00, family: 'FUROCLAV', aliases: ['furoclav', 'feuroclav', 'furoclav 70ml'] },
  { code: 'H39', name: 'MOODS ALL-NIGHT', unit: "Pack (3's)", price: 30.00, family: 'MOODS', aliases: ['moods all night', 'moods all-night', 'ps-moods all night'] },
  { code: 'H37', name: 'MOODS DOTTED', unit: "Pack (3's)", price: 30.00, family: 'MOODS', aliases: ['moods dotted', 'mood dotted'] },
  { code: 'H89', name: "MOODS GOLD 1500 DOTS 3'S", unit: "Pack (3's)", price: 50.00, family: 'MOODS', aliases: ['moods gold 1500', 'moods gold', 'moods gola'] },
  { code: 'H88', name: "MOODS GOLD ELECTRIFY 3'S", unit: "Pack (3's)", price: 50.00, family: 'MOODS', aliases: ['moods gold electrify', 'moods gold electrifry', 'moods electrify'] },
  { code: 'H34', name: 'MOODS ULTA-THIN', unit: "Pack (3's)", price: 30.00, family: 'MOODS', aliases: ['moods ulta thin', 'moods ulta-thin', 'moods ultra thin'] },
  { code: 'CY7', name: "HYDROGEST DS 2ML (500MG/2ML) INJ 1X1'S", unit: "Ampoule (1x1's)", price: 220.00, family: 'HYDROGEST', aliases: ['hydrogest ds', 'hydrogenst ds', 'hydrogest'] },
  { code: '73', name: "DELENTIN SUSPENSION 10ML 1'S", unit: 'Bottle (10ml)', price: 25.00, family: 'DELENTIN', aliases: ['delentin', 'dilentin', 'delentin 10ml'] },
  { code: '933', name: 'FENADIN SUSPENSION 50ML', unit: 'Bottle (50ml)', price: 50.00, family: 'FENADIN', aliases: ['fenadin 50ml', 'fenadin syr', 'fenadin sry', 'fenadin'] },
  { code: '69', name: "FENADIN 30ML SUSPENSION 1'S", unit: 'Bottle (30ml)', price: 35.00, family: 'FENADIN', aliases: ['fenadin 30ml', 'fenadin sry small', 'fenadin sry smal', 'fenadin small'] },
  { code: 'N45', name: "NOVELON LITE FC TAB 1X24'S", unit: "Pack (1x24's)", price: 150.00, family: 'NOVELON', aliases: ['novelon lite', 'novelon'] },
  { code: '840', name: "EMEREN 50ML SYRP 1X1'S", unit: 'Bottle (50ml)', price: 55.00, family: 'EMEREN', aliases: ['emeren', 'emiren', 'emiren syr', 'emeren 50ml'] },
  { code: '989', name: "ALGIN SYRP 100ML 1X1'S", unit: 'Bottle (100ml)', price: 85.00, family: 'ALGIN', aliases: ['algin 100ml', 'algin syrp', 'algin syr'] },
  { code: 'C62', name: "ALGIN 50ML SYRP 1X1'S", unit: 'Bottle (50ml)', price: 45.00, family: 'ALGIN', aliases: ['algin 50ml', 'algin 50'] },
  { code: '16', name: "MAZIC JR 100ML 4.05MG/5ML SYRP 1X1'S", unit: 'Bottle (100ml)', price: 40.00, family: 'MAZIC', aliases: ['mazic jr', 'mazic jr sy', 'magic jr'] },
  { code: '18', name: "MAZIC 10MG/5ML 100ML 1X1'S", unit: 'Bottle (100ml)', price: 50.00, family: 'MAZIC', aliases: ['mazic 100ml', 'mazic', 'magic syp'] }
];

// Active product list (can be updated dynamically from Google Sheet Product_Wise_Summary tab)
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
  { daId: 'CF10145', altId: '', name: 'Moajjem', phones: [], aliases: ['moajjem', 'moazzem'] }
];

// ============================================================================
// 4. FUZZY SPELL-CHECKING & VARIANT DISAMBIGUATION ENGINE
// ============================================================================

/**
 * Computes Levenshtein Edit Distance between two strings
 */
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

/**
 * Normalized String Similarity (0.0 to 1.0) combining Levenshtein & Prefix bonus
 */
function stringSimilarity(s1, s2) {
  const a = s1.toLowerCase().trim();
  const b = s2.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  let score = 1 - dist / maxLen;
  // Phonetic & prefix bonus for Bengali-English transliteration typos (e.g. totipen vs totifen, biconex vs beconex)
  if (a.slice(0, 3) === b.slice(0, 3)) score += 0.06;
  return Math.min(1.0, Math.max(0, score));
}

/**
 * Resolves exact product within a multi-variant brand family based on dosage/strength/form cues
 */
function resolveBrandFamilyVariant(family, rawTextLower) {
  const t = rawTextLower;
  const byCode = (c) => activeProducts.find((p) => p.code === c);

  switch (family) {
    case 'DELTASONE':
      if (/\b(tab|tap|tb|5\s*mg|17\s*[\*x]\s*30)\b/i.test(t)) return byCode('CS7');
      if (/\b50\s*ml\b/i.test(t) || /\bdeltas[oa]ne?\s*50\b/i.test(t)) return byCode('636');
      if (/\b100\s*ml\b/i.test(t) || /\bdeltas[oa]ne?\s*100\b(?=.*?\b\d+)/i.test(t)) return byCode('637');
      return byCode('636'); // Default 50ML

    case 'DOMIREN':
      if (/\b(tab|tap|tb|fc|tablet|10\s*mg)\b/i.test(t)) return byCode('60');
      if (/\b100\s*ml\b/i.test(t) || /\bdom[iey]?r[ea]n\s*100\b(?=.*?\b\d+)/i.test(t)) return byCode('990');
      if (/\b60\s*ml\b/i.test(t) || /\bdom[iey]?r[ea]n\s*60\b(?=.*?\b\d+)/i.test(t)) return byCode('286');
      return byCode('990'); // Default 100ML

    case 'ZITHRIN':
      if (/\b35\s*ml\b/i.test(t) || /\bz[ri]?th?r[ie]n\s*35\b/i.test(t)) return byCode('271');
      if (/\b50\s*ml\b/i.test(t) || /\bz[ri]?th?r[ie]n\s*(?:syr|syp|sry)?\s*50\b(?=.*?\b\d+)/i.test(t)) return byCode('290');
      if (/\b30\s*ml\b/i.test(t)) return byCode('834');
      if (/\b20\s*ml\b/i.test(t)) return byCode('270');
      if (/\b15\s*ml\b/i.test(t)) return byCode('173');
      return byCode('271'); // Default 35ML

    case 'LUCAN-R':
      if (/\b200\s*(mg)?\b/i.test(t)) return byCode('621');
      if (/\b150\s*(mg)?\b/i.test(t)) return byCode('605');
      if (/\b35\s*ml\b/i.test(t) || /\b(syp|syr|sry|srp|syrp|sryp|syrup|syraf|sarape|susp)\b/i.test(t)) return byCode('112');
      if (/\b50\s*mg\b/i.test(t) || (/\b(cap|caps|capsule)\b/i.test(t) && !/\b(150|200)\b/.test(t)) || /\b(lucan|locan|lukan|lucon|lacan)\s*[\-]?r?\s*50\b(?=.*?\b\d+)/i.test(t)) {
        return byCode('876');
      }
      return byCode('112'); // Default 35ML Suspension

    case 'FUROCEF':
      if (/\b(ds|50\s*ml)\b/i.test(t)) return byCode('S72');
      return byCode('102'); // Default 70ML

    case 'BECONEX':
      if (/\bzi\b/i.test(t)) return byCode('233');
      if (/\b200\s*ml\b/i.test(t) || /\bb[ei]conex\s*200\b/i.test(t)) return byCode('34');
      if (/\b100\s*ml\b/i.test(t) || /\bb[ei]conex\s*100\b(?=.*?\b\d+)/i.test(t)) return byCode('33');
      return byCode('34'); // Default 200ML

    case 'FLONTIN':
      if (/\b(syp|syr|sry|srp|sryp|syrp|sy|syrup|syrap|susp|60\s*ml)\b/i.test(t)) return byCode('226');
      return byCode('96'); // Default 500MG Tab

    case 'FLUSTAR':
      if (/\b(cap|caps|500\s*mg|500)\b/i.test(t)) return byCode('607');
      return byCode('N33'); // Default 100ML Dry Syrup

    case 'VITA':
      if (/\b(20000|20k)\b/i.test(t)) return byCode('S15');
      return byCode('S16'); // Default 40000 IU

    case 'NEXDEX':
      if (/\b60\s*mg\b/i.test(t) || /\bnexdex\s*60\b(?=.*?\b\d+)/i.test(t)) return byCode('SA1');
      return byCode('SA4'); // Default 30MG

    case 'PCAB':
      if (/\b10\s*mg\b/i.test(t) || /\bp\s*[\-]?ca[bp]\s*10\b(?=.*?\b\d+)/i.test(t)) return byCode('C2Y');
      return byCode('C2Z'); // Default 20MG

    case 'PROTONIL':
      if (/\b40\s*(mg)?\b/i.test(t)) return byCode('267');
      return byCode('266'); // Default 20MG

    case 'RECOX':
      if (/\b120\s*(mg)?\b/i.test(t)) return byCode('N49');
      return byCode('N47'); // Default 90MG

    case 'COPNAT':
      if (/\b(cream|crem|creem|crm)\b/i.test(t) && !/\boint/i.test(t)) return byCode('SZ4');
      return byCode('SZ5'); // Default Ointment

    case 'FENADIN':
      if (/\b(30\s*ml|small|smal)\b/i.test(t)) return byCode('69');
      return byCode('933'); // Default 50ML

    case 'ALGIN':
      if (/\b50\s*(ml)?\b/i.test(t)) return byCode('C62');
      return byCode('989'); // Default 100ML

    case 'MAZIC':
      if (/\bjr\b/i.test(t)) return byCode('16');
      return byCode('18'); // Default 100ML

    case 'MOODS':
      if (/\b(ulta|ultra|thin)\b/i.test(t)) return byCode('H34');
      if (/\belectr/i.test(t)) return byCode('H88');
      if (/\b(gold|gola|1500)\b/i.test(t)) return byCode('H89');
      if (/\bdot/i.test(t)) return byCode('H37');
      return byCode('H39'); // Default MOODS ALL-NIGHT

    default:
      return activeProducts.find((p) => p.family === family);
  }
}

// Brand root keyword patterns for fast & accurate family detection
const BRAND_FAMILY_PATTERNS = [
  { family: 'TOTIFEN', regex: /\b(tot[iey]?[fpv][eai]?n|toti[fp]en|totifen|totipen|totifin)\b/i },
  { family: 'DOXICAP', regex: /\b(dox[iy]?\s*c[auo]p|doxicap|doxicup)\b/i },
  { family: 'DOMIREN', regex: /\b(dom[iey]?r[ea]n|domniren|domira)\b/i },
  { family: 'DELTASONE', regex: /\b(d[ea]ll?t[aeh]?r?\s*s[oa]n[ne]?|delta\s*som|dellthesun)\b/i },
  { family: 'PRAZOLE', regex: /\b(pr?a[zj]o?l[ea]?|parzol|frazol)\b/i },
  { family: 'ZITHRIN', regex: /\b(z[ri]?th?[i]?r[ie]n|zitrin|zitthrin|ziyhrin)\b/i },
  { family: 'XAMIC', regex: /\b(xamic|xmaic|examic)\b/i },
  { family: 'RECOF', regex: /\b(recof|recop)\b/i },
  { family: 'TRULAX', regex: /\b(tr?ul[ae]x)\b/i },
  { family: 'LUCAN-R', regex: /\b(l[ou]l?u?[ck][aeo]?n[a]?\s*[\-]?r?|lukn?ar|lokanar|lacan\s*r|luncar|lunar|lunch\s*(?:150|200|50))\b/i },
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
  { family: 'MAZIC', regex: /\b(ma[zj]ic)\b/i }
];

/**
 * Matches a raw WhatsApp product line to an official CRP product (with fuzzy spell correction)
 */
function matchCRPProduct(rawLine) {
  if (!rawLine || typeof rawLine !== 'string') return null;
  // Normalize glued numbers like "doxicap20" -> "doxicap 20", "totifen100ml" -> "totifen 100ml"
  const normalized = rawLine
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .toLowerCase();

  // Ignore conversational/question lines that are not orders
  if (/\b(mrp|koto\s*tk|kina\s*porbe|list\s*te\s*ache|sell\s*koris|video|thanks|welcome|joined|added)\b/i.test(normalized)) {
    return null;
  }

  // Stage 1: Regex Brand Family + Variant Disambiguation
  for (const item of BRAND_FAMILY_PATTERNS) {
    if (item.regex.test(normalized)) {
      const product = resolveBrandFamilyVariant(item.family, normalized);
      if (product) {
        return { product, matchType: 'Pattern/Alias', confidence: 0.98 };
      }
    }
  }

  // Stage 2: Check custom products added dynamically in Google Sheet Product_Wise_Summary
  for (const prod of activeProducts) {
    const cleanProdName = prod.name.toLowerCase().split(/\s+/)[0];
    if (cleanProdName.length >= 4 && normalized.includes(cleanProdName)) {
      const resolved = resolveBrandFamilyVariant(prod.family || cleanProdName.toUpperCase(), normalized) || prod;
      return { product: resolved, matchType: 'Direct', confidence: 0.95 };
    }
  }

  // Stage 3: Fuzzy Levenshtein Word-by-Word Spell Checker against all Product Aliases
  const STOP_WORDS = new Set([
    'syp', 'syr', 'sry', 'srp', 'syrup', 'syrap', 'syraf', 'sy', 'susp', 'tab', 'tap', 'tb', 'tablet',
    'cap', 'caps', 'capsule', 'cream', 'crem', 'creem', 'crm', 'ointment', 'ta', 'tah', 'pes', 'pcs',
    'pc', 'pic', 'box', 'bx', 'bc', 'bot', 'bottle', 'pack', 'er', 'ar', 'ml', 'mg', 'gm', 'iu', 'fc',
    'ec', 'ds', 'jr', 'pso', 'code', 'pharmacy', 'pharmechy', 'pharmecy', 'phy', 'pharma', 'medical',
    'medecal', 'hall', 'hal', 'mh', 'bazar', 'bazer', 'bz', 'market', 'road', 'hat', 'new', 'al', 'ma',
    'maa', 'jannat', 'janani', 'popular', 'model', 'unique', 'laxmipur', 'ramgonj', 'raipur', 'hatiya',
    'chowmuhani', 'noakhali', 'mandari', 'hasnabad', 'chatkhil', 'sonapur', 'kabirhat', 'company', 'dr'
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
// 5. QUANTITY EXTRACTOR & MULTI-ITEM LINE SPLITTER
// ============================================================================

/**
 * Extracts ordered pack/bottle/box quantity from a product line without confusing
 * dosage numbers (e.g., 50ml, 100ml, 40000, 500mg, 20mg, 17*30, Emcon-1, Vita D3)
 */
function extractOrderQuantity(rawLine, matchedProduct) {
  let s = rawLine;

  // 1. Remove leading list numbering like "1/", "2)", "1.", "#1"
  s = s.replace(/^\s*\d+\s*[\/)\.]\s*/, ' ');

  // 2. Remove DA codes and PSO codes if written inline on the same line
  s = s.replace(/\b(cf|rf|c)\s*[\-_]?\s*\d{4,6}\b/gi, ' ');
  s = s.replace(/\bpso\s*[\-:=]?\s*[a-z]?\s*\d{2,3}\b/gi, ' ');

  // 3. Remove known product strength/pack tokens so they are never mistaken for quantity
  s = s.replace(/\b(40000|20000|1500)\s*(iu|dots)?\b/gi, ' ');
  s = s.replace(/\b\d+\s*[\*x]\s*\d+\b/gi, ' '); // e.g., 17*30, 6x10, 3x10
  s = s.replace(/\bd\s*3\b/gi, ' '); // Vita D3
  s = s.replace(/\bemcon\s*[\-_]?\s*1\b/gi, 'emcon ');
  s = s.replace(/\b(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5|3)\s*(ml|mg|mcg|gm|g)\b/gi, ' ');

  // Strip bare strength numbers when attached after the brand name AND followed by another number (the actual quantity)
  s = s.replace(/\b(dom[iey]?r[ea]n|deltas[oa]ne?|daltas[oa]ne?|beconex|biconex|zith?r[ie]n|zitrin|lucan\s*[\-]?r?|locan\s*[\-]?r?|lokanar|lunch|furocef|feurocef|p\s*[\-]?ca[bp]|nexdex|protonil|recox|flontin|flustar|algin|fenadin|normanal|pangesic)\s*(?:syp|syr|sry|srp|sarape|tab|tap|cap)?\s*[\-_:=.]*\s*(500|200|150|120|100|90|70|60|50|40|35|30|20|15|10|5)\b(?=.*?\b\d+)/gi, '$1 ');

  // 4. Check for addition expressions like "100+25" (e.g. "Deltasone 50ml 100+25")
  const plusMatch = s.match(/(\d+)\s*\+\s*(\d+)/);
  if (plusMatch) {
    return parseFloat(plusMatch[1]) + parseFloat(plusMatch[2]);
  }

  // 5. Find all remaining numbers in the line; the last number is the ordered quantity
  const numMatches = [...s.matchAll(/(\d+(?:\.\d+)?)/g)];
  if (numMatches.length > 0) {
    const lastNum = parseFloat(numMatches[numMatches.length - 1][1]);
    if (lastNum > 0 && lastNum <= 50000) return lastNum;
  }

  return null;
}

/**
 * Splits a single line if it contains multiple products or multiple variants
 */
function expandLineSegments(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Case A: Same-brand multi-size line like "Deltason 50ml 5 ta 100ml 5 ta"
  const multiSizeMatch = trimmed.match(/^(.*?\b(?:deltas[oa]ne?|dom[iey]?r[ea]n|zith?r[ie]n|beconex|biconex)\b)\s*(\d+\s*ml\s*[\-:=]?\s*\d+\s*(?:ta|pes|pcs|pc|box)?)\s+(\d+\s*ml\s*[\-:=]?\s*\d+.*)$/i);
  if (multiSizeMatch) {
    const brandPrefix = multiSizeMatch[1];
    return [
      `${brandPrefix} ${multiSizeMatch[2]}`,
      `${brandPrefix} ${multiSizeMatch[3]}`
    ];
  }

  // Case B: Comma-separated or period-separated inline multi-product message
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
// 6. DA (DELIVERY ASSISTANT), PSO CODE & PHARMACY RESOLVER
// ============================================================================

const senderContextCache = new Map();

function resolveDAFromMessageAndSender(fullText, senderPhone, senderPushName, senderJid) {
  const cleanText = (fullText || '').toUpperCase();
  const cleanPhone = (senderPhone || '').replace(/\D/g, '');
  const cleanPush = (senderPushName || '').toLowerCase().trim();

  // 1. Check explicit DA ID inside the message text (e.g., CF9054, Cf 4526, RF 20363, C122210, C-122229, C_122230)
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
      name: senderPushName || `DA ${candidateId}`
    };
    if (senderJid) senderContextCache.set(senderJid, customDA);
    return customDA;
  }

  // Check bare 6-digit DA code like "210012"
  const bareMatch = cleanText.match(/\b(2100\d{2}|122\d{3}|055167)\b/);
  if (bareMatch) {
    const candidateId = `C${bareMatch[1]}`;
    const foundBare = DA_MASTER.find((d) => d.daId === candidateId || d.altId === candidateId);
    if (foundBare) {
      if (senderJid) senderContextCache.set(senderJid, { ...foundBare });
      return foundBare;
    }
  }

  // 2. Match by Sender Phone Number
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

  // 3. Match by Sender PushName or Name inside Message Text
  for (const da of DA_MASTER) {
    for (const alias of da.aliases || []) {
      if (alias.length >= 4 && (cleanPush.includes(alias) || fullText.toLowerCase().includes(alias))) {
        if (senderJid) senderContextCache.set(senderJid, { ...da });
        return da;
      }
    }
  }

  // 4. Fallback to cached context for this WhatsApp JID
  if (senderJid && senderContextCache.has(senderJid)) {
    return senderContextCache.get(senderJid);
  }

  // 5. Fallback to sender's WhatsApp display name / phone
  return {
    daId: cleanPhone ? `WA-${cleanPhone.slice(-6)}` : 'UNKNOWN',
    altId: '',
    name: senderPushName || (cleanPhone ? `+${cleanPhone}` : 'Unknown Sender')
  };
}

/**
 * Extracts PSO Code from a line or block (e.g. "Pso E71", "/ G24", "(Q99)", "Pso- 475", "-470")
 */
function extractPSOCode(line) {
  if (!line) return null;
  // Pattern 1: Explicit "pso E71", "pso- 475", "pso: Q79", "pso_G30"
  const psoExplicit = line.match(/\bpso\s*(?:code)?\s*[\-:=_.]?\s*([A-Z]\s*\d{2,3}|\d{3})\b/i);
  if (psoExplicit) {
    return psoExplicit[1].replace(/\s+/g, '').toUpperCase();
  }
  // Pattern 2: Slash or Parenthesis or Dash PSO code on a pharmacy/address line: "/ G24", "(Q99)", "-E75", "-470"
  const slashOrParen = line.match(/(?:\/|\(|,\s*\-|\s\-)\s*([A-TV-Z]\s*\d{2}|345|44\d|45\d|46\d|47\d)\b/i);
  if (slashOrParen) {
    const code = slashOrParen[1].replace(/\s+/g, '').toUpperCase();
    if (!['S16', 'S15', 'S34', 'S72', 'C25', 'C62', 'C82', 'N33', 'N45', 'N47', 'N49', 'T28', 'H34', 'H37', 'H39', 'H88', 'H89'].includes(code)) {
      return code;
    }
  }
  // Pattern 3: Standalone PSO code line (e.g. "E76", "M58", "S79", "475")
  const standalone = line.trim().match(/^([A-Z]\d{2}|345|44\d|45\d|46\d|47\d)$/i);
  if (standalone) {
    return standalone[1].toUpperCase();
  }
  return null;
}

/**
 * Checks if a non-product line looks like a Pharmacy / Medical Hall / Party header
 */
function isPharmacyCandidateLine(line) {
  const clean = line.trim();
  if (!clean || clean.length < 3) return false;
  if (/^(pso|cf|rf|c[\-_]?\d|assalamu|salam|hi|hello|crp\b)/i.test(clean)) return false;
  if (/^(md\s+|ikbal\s+hossain|robiul\s+hossain|dawdul\s+islam|jahid\s+mondol|rezaul\s+haque|rejaul\s+hoque|mizan\b|sharif\b|rakib\b)/i.test(clean) && !/\b(pharmacy|pharma|phy|p\/h|medical|med|hall|mh|m\.h|drug|clinic|hospital|store|corner|center|centre)\b/i.test(clean)) {
    return false;
  }
  if (/\b(pharmacy|pharmechy|pharmecy|pharmicy|pharma|phy|p\/h|medical|medecal|med\s+hall|hall|hal|m\.?h\b|drug|clinic|hospital|medicine|medicen|corner|cornar|center|centre|store|point|paint|nikaton|ph\b)/i.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Full Multi-Party & Multi-Line WhatsApp Order Message Parser
 */
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

  const rawLines = messageText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/<This message was edited>/gi, '').trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { isOrder: false, orders: [], followUpPatch: null };
  }

  const daInfo = resolveDAFromMessageAndSender(messageText, senderPhone, senderPushName, senderJid);

  // Find global PSO code in message if present (used as fallback only if a party block hasn't set its own PSO yet)
  let globalPso = null;
  for (const l of rawLines) {
    const p = extractPSOCode(l);
    if (p) {
      globalPso = p;
      break;
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
            pharmacyName: currentPharmacy || potentialPartyHeader || 'General Party',
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
        currentPharmacy = seg
          .replace(/^\s*\d+\s*[\)\/.]\s*\.*/, '')
          .replace(/\bpso\s*(?:code)?\s*[\-:=_.]?\s*[A-Z0-9]+/gi, '')
          .trim();
      } else if (
        !potentialPartyHeader &&
        seg.length >= 3 &&
        seg.length <= 45 &&
        !/^(cf|rf|c[\-_]?\d|pso\b|\d+$)/i.test(seg)
      ) {
        potentialPartyHeader = seg.replace(/^\s*\d+\s*[\)\/.]\s*\.*/, '').trim();
      }
    }
  }

  // Check if this short message is a Follow-Up Context Patch (e.g. DA sends "C210012" or "S79" right after an order)
  if (parsedItems.length === 0 && rawLines.length <= 2 && messageText.length <= 35) {
    const onlyDaMatch = messageText.toUpperCase().match(/\b(CF|RF|C)\s*[\-_.]?\s*(\d{4,6})\b|\b(2100\d{2}|122\d{3})\b/);
    const onlyPsoMatch = extractPSOCode(messageText);
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

  const finalOrders = parsedItems.map((item, idx) => ({
    orderLineId: `${messageId}_${idx + 1}`,
    whatsappMsgId: messageId,
    date: dateStr,
    time: timeStr,
    daId: daInfo.daId,
    altId: daInfo.altId || '-',
    daName: daInfo.name,
    senderPhone: senderPhone ? `+${senderPhone.replace(/\D/g, '')}` : '-',
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
// 7. GOOGLE SHEETS API & CLOUD PERSISTENCE ENGINE
// ============================================================================
let sheetsClient = null;
let googleAuthReady = false;
let googleAuthError = null;

let botConfig = {
  targetGroupId: process.env.TARGET_GROUP_ID || '',
  targetGroupName: process.env.TARGET_GROUP_NAME || 'CRP sales NK Depot',
  autoReactOnOrder: true,
  updatedAt: null
};

if (fs.existsSync(LOCAL_CONFIG_PATH)) {
  try {
    const saved = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
    botConfig = { ...botConfig, ...saved };
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

async function ensureSpreadsheetStructure() {
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
            'Ordered Qty', 'Unit Price (BDT)', 'Total Amount (BDT)', 'Match Type', 'Status'
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
            'Ordered Qty', 'Unit Price (BDT)', 'Total Amount (BDT)', 'Match Type',
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
          `=IFERROR(INDEX(FILTER(${SHEET_TABS.LIVE_ORDERS}!C:C & " " & ${SHEET_TABS.LIVE_ORDERS}!D:D, ${SHEET_TABS.LIVE_ORDERS}!E:E=B${rowNum}), COUNTIF(${SHEET_TABS.LIVE_ORDERS}!E:E, B${rowNum})), "-")`
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
    const prodRes = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.PRODUCT_SUMMARY}!A1:G100`
    });
    if (!prodRes.data.values || prodRes.data.values.length <= 1) {
      const prodRows = [
        [
          'CRP Code', 'Official Product Name (CRP.xlsx)', 'Pack Unit',
          'Editable Unit Price (BDT)', 'Total Order Lines',
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
    } else {
      syncProductsFromSheetRows(prodRes.data.values);
    }

    return true;
  } catch (err) {
    addLog(`⚠️ Error ensuring spreadsheet structure: ${err.message}`);
    return false;
  }
}

function syncProductsFromSheetRows(rows) {
  if (!rows || rows.length <= 1) return;
  let updatedCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const [code, name, unit, priceStr] = rows[i];
    if (!code || code === 'TOTAL') continue;
    const cleanCode = String(code).trim();
    const cleanPrice = parseFloat(String(priceStr || '').replace(/[^\d.]/g, ''));
    if (isNaN(cleanPrice) || cleanPrice <= 0) continue;

    const existing = activeProducts.find((p) => p.code === cleanCode);
    if (existing) {
      if (existing.price !== cleanPrice) {
        existing.price = cleanPrice;
        updatedCount++;
      }
      if (name) existing.name = String(name).trim();
      if (unit) existing.unit = String(unit).trim();
    } else if (name) {
      const cleanName = String(name).trim();
      activeProducts.push({
        code: cleanCode,
        name: cleanName,
        unit: unit ? String(unit).trim() : 'Pack',
        price: cleanPrice,
        family: cleanName.split(/\s+/)[0].toUpperCase(),
        aliases: [cleanName.toLowerCase(), cleanName.split(/\s+/)[0].toLowerCase()]
      });
      updatedCount++;
    }
  }
  if (updatedCount > 0) {
    addLog(`🔄 Synced ${updatedCount} updated product prices/items from Google Sheet.`);
  }
}

// ============================================================================
// 8. PERMANENT CLOUD SESSION & CONFIG BACKUP IN GOOGLE SHEETS (_Bot_State)
// ============================================================================
let stateBackupTimer = null;

async function backupAuthAndConfigToSheet() {
  if (!sheetsClient || !GOOGLE_SHEET_ID) return;
  try {
    const authFiles = {};
    if (fs.existsSync(AUTH_DIR)) {
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        if (
          file === 'creds.json' ||
          file.startsWith('app-state-sync-key-') ||
          file.startsWith('session-') ||
          file.startsWith('sender-key-')
        ) {
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
      range: `${SHEET_TABS.BOT_STATE}!A1:Z30`
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
      range: `${SHEET_TABS.BOT_STATE}!A1:C30`
    });
    const rows = res.data.values || [];
    let compressedChunks = [];

    for (const row of rows) {
      const [key, val] = row;
      if (key === 'BOT_CONFIG' && val) {
        try {
          const parsedConfig = JSON.parse(val);
          botConfig = { ...botConfig, ...parsedConfig };
          saveLocalConfig();
          addLog(`☁️ Restored saved group config from Google Sheet: "${botConfig.targetGroupName}" (${botConfig.targetGroupId || 'Not set'})`);
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
// 9. GOOGLE SHEETS ORDER CRUD: SAVE, EDIT/REPLACE, UNSEND/DELETE, & PATCH
// ============================================================================
let sheetQueue = Promise.resolve();
function enqueueSheetTask(taskFn) {
  sheetQueue = sheetQueue.then(taskFn).catch((err) => {
    addLog(`❌ Sheet Queue Error: ${err.message}`);
  });
  return sheetQueue;
}

async function appendOrdersToSheet(orders) {
  if (!orders || orders.length === 0) return;
  return enqueueSheetTask(async () => {
    for (const o of orders) {
      recentOrders.unshift(o);
    }
    if (recentOrders.length > 200) recentOrders.length = 200;
    stats.totalOrdersSaved += orders.length;
    stats.totalAmountSaved += orders.reduce((acc, x) => acc + x.totalAmount, 0);

    if (!sheetsClient || !googleAuthReady) {
      addLog(`⚠️ Order parsed locally (${orders.length} items) — waiting for Google Sheets credentials.`);
      return;
    }

    const values = orders.map((o) => [
      o.orderLineId,
      o.whatsappMsgId,
      o.date,
      o.time,
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

    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SHEET_TABS.LIVE_ORDERS}!A:S`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values }
    });

    addLog(`✅ Saved ${orders.length} order line(s) from ${orders[0].daName} (${orders[0].daId}) to Google Sheets.`);
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
    if (removedLocal.length > 0 && reason === 'UNSENT_BY_USER') {
      stats.totalOrdersDeleted += removedLocal.length;
      stats.totalOrdersSaved = Math.max(0, stats.totalOrdersSaved - removedLocal.length);
      const subtracted = removedLocal.reduce((acc, x) => acc + (x.totalAmount || 0), 0);
      stats.totalAmountSaved = Math.max(0, stats.totalAmountSaved - subtracted);
    }

    if (!sheetsClient || !googleAuthReady) {
      if (removedLocal.length > 0) {
        addLog(`🗑️ Removed ${removedLocal.length} unsent order(s) from memory (Msg ID: ${whatsappMsgId}).`);
      }
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
      const rowMsgId = String(rows[r][1] || '').trim();
      if (rowMsgId === String(whatsappMsgId).trim()) {
        matchingZeroBasedIndices.push(r);
        const fullRow = [...rows[r]];
        while (fullRow.length < 18) fullRow.push('');
        fullRow[18] = reason;
        fullRow.push(deletedAt);
        archivedRows.push(fullRow);
      }
    }

    if (matchingZeroBasedIndices.length === 0) return 0;

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
    const cleanPhone = patch.senderPhone ? `+${patch.senderPhone.replace(/\D/g, '')}` : '';
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
// 10. WHATSAPP BAILEYS ENGINE (QR LOGIN, GROUP LIST, ORDER & UNSEND LISTENER)
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
  if (activityLogs.length > 120) activityLogs.length = 120;
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

  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.documentMessage?.caption ||
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    '';

  if (text.trim()) {
    return {
      type: 'TEXT',
      msgId: msg.key.id,
      text: text.trim(),
      remoteJid: msg.key.remoteJid
    };
  }

  return { type: 'IGNORE' };
}

async function refreshJoinedGroups() {
  if (!sock || waStatus !== 'CONNECTED') return [];
  try {
    const groupsObj = await sock.groupFetchAllParticipating();
    joinedGroups = Object.values(groupsObj)
      .map((g) => ({
        id: g.id,
        subject: g.subject || 'Unnamed Group',
        size: (g.participants || []).length
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));

    if (!botConfig.targetGroupId && botConfig.targetGroupName) {
      const autoFound = joinedGroups.find(
        (g) =>
          g.subject.toLowerCase().trim() === botConfig.targetGroupName.toLowerCase().trim() ||
          g.subject.toLowerCase().includes('crp sales')
      );
      if (autoFound) {
        botConfig.targetGroupId = autoFound.id;
        botConfig.targetGroupName = autoFound.subject;
        saveLocalConfig();
        scheduleCloudStateBackup(2000);
        addLog(`🎯 Auto-detected target WhatsApp group: "${autoFound.subject}" (${autoFound.id})`);
      }
    }
    return joinedGroups;
  } catch (err) {
    addLog(`⚠️ Could not fetch group list: ${err.message}`);
    return joinedGroups;
  }
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
          name: sock.user?.name || 'WhatsApp User'
        };
        addLog(`🟢 WhatsApp Connected as ${connectedUser.name} (${connectedUser.id})`);
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
          if (!remoteJid.endsWith('@g.us')) continue;

          if (botConfig.targetGroupId && remoteJid !== botConfig.targetGroupId) {
            continue;
          }

          const inspected = inspectBaileysMessage(msg);
          if (inspected.type === 'IGNORE') continue;

          const senderJid = msg.key.participant || msg.participant || remoteJid;
          const senderPhone = senderJid.split('@')[0].split(':')[0];
          const senderPushName = msg.pushName || '';
          const msgTimestamp = msg.messageTimestamp
            ? Number(msg.messageTimestamp) * 1000
            : Date.now();

          if (inspected.type === 'REVOKE') {
            addLog(`🚨 Unsend/Delete detected in group for Msg ID: ${inspected.targetMsgId}`);
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
              senderJid
            });
            if (parsedEdit.isOrder && parsedEdit.orders.length > 0) {
              await appendOrdersToSheet(parsedEdit.orders);
            }
            continue;
          }

          if (inspected.type === 'TEXT') {
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
          if (!remoteJid.endsWith('@g.us')) continue;
          if (botConfig.targetGroupId && remoteJid !== botConfig.targetGroupId) continue;

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
              const senderPhone = senderJid.split('@')[0].split(':')[0];
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
// 11. EXPRESS WEB SERVER, API ENDPOINTS & INTERACTIVE DASHBOARD UI
// ============================================================================
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
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
    botConfig,
    joinedGroups,
    stats,
    recentOrders: recentOrders.slice(0, 40),
    logs: activityLogs.slice(0, 50),
    productCount: activeProducts.length,
    daCount: DA_MASTER.length
  });
});

app.post('/api/groups/refresh', async (req, res) => {
  const groups = await refreshJoinedGroups();
  res.json({ ok: true, groups });
});

app.post('/api/config/group', async (req, res) => {
  const { groupId, groupName, autoReactOnOrder } = req.body || {};
  if (typeof groupId === 'string') botConfig.targetGroupId = groupId.trim();
  if (typeof groupName === 'string') botConfig.targetGroupName = groupName.trim();
  if (typeof autoReactOnOrder === 'boolean') botConfig.autoReactOnOrder = autoReactOnOrder;
  botConfig.updatedAt = new Date().toISOString();

  saveLocalConfig();
  await backupAuthAndConfigToSheet();
  addLog(`🔒 Target Group locked & saved to cloud: "${botConfig.targetGroupName}" (${botConfig.targetGroupId || 'All/Auto'})`);
  res.json({ ok: true, botConfig });
});

app.post('/api/test-parse', async (req, res) => {
  const { messageText, senderPhone, senderName, saveToSheet, simulateUnsendMsgId } = req.body || {};

  if (simulateUnsendMsgId) {
    const removedCount = await removeOrdersByMessageId(simulateUnsendMsgId, 'UNSENT_BY_USER');
    return res.json({ ok: true, action: 'UNSEND_SIMULATED', removedCount });
  }

  const msgId = `TEST_${Date.now()}`;
  const result = parseWhatsAppOrderMessage({
    messageText: messageText || '',
    messageId: msgId,
    timestamp: new Date(),
    senderPhone: senderPhone || '8801602791043',
    senderPushName: senderName || 'Md Rakib Hossain',
    senderJid: `${senderPhone || '8801602791043'}@s.whatsapp.net`
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
  const ok = await ensureSpreadsheetStructure();
  await backupAuthAndConfigToSheet();
  res.json({ ok, googleAuthReady, googleAuthError, productCount: activeProducts.length });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }
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

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Renata CRP WhatsApp Order Tracker & Auto Google Sheets Sync</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #10b981;
      --accent-hover: #059669;
      --blue: #3b82f6;
      --danger: #ef4444;
      --warn: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 20px;
    }
    .container { max-width: 1240px; margin: 0 auto; }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid var(--border);
      padding: 20px 24px;
      border-radius: 14px;
      margin-bottom: 20px;
    }
    header h1 { font-size: 1.35rem; font-weight: 700; color: #fff; }
    header p { color: var(--muted); font-size: 0.9rem; margin-top: 4px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 600;
    }
    .badge.ok { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
    .badge.warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
    .badge.err { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
    }
    .card h2 {
      font-size: 1.05rem;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    .qr-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: #0b1120;
      border-radius: 12px;
      min-height: 250px;
      text-align: center;
    }
    .qr-box img {
      max-width: 240px;
      border-radius: 10px;
      border: 4px solid #fff;
      margin-bottom: 10px;
    }
    label { display: block; font-size: 0.85rem; color: var(--muted); margin-bottom: 6px; margin-top: 12px; }
    select, input, textarea {
      width: 100%;
      background: #0b1120;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 0.92rem;
    }
    textarea { min-height: 110px; font-family: monospace; resize: vertical; }
    .btn-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    button, .btn-link {
      cursor: pointer;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.88rem;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      transition: 0.15s;
    }
    .btn-primary { background: var(--accent); color: #052e16; }
    .btn-primary:hover { background: var(--accent-hover); color: #fff; }
    .btn-blue { background: var(--blue); color: #fff; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-outline:hover { background: #334155; }
    .btn-danger { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); }
    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--card);
      border: 1px solid var(--border);
      padding: 14px 16px;
      border-radius: 12px;
    }
    .stat-card .lbl { font-size: 0.78rem; color: var(--muted); }
    .stat-card .val { font-size: 1.4rem; font-weight: 700; color: #fff; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    th { background: #0b1120; color: var(--muted); font-weight: 600; }
    .table-wrap { overflow-x: auto; max-height: 360px; overflow-y: auto; }
    .log-box {
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      height: 220px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.8rem;
      color: #cbd5e1;
    }
    .log-box div { padding: 2px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>📦 Renata PLC (NK Depot) — WhatsApp CRP Order Auto-Tracker</h1>
        <p>অটোমেটিক ওয়াটসঅ্যাপ গ্রুপ অর্ডার ট্র্যাকার, বানান সংশোধন (78 CRP Products & 46 DAs) এবং আনসেন্ড (Unsend) অটো-রিমুভ সিস্টেম</p>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <span id="waBadge" class="badge warn">⏳ Checking WhatsApp...</span>
        <span id="sheetBadge" class="badge warn">⏳ Checking Google Sheet...</span>
        <a id="openSheetBtn" href="#" target="_blank" class="btn-link btn-blue">📊 Open Google Sheet</a>
      </div>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <div class="lbl">সক্রিয় টার্গেট গ্রুপ (Target Group)</div>
        <div class="val" id="statGroup" style="font-size:1rem; color:#34d399;">Loading...</div>
      </div>
      <div class="stat-card">
        <div class="lbl">মোট সেভ হওয়া অর্ডার লাইন (Saved Lines)</div>
        <div class="val" id="statSaved">0</div>
      </div>
      <div class="stat-card">
        <div class="lbl">মোট অর্ডারের পরিমাণ (Total BDT)</div>
        <div class="val" id="statAmount">৳0</div>
      </div>
      <div class="stat-card">
        <div class="lbl">আনসেন্ড/ডিলিট রিমুভড (Unsent Removed)</div>
        <div class="val" id="statDeleted" style="color:#f87171;">0</div>
      </div>
      <div class="stat-card">
        <div class="lbl">প্রোডাক্ট ও DA ডাটাবেজ</div>
        <div class="val" id="statMaster" style="font-size:1.05rem;">78 CRP / 46 DAs</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>
          <span>১. WhatsApp কানেকশন (One-Time QR Scan)</span>
          <button class="btn-outline" style="padding:5px 10px; font-size:0.78rem;" onclick="logoutWhatsApp()">Change Account</button>
        </h2>
        <div id="qrContainer" class="qr-box">
          <p style="color:var(--muted);">Loading WhatsApp status...</p>
        </div>
        <p style="font-size:0.8rem; color:var(--muted); margin-top:10px;">
          💡 <b>টিপস:</b> একবার QR কোড স্ক্যান করে লগইন করলে সেশনটি অটোমেটিক আপনার Google Sheet-এর ক্লাউড ব্যাকআপে সেভ হয়ে যায়। ফলে Render রিস্টার্ট নিলেও আর কখনো লগইন করতে হবে না!
        </p>
      </div>

      <div class="card">
        <h2>
          <span>২. WhatsApp গ্রুপ সিলেক্ট করুন (One-Time Setup)</span>
          <button class="btn-outline" style="padding:5px 10px; font-size:0.78rem;" onclick="refreshGroups()">🔄 গ্রুপ লিস্ট রিফ্রেশ</button>
        </h2>

        <label>আপনার জয়েন থাকা WhatsApp গ্রুপগুলো থেকে সিলেক্ট করুন:</label>
        <select id="groupSelect" onchange="onGroupDropdownChange()">
          <option value="">-- সব গ্রুপ / নিচের বক্সে গ্রুপের নাম বা ID দিন --</option>
        </select>

        <label>অথবা গ্রুপের নাম / Group JID (অটো সেভ থাকবে):</label>
        <input type="text" id="targetGroupNameInput" placeholder="e.g. CRP sales NK Depot" />
        <input type="hidden" id="targetGroupIdInput" />

        <label style="display:flex; align-items:center; gap:8px; margin-top:14px; cursor:pointer; color:#e2e8f0;">
          <input type="checkbox" id="autoReactCheckbox" style="width:18px; height:18px;" checked />
          অর্ডার সেভ হলে মেসেজে অটোমেটিক ✅ রিয়েকশন দিবে
        </label>

        <div class="btn-row">
          <button class="btn-primary" onclick="saveGroupConfig()">💾 Save & Lock Group Permanently</button>
          <button class="btn-outline" onclick="syncSheetStructure()">📊 Verify / Sync Sheet Tabs</button>
        </div>
        <p id="saveStatusMsg" style="font-size:0.83rem; color:#34d399; margin-top:10px;"></p>
      </div>

      <div class="card">
        <h2>🧪 ৩. লাইভ অর্ডার ও ভুল বানান টেস্টার (Simulator)</h2>
        <label>যেকোনো ভুল বানানের অর্ডার মেসেজ লিখে টেস্ট করুন:</label>
        <textarea id="testInput">Cf 4526 Seraj
Nipun pharmacy pso code E 71
TotiFen 50
Doxicup 10 pes
Deltason 50ml 20 ta
Locan r 150mg = 10</textarea>
        <div class="btn-row">
          <button class="btn-blue" onclick="runTestParse(false)">🔍 Test Spell-Checker Only</button>
          <button class="btn-primary" onclick="runTestParse(true)">🚀 Test & Save to Google Sheet</button>
          <button id="simUnsendBtn" class="btn-danger" style="display:none;" onclick="simulateUnsend()">🗑️ Simulate Unsend (Remove Last Test)</button>
        </div>
        <div id="testResultBox" style="margin-top:12px; font-size:0.82rem; color:#cbd5e1;"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <h2>📋 সর্বশেষ ট্র্যাক হওয়া অর্ডারসমূহ (Live Parsed Orders)</h2>
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
              <th>Unit Price</th>
              <th>Total (BDT)</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody id="ordersTableBody">
            <tr><td colspan="10" style="text-align:center; color:var(--muted);">No orders recorded in this session yet.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>🖥️ সিস্টেম লগ (Live Server Logs)</h2>
      <div id="logBox" class="log-box"></div>
    </div>
  </div>

  <script>
    let lastTestMsgId = null;
    let groupInputTouched = false;

    document.getElementById('targetGroupNameInput').addEventListener('input', () => {
      groupInputTouched = true;
    });

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
          sheetBadge.textContent = '🟢 Google Sheet Connected';
        } else {
          sheetBadge.className = 'badge err';
          sheetBadge.textContent = '⚠️ Sheet Auth Needed';
        }

        document.getElementById('openSheetBtn').href = data.googleSheetUrl;

        document.getElementById('statGroup').textContent =
          data.botConfig.targetGroupName || data.botConfig.targetGroupId || 'All Groups';
        document.getElementById('statSaved').textContent = data.stats.totalOrdersSaved;
        document.getElementById('statAmount').textContent =
          '৳' + Number(data.stats.totalAmountSaved || 0).toLocaleString('en-BD');
        document.getElementById('statDeleted').textContent = data.stats.totalOrdersDeleted;
        document.getElementById('statMaster').textContent =
          data.productCount + ' CRP / ' + data.daCount + ' DAs';

        const qrBox = document.getElementById('qrContainer');
        if (data.waStatus === 'CONNECTED' && data.connectedUser) {
          qrBox.innerHTML =
            '<div style="font-size:2.6rem; margin-bottom:8px;">✅</div>' +
            '<h3 style="color:#34d399;">WhatsApp সচল এবং লগইন সেভ করা আছে!</h3>' +
            '<p style="color:#94a3b8; font-size:0.88rem; margin-top:6px;">Account: <b>' +
            data.connectedUser.name +
            '</b> (' +
            data.connectedUser.id.split(':')[0] +
            ')</p>' +
            '<span class="badge ok" style="margin-top:12px;">☁️ Auto-Saved in Cloud Backup</span>';
        } else if (data.qrDataUrl) {
          qrBox.innerHTML =
            '<img src="' +
            data.qrDataUrl +
            '" alt="WhatsApp QR Code" />' +
            '<p style="color:#fbbf24; font-weight:600; font-size:0.9rem;">আপনার ফোনের WhatsApp ➔ Linked Devices থেকে এই QR কোডটি স্ক্যান করুন</p>';
        } else {
          qrBox.innerHTML =
            '<p style="color:#94a3b8;">🔄 WhatsApp কানেক্ট হচ্ছে / QR তৈরি হচ্ছে... অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করুন।</p>';
        }

        const select = document.getElementById('groupSelect');
        if (data.joinedGroups && data.joinedGroups.length > 0 && select.options.length <= 1) {
          select.innerHTML = '<option value="">-- গ্রুপ সিলেক্ট করুন --</option>';
          data.joinedGroups.forEach((g) => {
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
                '<td>' + o.date + ' ' + o.time + '</td>' +
                '<td><b>' + o.daId + '</b><br/><span style="color:#94a3b8;">' + o.daName + '</span></td>' +
                '<td>' + o.psoCode + '</td>' +
                '<td>' + o.pharmacyName + '</td>' +
                '<td style="color:#fbbf24;">' + o.rawText + '</td>' +
                '<td><b>[' + o.crpCode + ']</b> ' + o.productName + '</td>' +
                '<td><b>' + o.orderedQty + '</b></td>' +
                '<td>৳' + o.unitPrice + '</td>' +
                '<td style="color:#34d399; font-weight:700;">৳' + Number(o.totalAmount).toLocaleString('en-BD') + '</td>' +
                '<td>' + o.matchType + '</td>' +
                '</tr>'
            )
            .join('');
        }

        const logBox = document.getElementById('logBox');
        logBox.innerHTML = (data.logs || []).map((l) => '<div>' + l + '</div>').join('');
      } catch (e) {}
    }

    function onGroupDropdownChange() {
      const sel = document.getElementById('groupSelect');
      const opt = sel.options[sel.selectedIndex];
      if (opt && opt.value) {
        groupInputTouched = true;
        document.getElementById('targetGroupIdInput').value = opt.value;
        document.getElementById('targetGroupNameInput').value = opt.dataset.name || '';
      }
    }

    async function refreshGroups() {
      const res = await fetch('/api/groups/refresh', { method: 'POST' });
      const data = await res.json();
      const select = document.getElementById('groupSelect');
      select.innerHTML = '<option value="">-- গ্রুপ সিলেক্ট করুন --</option>';
      (data.groups || []).forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.dataset.name = g.subject;
        opt.textContent = g.subject + ' (' + g.size + ' members)';
        select.appendChild(opt);
      });
      alert('গ্রুপ লিস্ট আপডেট হয়েছে! মোট গ্রুপ: ' + (data.groups || []).length);
    }

    async function saveGroupConfig() {
      const groupId = document.getElementById('targetGroupIdInput').value;
      const groupName = document.getElementById('targetGroupNameInput').value;
      const autoReactOnOrder = document.getElementById('autoReactCheckbox').checked;

      const res = await fetch('/api/config/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, groupName, autoReactOnOrder })
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('saveStatusMsg').textContent =
          '✅ গ্রুপ সেটিংস স্থায়ীভাবে সেভ হয়েছে: ' + (data.botConfig.targetGroupName || 'All');
        groupInputTouched = false;
        fetchStatus();
      }
    }

    async function syncSheetStructure() {
      const res = await fetch('/api/sheets/sync', { method: 'POST' });
      const data = await res.json();
      alert(data.ok ? '✅ Google Sheet-এর সব ট্যাব এবং ফর্মুলা সফলভাবে সিঙ্ক হয়েছে!' : '⚠️ Error: ' + data.googleAuthError);
      fetchStatus();
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
          '<div style="color:#34d399; font-weight:600; margin-bottom:6px;">✅ শনাক্ত হয়েছে ' +
          data.orders.length +
          'টি প্রোডাক্ট অর্ডার (DA: ' +
          data.orders[0].daId +
          ' - ' +
          data.orders[0].daName +
          '):</div>' +
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
                '</b> | Total: <b>৳' +
                o.totalAmount +
                '</b> (' +
                o.matchType +
                ')'
            )
            .join('<br/>');
      } else {
        box.innerHTML = '<span style="color:#f87171;">⚠️ কোনো CRP প্রোডাক্ট অর্ডার পাওয়া যায়নি।</span>';
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
        '<span style="color:#f87171; font-weight:600;">🗑️ আনসেন্ড সিমুলেশন সফল! মেসেজ (' +
        lastTestMsgId +
        ') এর ' +
        data.removedCount +
        'টি অর্ডার ডাটাবেজ ও Google Sheet থেকে অটোমেটিক রিমুভ করা হয়েছে!</span>';
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
// 12. RENDER FREE-TIER SELF-PING KEEP-ALIVE & SERVER BOOTSTRAP
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
    addLog(`🚀 Server listening on port ${PORT}`);
    await initGoogleSheetsClient();
    if (googleAuthReady) {
      await ensureSpreadsheetStructure();
      await restoreAuthAndConfigFromSheet();
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
  matchCRPProduct,
  extractOrderQuantity,
  parseWhatsAppOrderMessage,
  inspectBaileysMessage
};