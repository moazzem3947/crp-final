/**
 * ============================================================================
 * RENATA PLC (NOAKHALI DEPOT) — WHATSAPP GROUP CRP ORDER TRACKER (v3.0 PRO)
 * ============================================================================
 * What's New in v3.0:
 * 1. Exact TRADE PRICE for all 78+ CRP Products from "Current Pricie List (30-10-26).xlsx"
 *    + Auto-migration of existing Google Sheet Product_Wise_Summary & Live_Orders prices!
 * 2. Handwritten / Paper Photo Order OCR (Image-to-Order) strictly restricted to:
 *    -> +8801732273944 and +8801793362829 ONLY (ignores images from all other numbers)
 * 3. Instant WhatsApp Order Confirmation Reply on Image Orders + "/cnl" Cancel System:
 *    -> Saves order to Google Sheet & replies with full itemized breakdown.
 *    -> If user replies "/cnl" to that message, it immediately cancels & deletes the order
 *       from Google Sheets! If anything else (or nothing) is replied, it stays saved.
 * 4. Manual "Clear Live Orders" & "Clear Server Logs" buttons on Dashboard to keep
 *    Render Free-Tier RAM/storage ultra-lightweight.
 * 5. Enhanced Baileys @lid -> Phone Number resolver & clean "Cus name:" party parser.
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
  { code: '922', name: "PRAZOLE 20MG CAP 6X10'S", unit: "Box (6x10's)", price: 225.00, family: 'PRAZOLE', aliases: ['prazole', 'prazol', 'parzol', 'prajol', 'frazol', 'prazole 20mg', 'prazol cap'] },
  { code: '271', name: 'ZITHRIN DRY SYRUP 35ML', unit: 'Bottle (35ml)', price: 104.95, family: 'ZITHRIN', aliases: ['zithrin 35ml', 'zitrin 35ml', 'zithrin 35', 'zitrin 35', 'zitthrin', 'zithren', 'zithrin dry syrup', 'zithrin syp', 'zithrin syr'] },
  { code: '290', name: 'ZITHRIN DRY SYRUP 50ML', unit: 'Bottle (50ml)', price: 149.93, family: 'ZITHRIN', aliases: ['zithrin 50ml', 'zitrin 50ml', 'zithrin 50', 'zitrin 50', 'zrithrin 50ml'] },
  { code: '270', name: 'ZITHRIN DRY SYRUP 20ML', unit: 'Bottle (20ml)', price: 74.96, family: 'ZITHRIN', aliases: ['zithrin 20ml', 'zitrin 20ml', 'zithirin 20ml', 'zithrin 20'] },
  { code: '173', name: 'ZITHRIN DRY SYRUP 15ML', unit: 'Bottle (15ml)', price: 71.21, family: 'ZITHRIN', aliases: ['zithrin 15ml', 'ziyhrin 15ml', 'zithrin 15'] },
  { code: '834', name: "ZITHRIN 30ML SUSPENSION 1'S", unit: 'Bottle (30ml)', price: 103.45, family: 'ZITHRIN', aliases: ['zithrin 30ml', 'zitrin 30ml', 'zithrin 30'] },
  { code: '278', name: "XAMIC 500MG CAP (2X10'S)", unit: "Box (2x10's)", price: 329.80, family: 'XAMIC', aliases: ['xamic', 'xamic cap', 'xamic 500mg', 'xamic capsule', 'xmaic', 'examic'] },
  { code: '635', name: "RECOF 100ML SYRUP 1X1'S", unit: 'Bottle (100ml)', price: 29.99, family: 'RECOF', aliases: ['recof', 'recop', 'recof syp', 'recof syr', 'recof sry', 'recof 100ml', 'recof syraf'] },
  { code: '299', name: "TRULAX SYRUP 1MG/5ML 100ML 1'S", unit: 'Bottle (100ml)', price: 33.73, family: 'TRULAX', aliases: ['trulax', 'tulax', 'trulex', 'trulax syr', 'trulax syp', 'trulax sry', 'trulax 100ml'] },
  { code: '112', name: 'LUCAN-R SUSP. 35ML', unit: 'Bottle (35ml)', price: 58.70, family: 'LUCAN-R', aliases: ['lucan r 35ml', 'lucan-r 35ml', 'locan r sry', 'lucan r syp', 'lucan r syr', 'lukan r syp', 'luknar syraf', 'lokanar', 'lucon r syp', 'lucanar syp', 'lucar sry'] },
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
  { daId: 'CF10145', altId: '', name: 'Moajjem', phones: ['8801732273944', '8801793362829'], aliases: ['moajjem', 'moazzem'] }
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
    'cus', 'name', 'customer', 'party'
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

function extractOrderQuantity(rawLine, matchedProduct) {
  let s = rawLine;
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
const lidToPhoneMap = new Map(); // Maps WhatsApp @lid IDs -> normalized 8801XXXXXXXXX phone numbers

/**
 * Normalizes any phone number string to 8801XXXXXXXXX format if it's a valid BD number
 */
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

/**
 * Resolves the real phone number of a WhatsApp message sender (even when group uses @lid)
 */
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

  // If message was sent from the connected bot phone itself
  if (msg.key?.fromMe && connectedUser?.id) {
    candidatos.unshift(connectedUser.id);
  }

  for (const c of candidatos) {
    if (!c) continue;
    const rawId = String(c).split('@')[0].split(':')[0];
    if (String(c).endsWith('@lid') && lidToPhoneMap.has(rawId)) {
      return lidToPhoneMap.get(rawId);
    }
    const norm = normalizeBdPhone(rawId);
    if (norm.length === 13 && norm.startsWith('8801')) {
      // Also record in lidToPhoneMap if msg.key.participant was an @lid
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
 * Checks if a message was sent by one of the two strictly authorized Image Order numbers:
 * +8801732273944 or +8801793362829
 */
function isAuthorizedForImageOrder(msg, resolvedPhone) {
  const norm = normalizeBdPhone(resolvedPhone);
  for (const authPhone of AUTHORIZED_IMAGE_PHONES) {
    if (norm === authPhone || norm.endsWith(authPhone.slice(-10))) {
      return true;
    }
  }
  // Also check if the raw participant LID was explicitly bound to one of the 2 authorized numbers
  const rawParticipant = (msg?.key?.participant || msg?.key?.remoteJid || '').split('@')[0].split(':')[0];
  if (rawParticipant && botConfig.authorizedImageLids && botConfig.authorizedImageLids.includes(rawParticipant)) {
    return true;
  }
  return false;
}

function resolveDAFromMessageAndSender(fullText, senderPhone, senderPushName, senderJid) {
  const cleanText = (fullText || '').toUpperCase();
  const cleanPhone = normalizeBdPhone(senderPhone);
  const cleanPush = (senderPushName || '').toLowerCase().trim();

  // 1. Explicit DA ID inside message text
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

  // 4. Fallback to cached context
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
  // Support "Cus:", "Cus name:", "Customer:", "Party:" prefixes used in live orders
  if (/^(cus|customer|party)\s*(?:name)?\s*[\-:=]/i.test(clean)) return true;
  if (/^(md\s+|ikbal\s+hossain|robiul\s+hossain|dawdul\s+islam|jahid\s+mondol|rezaul\s+haque|rejaul\s+hoque|mizan\b|sharif\b|rakib\b)/i.test(clean) && !/\b(pharmacy|pharma|phy|p\/h|medical|med|hall|mh|m\.h|drug|clinic|hospital|store|corner|center|centre)\b/i.test(clean)) {
    return false;
  }
  if (/\b(pharmacy|pharmechy|pharmecy|pharmicy|pharma|phy|p\/h|medical|medecal|med\s+hall|hall|hal|m\.?h\b|drug|clinic|hospital|medicine|medicen|corner|cornar|center|centre|store|point|paint|nikaton|ph\b)/i.test(clean)) {
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

  const rawLines = messageText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/<This message was edited>/gi, '').trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { isOrder: false, orders: [], followUpPatch: null };
  }

  const daInfo = resolveDAFromMessageAndSender(messageText, senderPhone, senderPushName, senderJid);

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

  // Prefer real BD phone number (from senderPhone or DA_MASTER) over raw @lid digits
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
// 7. HANDWRITTEN / PAPER PHOTO OCR ENGINE (GEMINI VISION + OCR.SPACE FALLBACK)
// ============================================================================

/**
 * Extracts text from a handwritten or printed order photo buffer.
 * Supports:
 * 1. Google Gemini Flash Vision API (if GEMINI_API_KEY is set in Env or Web Dashboard - 100% Free Tier, highest handwriting accuracy)
 * 2. Built-in OCR.space Engine 2 API (works out-of-the-box with zero config for camera/handwritten/printed text)
 */
async function extractTextFromOrderImage(imageBuffer, mimeType = 'image/jpeg') {
  const base64Image = imageBuffer.toString('base64');
  const geminiKey = (botConfig.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();

  // Engine 1: Google Gemini Vision API (Best for Handwritten Paper Orders)
  if (geminiKey) {
    const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    const productNamesHint = activeProducts.map((p) => `${p.name} (${p.code})`).join(', ');
    const promptText =
      'You are an expert OCR system for Renata PLC Bangladesh pharmaceutical order sheets. ' +
      'Read this handwritten or printed order photo and output ONLY the plain text lines exactly as structured for order parsing: ' +
      'Include any DA Code (like CF9054, RF20363, C122210), DA Name, Pharmacy/Customer Name, PSO Code (like PSO E71, G24, 450), ' +
      'and every Product Name with its ordered Quantity (one product per line, e.g. "Totifen 100ml 50", "Doxicap 10"). ' +
      `Known official products include: ${productNamesHint}. ` +
      'Do NOT add markdown formatting or commentary—output only the raw extracted order lines.';

    for (const modelName of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const response = await fetch(url, {
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
        });
        const data = await response.json();
        const extracted = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim();
        if (extracted) {
          addLog(`📸 Image OCR (Gemini Vision ${modelName}) extracted ${extracted.split('\n').length} line(s).`);
          return { text: extracted, engine: `Gemini Vision (${modelName})` };
        }
      } catch (err) {
        addLog(`⚠️ Gemini Vision (${modelName}) warning: ${err.message}`);
      }
    }
  }

  // Engine 2: Built-in Zero-Config OCR.space Engine 2 (supports handwriting & camera photos)
  try {
    const ocrKey = (process.env.OCR_SPACE_API_KEY || 'helloworld').trim();
    const formBody = new URLSearchParams();
    formBody.append('apikey', ocrKey);
    formBody.append('base64Image', `data:${mimeType};base64,${base64Image}`);
    formBody.append('language', 'eng');
    formBody.append('isOverlayRequired', 'false');
    formBody.append('OCREngine', '2'); // Engine 2 is specialized for handwritten & weird fonts/camera photos
    formBody.append('scale', 'true');
    formBody.append('isTable', 'true');

    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString()
    });
    const json = await res.json();
    const parsedText = (json?.ParsedResults || [])
      .map((r) => r.ParsedText || '')
      .join('\n')
      .trim();

    if (parsedText) {
      addLog(`📸 Image OCR (Cloud Engine 2) extracted ${parsedText.split('\n').length} line(s).`);
      return { text: parsedText, engine: 'Cloud OCR Engine 2' };
    }
  } catch (err) {
    addLog(`⚠️ Cloud OCR Engine 2 error: ${err.message}`);
  }

  return { text: '', engine: 'None' };
}

/**
 * Formats the WhatsApp confirmation reply message sent after saving an image order
 */
function buildImageOrderReplyMessage(orders, ocrEngine) {
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
  authorizedImageLids: [],
  priceVersion: 'TRADE_PRICE_2026_10_30',
  updatedAt: null
};

// Map of Bot Reply Message ID (and Original Image Msg ID) -> Order WhatsApp Msg ID for "/cnl" cancellation
const cancellableOrderMap = new Map();
const lastOrderBySenderMap = new Map();

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

/**
 * Ensures all 5 tabs exist and upgrades Product_Wise_Summary & Live_Orders to official TRADE PRICE
 */
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

    // 4. Product_Wise_Summary Tab — Write Official TRADE PRICE from Current Pricie List (30-10-26).xlsx
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

      // Also migrate any existing rows in Live_Orders to the new TRADE PRICE!
      await migrateExistingLiveOrdersToTradePrice();
    }

    return true;
  } catch (err) {
    addLog(`⚠️ Error ensuring spreadsheet structure: ${err.message}`);
    return false;
  }
}

/**
 * Updates any existing rows in Live_Orders so their Unit Price & Total Amount reflect the new TRADE PRICE
 */
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
          addLog(`☁️ Restored saved group config from Google Sheet: "${botConfig.targetGroupName}"`);
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
// 10. GOOGLE SHEETS ORDER CRUD: SAVE, EDIT/REPLACE, UNSEND/DELETE, & /CNL
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
    // Keep memory footprint small on Render Free Tier (max 50 items in RAM)
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
      `'${o.date}`, // Leading apostrophe prevents Google Sheets serial number conversion
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
    if (removedLocal.length > 0 && (reason === 'UNSENT_BY_USER' || reason === 'CANCELLED_BY_CNL')) {
      stats.totalOrdersDeleted += removedLocal.length;
      stats.totalOrdersSaved = Math.max(0, stats.totalOrdersSaved - removedLocal.length);
      const subtracted = removedLocal.reduce((acc, x) => acc + (x.totalAmount || 0), 0);
      stats.totalAmountSaved = Number(Math.max(0, stats.totalAmountSaved - subtracted).toFixed(2));
    }

    if (!sheetsClient || !googleAuthReady) {
      if (removedLocal.length > 0) {
        addLog(`🗑️ Removed ${removedLocal.length} order(s) from memory (${reason}, Msg ID: ${whatsappMsgId}).`);
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
// 11. WHATSAPP BAILEYS ENGINE (QR, GROUP, IMAGE OCR, /CNL CANCEL & UNSEND)
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
  // Keep max 60 logs in memory so Render Free Tier RAM stays minimal
  if (activityLogs.length > 60) activityLogs.length = 60;
}

/**
 * Inspects a Baileys WAMessage for REVOKE (unsend), EDIT, IMAGE, or TEXT (including quoted /cnl replies)
 */
function inspectBaileysMessage(msg) {
  if (!msg || !msg.message) return { type: 'IGNORE' };

  const m = msg.message;

  // 1. Unsend / Delete for Everyone (REVOKE)
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

  // 2. Edited Message
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

  // 3. Image Message (Handwritten / Paper Order Photo)
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

  // 4. Standard Text or Quoted Reply Message
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

/**
 * Harvests participant @lid -> Phone Number mappings from group metadata
 */
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

    // Listen for New Messages, Image Orders, "/cnl" Replies, Edited Messages, and Unsend Events
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        try {
          const remoteJid = msg.key?.remoteJid || '';
          if (!remoteJid || remoteJid === 'status@broadcast') continue;

          const isGroup = remoteJid.endsWith('@g.us');
          // For group messages, only listen to the configured target group
          if (isGroup && botConfig.targetGroupId && remoteJid !== botConfig.targetGroupId) {
            continue;
          }

          const inspected = inspectBaileysMessage(msg);
          if (inspected.type === 'IGNORE') continue;

          const senderJid = msg.key.participant || msg.participant || remoteJid;
          const rawSenderId = senderJid.split('@')[0].split(':')[0];
          let senderPhone = resolveRealSenderPhone(msg);
          const senderPushName = msg.pushName || '';
          const msgTimestamp = msg.messageTimestamp
            ? Number(msg.messageTimestamp) * 1000
            : Date.now();

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

          // CASE 3: Handwritten / Paper Image Order (Strictly restricted to +8801732273944 & +8801793362829)
          if (inspected.type === 'IMAGE') {
            // If senderPhone is still an unmapped @lid in a group, fetch groupMetadata on the spot
            if (!senderPhone.startsWith('8801') && isGroup && sock) {
              try {
                const gMeta = await sock.groupMetadata(remoteJid);
                harvestLidMappingsFromGroups([gMeta]);
                senderPhone = resolveRealSenderPhone(msg);
              } catch (e) {}
            }

            if (!isAuthorizedForImageOrder(msg, senderPhone)) {
              addLog(
                `⛔ Ignored image from unauthorized sender (${senderPhone || rawSenderId} / ${senderPushName}). Only +8801732273944 & +8801793362829 are allowed.`
              );
              continue;
            }

            addLog(`📸 Authorized image received from +${senderPhone || rawSenderId}. Running OCR...`);
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

            const ocrResult = await extractTextFromOrderImage(imageBuffer, inspected.mimeType);
            imageBuffer = null; // Free buffer immediately for Render memory safety

            const combinedText = [inspected.caption, ocrResult.text].filter(Boolean).join('\n').trim();
            if (!combinedText) {
              addLog('⚠️ Image OCR returned empty text.');
              if (sock) {
                try {
                  await sock.sendMessage(
                    remoteJid,
                    { text: '⚠️ ছবির লেখাটি পড়া যায়নি। অনুগ্রহ করে পরিষ্কার আলোতে ছবি তুলে আবার পাঠান।' },
                    { quoted: msg }
                  );
                } catch (e) {}
              }
              continue;
            }

            const parsedImgOrder = parseWhatsAppOrderMessage({
              messageText: combinedText,
              messageId: inspected.msgId,
              timestamp: msgTimestamp,
              senderPhone,
              senderPushName,
              senderJid
            });

            if (parsedImgOrder.isOrder && parsedImgOrder.orders.length > 0) {
              // 1. Save immediately to Google Sheets
              await appendOrdersToSheet(parsedImgOrder.orders);

              // 2. Register message ID for "/cnl" cancellation
              cancellableOrderMap.set(inspected.msgId, inspected.msgId);
              lastOrderBySenderMap.set(rawSenderId, inspected.msgId);
              if (senderPhone) lastOrderBySenderMap.set(senderPhone, inspected.msgId);

              // 3. Send detailed confirmation reply with "/cnl" instruction
              const replyText = buildImageOrderReplyMessage(parsedImgOrder.orders, ocrResult.engine);
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
              addLog(`⚠️ No valid CRP products found in OCR text: "${combinedText.replace(/\n/g, ' | ')}"`);
              if (sock) {
                try {
                  await sock.sendMessage(
                    remoteJid,
                    {
                      text: `⚠️ ছবি থেকে কোনো CRP প্রোডাক্টের অর্ডার শনাক্ত করা যায়নি।\n\n*শনাক্তকৃত লেখা:*\n${combinedText.slice(0, 300)}`
                    },
                    { quoted: msg }
                  );
                } catch (e) {}
              }
            }
            continue;
          }

          // CASE 4: Text Messages (Check for "/cnl" Cancel Reply OR "/bind" OR Standard Text Order)
          if (inspected.type === 'TEXT') {
            // Skip bot's own confirmation replies so it doesn't re-parse its own confirmation text!
            if (
              inspected.text.includes('ছবি থেকে অর্ডারটি Google Sheet-এ সেভ হয়েছে!') ||
              inspected.text.includes('অর্ডারটি বাতিল (/cnl) করা হয়েছে!')
            ) {
              continue;
            }

            // A. Check if user is binding their LID to one of the two authorized image phone numbers: "/bind 01732273944"
            const bindMatch = inspected.text.match(/^\/bind\s+(\+?\d{11,13})$/i);
            if (bindMatch) {
              const targetPh = normalizeBdPhone(bindMatch[1]);
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
                      { text: `✅ আপনার অ্যাকাউন্টটি (+${targetPh}) ছবির অর্ডারের জন্য সফলভাবে যুক্ত হয়েছে!` },
                      { quoted: msg }
                    );
                  } catch (e) {}
                }
              }
              continue;
            }

            // B. Check if message is "/cnl" (Cancel Command)
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

            // C. Standard Text Order (only from target group)
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
          if (remoteJid.endsWith('@g.us') && botConfig.targetGroupId && remoteJid !== botConfig.targetGroupId) {
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
// 12. EXPRESS WEB SERVER, CLEAR LOGS/ORDERS API & DASHBOARD UI
// ============================================================================
const app = express();
app.use(express.json({ limit: '5mb' }));

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

// Clear Live Parsed Orders from Render Memory (saves RAM without deleting Google Sheet data)
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

// Clear Live Server Logs from Render Memory
app.post('/api/logs/clear', (req, res) => {
  activityLogs.length = 0;
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
  addLog('🧹 Server logs cleared manually to free memory.');
  res.json({ ok: true, memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) });
});

app.post('/api/groups/refresh', async (req, res) => {
  const groups = await refreshJoinedGroups();
  res.json({ ok: true, groups });
});

app.post('/api/config/group', async (req, res) => {
  const { groupId, groupName, autoReactOnOrder, geminiApiKey } = req.body || {};
  if (typeof groupId === 'string') botConfig.targetGroupId = groupId.trim();
  if (typeof groupName === 'string') botConfig.targetGroupName = groupName.trim();
  if (typeof autoReactOnOrder === 'boolean') botConfig.autoReactOnOrder = autoReactOnOrder;
  if (typeof geminiApiKey === 'string' && geminiApiKey.trim()) {
    botConfig.geminiApiKey = geminiApiKey.trim();
  }
  botConfig.updatedAt = new Date().toISOString();

  saveLocalConfig();
  await backupAuthAndConfigToSheet();
  addLog(`🔒 Settings saved to cloud: Group="${botConfig.targetGroupName}"`);
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

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Renata CRP WhatsApp Order Tracker v3.0 (Trade Price + Image OCR)</title>
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
    .container { max-width: 1260px; margin: 0 auto; }
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
    header h1 { font-size: 1.3rem; font-weight: 700; color: #fff; }
    header p { color: var(--muted); font-size: 0.88rem; margin-top: 4px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 13px;
      border-radius: 999px;
      font-size: 0.8rem;
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
      font-size: 1.02rem;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
      gap: 8px;
      flex-wrap: wrap;
    }
    .qr-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: #0b1120;
      border-radius: 12px;
      min-height: 240px;
      text-align: center;
    }
    .qr-box img {
      max-width: 230px;
      border-radius: 10px;
      border: 4px solid #fff;
      margin-bottom: 10px;
    }
    label { display: block; font-size: 0.83rem; color: var(--muted); margin-bottom: 5px; margin-top: 10px; }
    select, input, textarea {
      width: 100%;
      background: #0b1120;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 9px 12px;
      border-radius: 8px;
      font-size: 0.9rem;
    }
    textarea { min-height: 105px; font-family: monospace; resize: vertical; }
    .btn-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    button, .btn-link {
      cursor: pointer;
      border: none;
      padding: 9px 14px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
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
    .btn-danger:hover { background: rgba(239, 68, 68, 0.35); color: #fff; }
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
    .stat-card .lbl { font-size: 0.76rem; color: var(--muted); }
    .stat-card .val { font-size: 1.35rem; font-weight: 700; color: #fff; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
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
        <h1>📦 Renata PLC (NK Depot) — WhatsApp CRP Order Tracker v3.0</h1>
        <p>অফিশিয়াল Trade Price (30-10-26), হাতে লেখা ছবির অর্ডার (OCR) + <b>/cnl</b> ক্যান্সেল সিস্টেম এবং মেমোরি ক্লিয়ার কন্ট্রোল প্যানেল</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <span id="waBadge" class="badge warn">⏳ Checking WhatsApp...</span>
        <span id="sheetBadge" class="badge warn">⏳ Checking Sheet...</span>
        <span id="ramBadge" class="badge ok">⚡ RAM: -- MB</span>
        <a id="openSheetBtn" href="#" target="_blank" class="btn-link btn-blue">📊 Open Google Sheet</a>
      </div>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <div class="lbl">সক্রিয় টার্গেট গ্রুপ (Target Group)</div>
        <div class="val" id="statGroup" style="font-size:0.95rem; color:#34d399;">Loading...</div>
      </div>
      <div class="stat-card">
        <div class="lbl">মোট সেভ হওয়া অর্ডার লাইন (Saved)</div>
        <div class="val" id="statSaved">0</div>
      </div>
      <div class="stat-card">
        <div class="lbl">মোট অর্ডার (Trade Price BDT)</div>
        <div class="val" id="statAmount">৳0</div>
      </div>
      <div class="stat-card">
        <div class="lbl">আনসেন্ড / /cnl রিমুভড</div>
        <div class="val" id="statDeleted" style="color:#f87171;">0</div>
      </div>
      <div class="stat-card">
        <div class="lbl">ছবির অর্ডার অনুমোদিত নম্বর</div>
        <div class="val" style="font-size:0.82rem; color:#fbbf24;">+8801732273944<br/>+8801793362829</div>
      </div>
    </div>

    <div class="grid">
      <!-- STEP 1: WHATSAPP LOGIN -->
      <div class="card">
        <h2>
          <span>১. WhatsApp কানেকশন (Auto-Saved)</span>
          <button class="btn-outline" style="padding:5px 10px; font-size:0.76rem;" onclick="logoutWhatsApp()">Change Account</button>
        </h2>
        <div id="qrContainer" class="qr-box">
          <p style="color:var(--muted);">Loading WhatsApp status...</p>
        </div>
        <p style="font-size:0.78rem; color:var(--muted); margin-top:10px;">
          💡 <b>নোট:</b> খাতায় লিখে ছবি তুলে অর্ডার দেওয়ার জন্য <b>+8801732273944</b> এবং <b>+8801793362829</b> নম্বর দুটি লক করা আছে। অর্ডার সেভ হওয়ার পর বটের মেসেজে <b>/cnl</b> রিপ্লাই দিলে সেটি বাতিল হয়ে যাবে।
        </p>
      </div>

      <!-- STEP 2: GROUP & IMAGE OCR SETTINGS -->
      <div class="card">
        <h2>
          <span>২. গ্রুপ ও ছবির OCR সেটিংস</span>
          <button class="btn-outline" style="padding:5px 10px; font-size:0.76rem;" onclick="refreshGroups()">🔄 গ্রুপ রিফ্রেশ</button>
        </h2>

        <label>আপনার জয়েন থাকা WhatsApp গ্রুপ সিলেক্ট করুন:</label>
        <select id="groupSelect" onchange="onGroupDropdownChange()">
          <option value="">-- গ্রুপ সিলেক্ট করুন --</option>
        </select>

        <label>টার্গেট গ্রুপের নাম:</label>
        <input type="text" id="targetGroupNameInput" placeholder="e.g. CRP sales NK Depot" />
        <input type="hidden" id="targetGroupIdInput" />

        <label>হাতে লেখা ছবি (Handwriting OCR) আরও নিখুঁত করতে ফ্রি Gemini API Key (ঐচ্ছিক):</label>
        <input type="password" id="geminiKeyInput" placeholder="AIzaSy... (না দিলেও বিল্ট-ইন ফ্রি ক্লাউড OCR কাজ করবে)" />

        <label style="display:flex; align-items:center; gap:8px; margin-top:12px; cursor:pointer; color:#e2e8f0;">
          <input type="checkbox" id="autoReactCheckbox" style="width:17px; height:17px;" checked />
          অর্ডার সেভ হলে মেসেজে অটোমেটিক ✅ রিয়েকশন দিবে
        </label>

        <div class="btn-row">
          <button class="btn-primary" onclick="saveGroupConfig()">💾 Save Settings</button>
          <button class="btn-blue" onclick="syncSheetStructure()">💲 Update Sheet to Trade Price</button>
        </div>
        <p id="saveStatusMsg" style="font-size:0.82rem; color:#34d399; margin-top:8px;"></p>
      </div>

      <!-- STEP 3: LIVE ORDER & /CNL SIMULATOR -->
      <div class="card">
        <h2>🧪 ৩. লাইভ অর্ডার (Trade Price) ও /cnl টেস্টার</h2>
        <label>যেকোনো অর্ডার মেসেজ লিখে Trade Price হিসাব টেস্ট করুন:</label>
        <textarea id="testInput">Cf 4526 Seraj
Cus name: Nipun pharmacy pso E71
TotiFen 50
Doxicup 10 pes
Deltason 50ml 20 ta
Locan r 150mg = 10</textarea>
        <div class="btn-row">
          <button class="btn-blue" onclick="runTestParse(false)">🔍 Test Trade Price</button>
          <button class="btn-primary" onclick="runTestParse(true)">🚀 Test & Save to Sheet</button>
          <button id="simUnsendBtn" class="btn-danger" style="display:none;" onclick="simulateUnsend()">🗑️ Test /cnl (Cancel Last Order)</button>
        </div>
        <div id="testResultBox" style="margin-top:12px; font-size:0.81rem; color:#cbd5e1;"></div>
      </div>
    </div>

    <!-- RECENT PARSED ORDERS TABLE WITH CLEAR BUTTON -->
    <div class="card" style="margin-bottom:20px;">
      <h2>
        <span>📋 সর্বশেষ ট্র্যাক হওয়া অর্ডারসমূহ (Live Parsed Orders)</span>
        <button class="btn-danger" style="padding:6px 12px; font-size:0.8rem;" onclick="clearLiveOrders()">🧹 Clear Orders List (মেমোরি খালি করুন)</button>
      </h2>
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
            <tr><td colspan="10" style="text-align:center; color:var(--muted);">No orders in temporary memory buffer. (All saved orders are safe in Google Sheets!)</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- SYSTEM ACTIVITY LOGS WITH CLEAR BUTTON -->
    <div class="card">
      <h2>
        <span>🖥️ সিস্টেম লগ (Live Server Logs)</span>
        <button class="btn-danger" style="padding:6px 12px; font-size:0.8rem;" onclick="clearServerLogs()">🧹 Clear Server Logs (লগ ক্লিয়ার করুন)</button>
      </h2>
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

        document.getElementById('ramBadge').textContent = '⚡ RAM: ' + (data.memoryMB || 0) + ' MB';
        document.getElementById('openSheetBtn').href = data.googleSheetUrl;

        document.getElementById('statGroup').textContent =
          data.botConfig.targetGroupName || data.botConfig.targetGroupId || 'All Groups';
        document.getElementById('statSaved').textContent = data.stats.totalOrdersSaved;
        document.getElementById('statAmount').textContent =
          '৳' + Number(data.stats.totalAmountSaved || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('statDeleted').textContent = data.stats.totalOrdersDeleted;

        const qrBox = document.getElementById('qrContainer');
        if (data.waStatus === 'CONNECTED' && data.connectedUser) {
          qrBox.innerHTML =
            '<div style="font-size:2.4rem; margin-bottom:6px;">✅</div>' +
            '<h3 style="color:#34d399;">WhatsApp সচল এবং লগইন সেভ করা আছে!</h3>' +
            '<p style="color:#94a3b8; font-size:0.86rem; margin-top:4px;">Account: <b>' +
            data.connectedUser.name +
            '</b> (' +
            data.connectedUser.id.split(':')[0] +
            ')</p>' +
            '<span class="badge ok" style="margin-top:10px;">☁️ Auto-Saved in Cloud Backup</span>';
        } else if (data.qrDataUrl) {
          qrBox.innerHTML =
            '<img src="' +
            data.qrDataUrl +
            '" alt="WhatsApp QR Code" />' +
            '<p style="color:#fbbf24; font-weight:600; font-size:0.88rem;">আপনার ফোনের WhatsApp ➔ Linked Devices থেকে এই QR কোডটি স্ক্যান করুন</p>';
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
                '<td>৳' + Number(o.unitPrice).toFixed(2) + '</td>' +
                '<td style="color:#34d399; font-weight:700;">৳' + Number(o.totalAmount).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</td>' +
                '<td>' + o.matchType + '</td>' +
                '</tr>'
            )
            .join('');
        } else {
          tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--muted);">No orders in temporary memory buffer. (All saved orders are safe in Google Sheets!)</td></tr>';
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
      const geminiApiKey = document.getElementById('geminiKeyInput').value;

      const res = await fetch('/api/config/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, groupName, autoReactOnOrder, geminiApiKey })
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('saveStatusMsg').textContent =
          '✅ সেটিংস স্থায়ীভাবে সেভ হয়েছে!';
        document.getElementById('geminiKeyInput').value = '';
        groupInputTouched = false;
        fetchStatus();
      }
    }

    async function syncSheetStructure() {
      const res = await fetch('/api/sheets/sync', { method: 'POST' });
      const data = await res.json();
      alert(data.ok ? '✅ Google Sheet-এর সব প্রোডাক্টের দাম অফিশিয়াল TRADE PRICE অনুযায়ী আপডেট হয়েছে!' : '⚠️ Error: ' + data.googleAuthError);
      fetchStatus();
    }

    async function clearLiveOrders() {
      const res = await fetch('/api/orders/clear', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        fetchStatus();
      }
    }

    async function clearServerLogs() {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        fetchStatus();
      }
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
          'টি অর্ডার লাইন (DA: ' +
          data.orders[0].daId +
          ' - ' +
          data.orders[0].daName +
          ', Party: ' +
          data.orders[0].pharmacyName +
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
                '</b> × ৳' +
                o.unitPrice.toFixed(2) +
                ' = <b>৳' +
                o.totalAmount.toFixed(2) +
                '</b>'
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
        '<span style="color:#f87171; font-weight:600;">❌ /cnl ক্যান্সেল সফল! মেসেজ (' +
        lastTestMsgId +
        ') এর ' +
        data.removedCount +
        'টি অর্ডার Google Sheet থেকে অটোমেটিক মুছে ফেলা হয়েছে!</span>';
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
    addLog(`🚀 Server v3.0 listening on port ${PORT}`);
    await initGoogleSheetsClient();
    if (googleAuthReady) {
      await ensureSpreadsheetStructure(true);
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
  AUTHORIZED_IMAGE_PHONES,
  matchCRPProduct,
  extractOrderQuantity,
  parseWhatsAppOrderMessage,
  inspectBaileysMessage,
  isAuthorizedForImageOrder,
  buildImageOrderReplyMessage
};
