// Importar el mapeo de familia a workforce
const FAMILY_TO_WORKFORCE = require('../config/family_to_workforce_category');
const { runFlow, env_orgIdentifier } = require('../../auth');
const datastreamMap = require('../config/datastreams.json');
const { publishDataStreamToWorkforce, createDatastreamInWorkforce } = require('../services/api.service');
const { WORKFORCE_API_URL } = require('../config/constants');
const { DEFAULT_WORKFORCE_TOKEN } = require('../config/constants');
const { ensureTraceFile, traceStep, traceApi } = require('../utils/trace.utils');

const BI_BASE_URL = process.env.ORACLE_BI_BASE_URL || 'https://sbx5-omra.oracleindustry.com';
const APP_NAME = process.env.ORACLE_APP_NAME || 'Postman Testing';
const BUS_DATE = process.env.ORACLE_BUS_DATE || new Date().toISOString().slice(0, 10);
const WF_TOKEN = process.env.WORKFORCE_TOKEN || DEFAULT_WORKFORCE_TOKEN;
const TRACE_FILE = ensureTraceFile('sync_product_counts');

function parseArgs(argv) {
    const args = {
        locRef: '',
        busDate: BUS_DATE,
        wfLocation: '',
        publish: false,
        raw: false,
        tz: '-04:00',
        includeAllOrderTypes: false,
        debugPrefix: '',
        debugLimit: 200,
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--locRef' && argv[i + 1]) args.locRef = String(argv[++i]);
        else if (a === '--date' && argv[i + 1]) args.busDate = String(argv[++i]);
        else if (a === '--wf-location' && argv[i + 1]) args.wfLocation = String(argv[++i]).toLowerCase();
        else if (a === '--tz' && argv[i + 1]) args.tz = String(argv[++i]);
        else if (a === '--publish') args.publish = true;
        else if (a === '--raw') args.raw = true;
        else if (a === '--all-order-types') args.includeAllOrderTypes = true;
        else if (a === '--debug-prefix' && argv[i + 1]) args.debugPrefix = String(argv[++i]).toLowerCase();
        else if (a === '--debug-limit' && argv[i + 1]) args.debugLimit = Number(argv[++i]);
    }

    return args;
}

function printUsage() {
    console.log('Usage:');
    console.log('  node src/scripts/sync_product_counts.js --locRef 29402 --date 2026-02-23 --wf-location macysponce [--publish] [--raw] [--tz -04:00] [--all-order-types] [--debug-prefix espressodrinks] [--debug-limit 200]');
}

async function queryBi(accessToken, endpoint, body) {
    const url = `${BI_BASE_URL}/bi/v1/${env_orgIdentifier}/${endpoint}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'NodeSync/1.0',
        },
        body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = { raw: text };
    }

    if (!response.ok) {
        traceApi(TRACE_FILE, {
            apiName: `oracleBI.${endpoint}`,
            method: 'POST',
            url,
            requestBody: body,
            statusCode: response.status,
            responseBody: text,
            ok: false,
            error: `${endpoint} failed`,
        });
        throw new Error(`${endpoint} failed (${response.status}): ${text.slice(0, 400)}`);
    }

    traceApi(TRACE_FILE, {
        apiName: `oracleBI.${endpoint}`,
        method: 'POST',
        url,
        requestBody: body,
        statusCode: response.status,
        responseBody: data,
        ok: true,
    });

    return data;
}

function extractArray(payload, preferredKey) {
    const candidates = [
        preferredKey ? payload?.[preferredKey] : null,
        payload,
        payload?.items,
        payload?.records,
        payload?.results,
        payload?.data,
        payload?.response?.items,
        payload?.result?.items,
    ];

    for (const c of candidates) {
        if (Array.isArray(c)) return c;
    }

    return [];
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9/]+/g, '');
}

function pickFirst(obj, keys) {
    for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
            return String(v);
        }
    }
    return '';
}


// Busca el workforce category por nombre de familia (case-insensitive, normalizado)
function getWorkforceCategoryByName(familyName) {
    if (!familyName) return '';
    const norm = normalizeText(familyName);
    const found = FAMILY_TO_WORKFORCE.find(e => normalizeText(e.name) === norm);
    return found ? found.workforce : '';
}

function buildDimensionsMap(dimItems) {
    const out = new Map();
    for (const d of dimItems) {
        const miNum = Number(d?.miNum || d?.menuItemNum || d?.num);
        if (!Number.isFinite(miNum)) continue;
        out.set(miNum, d);
    }
    return out;
}

function formatSlot(slot) {
    const hh = String(Math.floor(slot / 4)).padStart(2, '0');
    const mm = String((slot % 4) * 15).padStart(2, '0');
    return `${hh}:${mm}`;
}

function toEpochSeconds(busDate, hhmm, tz) {
    const [h, m] = hhmm.split(':');
    const iso = `${busDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000${tz}`;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) {
        throw new Error(`Invalid date/time parse: ${iso}`);
    }
    return Math.floor(ms / 1000);
}

function parseQuarterHourSlot(qh, indexFallback) {
    const timeFields = [qh?.startTm, qh?.startTime, qh?.tm, qh?.time, qh?.quarterHour, qh?.qtrHr];

    for (const tf of timeFields) {
        if (!tf) continue;
        const s = String(tf);
        const m = s.match(/(\d{1,2}):(\d{2})/);
        if (m) {
            const hh = Number(m[1]);
            const mm = Number(m[2]);
            if (Number.isInteger(hh) && Number.isInteger(mm) && hh >= 0 && hh < 24 && mm % 15 === 0 && mm < 60) {
                return hh * 4 + mm / 15;
            }
        }
    }

    const slotCandidates = [qh?.quarterHourNum, qh?.qtrHrNum, qh?.qhNum, qh?.quarterHourNo, qh?.num];
    for (const c of slotCandidates) {
        const n = Number(c);
        if (!Number.isFinite(n)) continue;
        if (n >= 0 && n <= 95) return n;
        if (n >= 1 && n <= 96) return n - 1;
    }

    if (Number.isInteger(indexFallback) && indexFallback >= 0 && indexFallback <= 95) {
        return indexFallback;
    }

    return -1;
}

async function buildStatsSkeleton(wfLocation, busDate, tz) {
    const uniqueCategories = new Set(FAMILY_TO_WORKFORCE.map(e => normalizeText(e.workforce)).filter(Boolean));
    const prefixes = Array.from(uniqueCategories);

    const fs = require('fs');
    const path = require('path');
    let datastreamsUpdated = false;

    const datastreams = [];
    for (const prefix of prefixes) {
        const key = `${prefix}(${wfLocation})`;
        let id = datastreamMap[key] || null;
        if (!id) {
            console.log(`[CREATING DATASTREAM] ${key}`);
            try {
                id = await createDatastreamInWorkforce(key, 'sales count', WF_TOKEN);
                datastreamMap[key] = id;
                datastreamsUpdated = true;
                console.log(`[CREATED] ${key} -> ID: ${id}`);
            } catch (err) {
                console.error(`[ERROR] Failed to create datastream ${key}: ${err.message}`);
            }
        }
        if (id) {
            datastreams.push({ prefix, key, id: Number(id) });
        }
    }

    if (datastreamsUpdated) {
        fs.writeFileSync(
            path.join(__dirname, '../config/datastreams.json'),
            JSON.stringify(datastreamMap, null, 2)
        );
    }

    const stats = [];
    for (const ds of datastreams) {
        for (let slot = 0; slot < 96; slot++) {
            stats.push({
                datastream_id: ds.id,
                time: toEpochSeconds(busDate, formatSlot(slot), tz),
                stat: 0,
                type: 'sales count',
            });
        }
    }

    return { stats, datastreams };
}

async function run() {
    const args = parseArgs(process.argv);
    // --- Registro de family group y major group únicos ---
    // Importar la tabla de mapeo desde archivo externo
    const FAMILY_TO_NEW_MAJOR = require('../config/family_to_new_major');

    function getNewMajorGroup(fgNum, fgName) {
        // Busca primero por número y nombre exacto
        let found = FAMILY_TO_NEW_MAJOR.find(e => e.num == fgNum && e.name === fgName);
        if (found) return found.newMajor;
        // Si no, busca solo por número
        found = FAMILY_TO_NEW_MAJOR.find(e => e.num == fgNum);
        if (found) return found.newMajor;
        // Si no, busca solo por nombre
        found = FAMILY_TO_NEW_MAJOR.find(e => e.name === fgName);
        if (found) return found.newMajor;
        // Si no hay mapeo, retorna vacío o el original
        return '';
    }
    const uniqueFamilyGroups = new Set();
    const uniqueMajorGroups = new Set();
    if (!args.locRef) {
        console.error('Missing required --locRef');
        printUsage();
        process.exitCode = 1;
        return;
    }
    if (!args.wfLocation) {
        args.wfLocation = args.locRef;
    }

    console.log('--- Sync Product Counts (Sales Count) ---');
    console.log(`locRef: ${args.locRef}`);
    console.log(`date: ${args.busDate}`);
    console.log(`wf-location: ${args.wfLocation}`);
    console.log(`mode: ${args.publish ? 'publish' : 'dry-run'}`);
    console.log(`Trace file: ${TRACE_FILE}`);

    traceStep(TRACE_FILE, 'sync_product_counts.start', {
        locRef: args.locRef,
        busDate: args.busDate,
        wfLocation: args.wfLocation,
        mode: args.publish ? 'publish' : 'dry-run',
        includeAllOrderTypes: args.includeAllOrderTypes,
        debugPrefix: args.debugPrefix,
    });

    // No filtrar por tipo de orden ni canal para productos/items
    console.log('orderType filter: none (disabled for products/items)');
    if (args.debugPrefix) {
        console.log(`debug prefix: ${args.debugPrefix}`);
        console.log(`debug row limit: ${args.debugLimit}`);
    }

    const tokenData = await runFlow();
    if (!tokenData?.access_token) {
        throw new Error('Auth failed: no access token');
    }
    const accessToken = tokenData.access_token;

    const dimensions = await queryBi(accessToken, 'getMenuItemDimensions', {
        applicationName: APP_NAME,
        locRef: args.locRef,
    });

    console.log('[DEBUG] Consultando endpoint: getMenuItemQuarterHourTotals');
    console.log(`[DEBUG] Parámetros: applicationName=${APP_NAME}, locRef=${args.locRef}, busDt=${args.busDate}`);
    const quarterTotals = await queryBi(accessToken, 'getMenuItemQuarterHourTotals', {
        applicationName: APP_NAME,
        locRef: args.locRef,
        busDt: args.busDate,
    });
    // Guardar la data cruda de Oracle para productos
    require('fs').writeFileSync(
        `oracle_raw_productcounts_${args.locRef}_${args.busDate}.json`,
        JSON.stringify(quarterTotals, null, 2)
    );

    const dimItems = extractArray(dimensions, 'menuItems');
            // Guardar todos los objetos de dimensiones para inspección
            require('fs').writeFileSync(
                `oracle_menuitem_dimensions_${args.locRef}_${args.busDate}.json`,
                JSON.stringify(dimItems, null, 2),
                'utf8'
            );
            console.log(`[INFO] Dimensiones de productos exportadas a: oracle_menuitem_dimensions_${args.locRef}_${args.busDate}.json`);
        // Extraer todos los family group y major group únicos del catálogo de dimensiones
        for (const dim of dimItems) {
            // Family Group
            const fgNum = dim.famGrpNum || dim.familyGroupNum || dim.famGrp;
            const fgName = dim.famGrpName || dim.familyGroupName || dim.famGrp || dim.familyName;
            if (fgNum && fgName && typeof fgName === 'string' && fgName.trim()) {
                uniqueFamilyGroups.add(`${fgNum} - ${fgName.trim()}`);
            }
            // Major Group
            const mgNum = dim.majGrpNum || dim.majorGroupNum || dim.majorGrp;
            const mgName = dim.majGrpName || dim.majorGroupName || dim.majorGrp || dim.majorGroup;
            if (mgNum && mgName && typeof mgName === 'string' && mgName.trim()) {
                uniqueMajorGroups.add(`${mgNum} - ${mgName.trim()}`);
            }
        }
    const dimByMiNum = buildDimensionsMap(dimItems);

    const { stats, datastreams } = await buildStatsSkeleton(args.wfLocation, args.busDate, args.tz);
    if (!datastreams.length) {
        throw new Error(`No category datastreams found for wf-location '${args.wfLocation}'`);
    }

    const statsIndex = new Map();
    for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        statsIndex.set(`${s.datastream_id}|${s.time}`, i);
    }

    let skippedRows = 0;
    let unknownRows = 0;
    let missingDatastreamRows = 0;
    let filteredByOrderTypeRows = 0;

    const unknownByCategory = new Map();
    const missingByPrefix = new Map();
    const debugRows = [];

    const rvcs = Array.isArray(quarterTotals?.revenueCenters) ? quarterTotals.revenueCenters : [];
    for (const rvc of rvcs) {
        const qhs = Array.isArray(rvc?.quarterHours) ? rvc.quarterHours : [];
        for (let qhIndex = 0; qhIndex < qhs.length; qhIndex++) {
            const qh = qhs[qhIndex];
            const slot = parseQuarterHourSlot(qh, qhIndex);
            if (slot < 0 || slot > 95) {
                continue;
            }

            const epoch = toEpochSeconds(args.busDate, formatSlot(slot), args.tz);
            const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
            for (const row of items) {
                // Eliminado filtro por tipo de orden/canal

                const miNum = Number(row?.miNum || row?.menuItemNum || row?.num);
                const dim = dimByMiNum.get(miNum) || {};

                // Usar family group como categoría principal
                const categoryName = pickFirst(dim, [
                    'famGrpName',
                    'familyGroupName',
                    'famGrp',
                    'familyName',
                ]);


                // Mapear la categoría familiar al workforce category usando el nombre
                const workforceCategory = getWorkforceCategoryByName(categoryName);
                if (!workforceCategory) {
                    unknownRows += 1;
                    const curr = unknownByCategory.get(categoryName || '(empty)') || 0;
                    unknownByCategory.set(categoryName || '(empty)', curr + 1);
                    continue;
                }

                const dsKey = `${normalizeText(workforceCategory)}(${args.wfLocation})`;
                const dsId = datastreamMap[dsKey] || null;
                if (!dsId) {
                    missingDatastreamRows += 1;
                    const curr = missingByPrefix.get(workforceCategory) || 0;
                    missingByPrefix.set(workforceCategory, curr + 1);
                    continue;
                }

                const count = Number(row?.slsCnt || 0);
                const idx = statsIndex.get(`${dsId}|${epoch}`);
                if (idx === undefined) {
                    continue;
                }
                stats[idx].stat += count;

                if (args.debugPrefix && prefix === args.debugPrefix && debugRows.length < args.debugLimit) {
                    debugRows.push({
                        slot,
                        hhmm: formatSlot(slot),
                        epoch,
                        rvcNum: Number(rvc?.rvcNum || 0) || null,
                        qtrHrNum: Number(qh?.qtrHrNum || qh?.quarterHourNum || 0) || null,
                        miNum,
                        otNum: Number(row?.otNum ?? qh?.otNum ?? 0) || null,
                        ocNum: Number(row?.ocNum || 0) || null,
                        prcLvlNum: Number(row?.prcLvlNum || 0) || null,
                        slsCnt: count,
                        slsTtl: Number(row?.slsTtl || 0),
                        categoryName,
                        prefix,
                        dsKey,
                        dsId,
                    });
                }
            }
        }
    }

    const totalsByDatastream = new Map();
    for (const s of stats) {
        const curr = totalsByDatastream.get(s.datastream_id) || 0;
        totalsByDatastream.set(s.datastream_id, curr + Number(s.stat || 0));
    }

    console.log(`menuItemDimensions rows: ${dimItems.length}`);
    console.log(`stats payload rows: ${stats.length}`);
    console.log(`skipped rows (modifier/options): ${skippedRows}`);
    console.log(`filtered rows by orderType: ${filteredByOrderTypeRows}`);
    console.log(`unknown category rows: ${unknownRows}`);
    console.log(`rows with missing datastream mapping: ${missingDatastreamRows}`);
    traceStep(TRACE_FILE, 'sales_count.aggregation', {
        menuItemDimensionsRows: dimItems.length,
        statsRows: stats.length,
        skippedRows,
        filteredByOrderTypeRows,
        unknownRows,
        missingDatastreamRows,
    });

    console.log('--- Totals by Category Datastream ---');
    for (const ds of datastreams) {
        const total = totalsByDatastream.get(ds.id) || 0;
        console.log(`[TOTAL] ${ds.key} | id=${ds.id} | count=${total}`);
    }

    if (unknownByCategory.size > 0) {
        console.log('--- Top Unknown Categories ---');
        const topUnknown = [...unknownByCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        for (const [cat, qty] of topUnknown) {
            console.log(`[UNKNOWN_CAT] ${cat} | rows=${qty}`);
        }
    }

    if (missingByPrefix.size > 0) {
        console.log('--- Missing Datastream Prefixes ---');
        for (const [prefix, qty] of [...missingByPrefix.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`[MISSING_DS] ${prefix} | rows=${qty}`);
        }
    }

    if (args.debugPrefix) {
        console.log(`--- Debug Rows for prefix: ${args.debugPrefix} ---`);
        if (!debugRows.length) {
            console.log('No rows matched debug prefix with current filters.');
        } else {
            for (const r of debugRows) {
                console.log(
                    `[DBG] time=${r.hhmm} epoch=${r.epoch} rvc=${r.rvcNum || '(na)'} qh=${r.qtrHrNum || '(na)'} miNum=${r.miNum || '(na)'} otNum=${r.otNum || '(na)'} ocNum=${r.ocNum || '(na)'} prcLvl=${r.prcLvlNum || '(na)'} slsCnt=${r.slsCnt} slsTtl=${r.slsTtl} cat='${r.categoryName || ''}' prefix=${r.prefix} ds=${r.dsKey} id=${r.dsId}`
                );
            }
        }
    }

    if (args.raw) {
        console.log('--- RAW getMenuItemQuarterHourTotals ---');
        console.log(JSON.stringify(quarterTotals, null, 2));
    }

    if (args.publish) {
        console.log(`[WF_SEND] endpoint=${WORKFORCE_API_URL} | rows=${stats.length} | datastreams=${datastreams.length} | type=sales count`);
        const publishResponse = await publishDataStreamToWorkforce({ stats }, WF_TOKEN);
        console.log(`[WF] endpoint=${publishResponse.endpoint} status=${publishResponse.statusCode} sentRows=${publishResponse.sentRows} sentDatastreams=${publishResponse.uniqueDatastreams}`);
        if (publishResponse.body) {
            console.log(`[WF] body=${publishResponse.body}`);
        }
        console.log(`Publish OK. Sent ${stats.length} stats rows (type=sales count).`);
        traceStep(TRACE_FILE, 'sync_product_counts.publish.done', {
            statsSent: stats.length,
            type: 'sales count',
        });
    } else {
        console.log('Dry-run completed. Use --publish to send to Workforce.');
    }

    traceStep(TRACE_FILE, 'sync_product_counts.finish', {
        locRef: args.locRef,
        statsRows: stats.length,
        mode: args.publish ? 'publish' : 'dry-run',
    });

    // --- Exportar catálogo de family group y major group únicos ---
    const catalogFile = `catalogo_family_major_groups_${args.locRef}_${args.busDate}.md`;
    const catalogContent = [
        `# Catálogo de Family Groups y Major Groups (Oracle)`,
        `\n- Fecha de extracción: ${args.busDate}`,
        `- LocRef consultado: ${args.locRef}`,
        `\n## Family Groups detectados`,
        ...[...uniqueFamilyGroups].sort().map(fg => `- ${fg}`),
        `\n## Major Groups detectados`,
        ...[...uniqueMajorGroups].sort().map(mg => `- ${mg}`),
        `\n---\nEste archivo se genera automáticamente en cada ejecución para troubleshooting, mapeos y validación de catálogo.`,
    ].join('\n');
    require('fs').writeFileSync(catalogFile, catalogContent, 'utf8');
    console.log(`[INFO] Catálogo de family/major groups exportado a: ${catalogFile}`);
}

run().catch((err) => {
    console.error('Fatal error:', err.message || err);
    process.exitCode = 1;
});
