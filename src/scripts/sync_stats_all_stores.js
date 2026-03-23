const { runFlow, env_orgIdentifier } = require('../../auth');
const datastreamMap = require('../config/datastreams.json');
const { ALLOWED_LOCATION_NAMES, WORKFORCE_API_URL } = require('../config/constants');
const { publishDataStreamToWorkforce } = require('../services/api.service');
const { DEFAULT_WORKFORCE_TOKEN } = require('../config/constants');
const { ensureTraceFile, traceStep, traceApi } = require('../utils/trace.utils');
const { spawnSync } = require('child_process');
const path = require('path');

const BI_BASE_URL = process.env.ORACLE_BI_BASE_URL || 'https://sbx5-omra.oracleindustry.com';
const APP_NAME = process.env.ORACLE_APP_NAME || 'Postman Testing';
const BUS_DATE = process.env.ORACLE_BUS_DATE || new Date().toISOString().slice(0, 10);
const MAX_LOCATIONS = Number(process.env.MAX_LOCATIONS || 0);
const DEMO_MODE = String(process.env.DEMO_MODE || 'true').toLowerCase() !== 'false';

const LABOR_BASE_URL = process.env.ORACLE_LABOR_BASE_URL || 'https://simphony-home.sbx5.oraclerestaurants.com';
// Fallback temporal a credenciales existentes en el repo.
// Si se define env var, tiene prioridad sobre estos valores.
const LABOR_API_TOKEN = process.env.ORACLE_LABOR_API_TOKEN || '7dUrTlug8IhW1/Ny1stnIKCINBs8LGFLZ4JZyVyGi8TxHi+VWZtExSHxtgfngQcd3+oV+/i3YBCT08/47awuHg==';
const LABOR_API_PASSWORD = process.env.ORACLE_LABOR_API_PASSWORD || 'ko0or%5Hu$mm.lD#';

const ORACLE_NAME_FALLBACKS = {
};
const WF_TOKEN = process.env.WORKFORCE_TOKEN || DEFAULT_WORKFORCE_TOKEN;
const TRACE_FILE = ensureTraceFile('sync_stats_all_stores');

function normalizeLocationName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9.\-]/g, '');
}

function parseArgs(argv) {
    const args = {
        busDate: BUS_DATE,
        max: MAX_LOCATIONS,
        locRef: '',
        printRaw: false,
        debugLocations: false,
        publish: false,
        tz: '-04:00',
        checksMode: 'auto',
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--date' && argv[i + 1]) args.busDate = argv[++i];
        else if (a === '--max' && argv[i + 1]) args.max = Number(argv[++i]);
        else if (a === '--locRef' && argv[i + 1]) args.locRef = String(argv[++i]);
        else if (a === '--tz' && argv[i + 1]) args.tz = String(argv[++i]);
        else if (a === '--raw') args.printRaw = true;
        else if (a === '--debug-locations') args.debugLocations = true;
        else if (a === '--publish') args.publish = true;
        else if (a === '--checks-mode' && argv[i + 1]) args.checksMode = String(argv[++i]).toLowerCase();
    }

    if (!['auto', 'strict', 'menuitems'].includes(args.checksMode)) {
        args.checksMode = 'auto';
    }

    return args;
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function resolveForcedOracleLocation(normalizedName) {
    if (!normalizedName) return '';

    if (ORACLE_NAME_FALLBACKS[normalizedName]) {
        return ORACLE_NAME_FALLBACKS[normalizedName];
    }

    return '';
}

function formatSlot(slot) {
    const hh = String(Math.floor(slot / 4)).padStart(2, '0');
    const mm = String((slot % 4) * 15).padStart(2, '0');
    return `${hh}:${mm}`;
}

function toEpochSeconds(busDate, hhmm, tz) {
    const [year, month, day] = String(busDate).split('-');
    const [hh, mm] = String(hhmm).split(':');
    const iso = `${year}-${month}-${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000${tz}`;
    return Math.floor(Date.parse(iso) / 1000);
}

function parseQuarterHourSlot(qh, indexFallback = -1) {
    const timeFields = [
        qh?.tmOfDay,
        qh?.time,
        qh?.timeLabel,
        qh?.startTime,
        qh?.quarterHour,
    ];

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

function extractSalesFromQuarterHour(qh, itemFilter = null) {
    // Usar netSlsTtl como ventas principal para getOperationsQuarterHourTotals
    if (typeof qh?.netSlsTtl !== 'undefined') {
        return Number(qh.netSlsTtl) || 0;
    }
    // Fallbacks para otros endpoints o estructuras
    if (typeof itemFilter === 'function') {
        const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
        return items.reduce((acc, mi) => {
            if (!itemFilter(mi)) return acc;
            return acc + Number(mi?.slsTtl || 0);
        }, 0);
    }
    const candidates = [qh?.slsTtl, qh?.sales, qh?.netSales, qh?.ttlNetSls];
    for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n)) return n;
    }
    const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
    return items.reduce((acc, mi) => acc + Number(mi?.slsTtl || 0), 0);
}

function hasQuarterHourChecksField(qh) {
    const candidates = [qh?.chkCnt, qh?.checks, qh?.ttlChkCnt, qh?.checkCount, qh?.guestChecks];
    return candidates.some((c) => Number.isFinite(Number(c)));
}

function extractChecksFromQuarterHour(qh, itemFilter = null, checksMode = 'auto') {
    // Usar chkCnt como cuentas principal para getOperationsQuarterHourTotals
    if (typeof qh?.chkCnt !== 'undefined') {
        return Number(qh.chkCnt) || 0;
    }
    // Fallbacks para otros endpoints o estructuras
    if (typeof itemFilter === 'function') {
        const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
        return items.reduce((acc, mi) => {
            if (!itemFilter(mi)) return acc;
            return acc + Number(mi?.slsCnt || 0);
        }, 0);
    }
    if (checksMode === 'menuitems') {
        const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
        return items.reduce((acc, mi) => acc + Number(mi?.slsCnt || 0), 0);
    }
    const candidates = [qh?.checks, qh?.ttlChkCnt, qh?.checkCount, qh?.guestChecks];
    for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n)) return n;
    }
    if (checksMode === 'strict') {
        return 0;
    }
    const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
    return items.reduce((acc, mi) => acc + Number(mi?.slsCnt || 0), 0);
}

function resolveChannelFromOrderType(otNum, availableChannels) {
    const n = Number(otNum);
    if (!Number.isFinite(n)) return '';

    const has = (channel) => availableChannels.has(channel);
    if (n === 2 && has('ubereats')) return 'ubereats';
    if (n === 3 && has('doordash')) return 'doordash';
    if (n === 4 && has('drivethru')) return 'drivethru';
    if (n === 1 && has('starbuckscafe')) return 'starbuckscafe';

    return '';
}

function resolveChannelFromRvcName(rawRvcName, wfLocation, availableChannels) {
    const normalizedRvcRaw = normalizeText(rawRvcName);
    if (!normalizedRvcRaw) return '';

    const normalizedRvc = normalizedRvcRaw.startsWith(wfLocation)
        ? normalizedRvcRaw.slice(wfLocation.length)
        : normalizedRvcRaw;

    if (!normalizedRvc) return '';
    if (availableChannels.has(normalizedRvc)) return normalizedRvc;

    const knownChannels = ['ubereats', 'doordash', 'drivethru', 'starbuckscafe', 'digital'];
    for (const channel of knownChannels) {
        if (normalizedRvc.includes(channel) && availableChannels.has(channel)) {
            return channel;
        }
    }

    return '';
}

function buildStatsSkeletonForLocation(wfLocation, busDate, tz) {
    const datastreams = [];

    for (const [key, id] of Object.entries(datastreamMap)) {
        if (!Number.isFinite(Number(id))) continue;
        const isSalesKey = key.startsWith(`sales(${wfLocation}`);
        const isChecksKey = key.startsWith(`checks(${wfLocation}`);
        if (!(isSalesKey || isChecksKey)) continue;

        const type = key.startsWith('sales(') ? 'sales' : 'checks';
        datastreams.push({ key, id: Number(id), type });
    }

    const stats = [];
    for (const ds of datastreams) {
        for (let slot = 0; slot < 96; slot++) {
            stats.push({
                datastream_id: ds.id,
                time: toEpochSeconds(busDate, formatSlot(slot), tz),
                stat: 0,
                type: ds.type,
            });
        }
    }

    return { stats, datastreams };
}

function fillSalesChecksStats({ stats, datastreams, wfLocation, busDate, tz, data, checksMode = 'auto' }) {
    const statsIndex = new Map();
    for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        statsIndex.set(`${s.datastream_id}|${s.time}`, i);
    }

    const datastreamByKey = new Map(datastreams.map((d) => [d.key, d]));
    const missingDatastreamKeys = new Set();
    const checksSourceCounts = {
        quarterHourField: 0,
        menuItemsFallback: 0,
        strictZero: 0,
        menuItemsSplitByChannel: 0,
    };

    const channelDatastreams = new Map();
    for (const ds of datastreams) {
        const inside = String(ds.key).match(/\(([^)]+)\)/)?.[1] || '';
        const channel = normalizeText(inside.startsWith(wfLocation) ? inside.slice(wfLocation.length) : inside);
        if (!channel) continue;

        if (!channelDatastreams.has(channel)) {
            channelDatastreams.set(channel, { salesDs: null, checksDs: null });
        }

        const entry = channelDatastreams.get(channel);
        if (ds.type === 'sales') entry.salesDs = ds;
        if (ds.type === 'checks') entry.checksDs = ds;
    }

    const availableChannels = new Set(channelDatastreams.keys());

    function addValue(ds, epoch, value) {
        if (!ds) return;
        const idx = statsIndex.get(`${ds.id}|${epoch}`);
        if (idx === undefined) return;
        stats[idx].stat = Number(stats[idx].stat || 0) + Number(value || 0);
    }

    const rvcs = Array.isArray(data?.revenueCenters) ? data.revenueCenters : [];
    for (const rvc of rvcs) {
        const num = Number(rvc?.rvcNum);
        let channel = '';
        if (num === 1) { // Starbucks Cafe
            channel = 'starbuckscafe';
        } else if (num === 2) { // Starbucks DT
            channel = 'drivethru';
        } else if (num === 4 || num === 3) { // Digital o Mobile Order
            channel = 'digital';
        } else {
            // Por defecto, si llegara otro, lo enviamos a DT como se hacía antes (que enviaba todo lo que no era 1 a un solo lugar)
            channel = 'drivethru';
        }
        const entry = channelDatastreams.get(channel);
        if (!entry) continue;

        const qhs = Array.isArray(rvc?.quarterHours) ? rvc.quarterHours : [];
        for (let qhIndex = 0; qhIndex < qhs.length; qhIndex++) {
            const qh = qhs[qhIndex];
            const slot = parseQuarterHourSlot(qh, qhIndex);
            if (slot < 0 || slot > 95) continue;

            const epoch = toEpochSeconds(busDate, formatSlot(slot), tz);
            const sales = extractSalesFromQuarterHour(qh);
            const checks = extractChecksFromQuarterHour(qh, null, checksMode);

            addValue(entry.salesDs, epoch, sales);
            addValue(entry.checksDs, epoch, checks);
        }
    }

    return {
        stats,
        missingDatastreamKeys: [...missingDatastreamKeys],
        checksSourceCounts,
    };
}

function summarizeStats(stats) {
    return stats.reduce(
        (acc, s) => {
            const t = String(s.type || '').toLowerCase();
            const v = Number(s.stat || 0);
            if (t === 'sales') acc.totalSales += v;
            if (t === 'checks') acc.totalChecks += v;
            return acc;
        },
        { totalSales: 0, totalChecks: 0 }
    );
}

function summarizeByDatastream(stats) {
    const totalsByDs = new Map();
    for (const s of stats) {
        const id = Number(s?.datastream_id);
        if (!Number.isFinite(id)) continue;
        const curr = totalsByDs.get(id) || 0;
        totalsByDs.set(id, curr + Number(s?.stat || 0));
    }
    return totalsByDs;
}

function getDatastreamLocationSet() {
    const set = new Set();

    for (const key of Object.keys(datastreamMap)) {
        const m = key.match(/\(([^)]+)\)/);
        if (!m) continue;

        const inside = normalizeLocationName(m[1]);
        if (!inside) continue;

        const sortedAllowed = [...ALLOWED_LOCATION_NAMES].sort((a, b) => b.length - a.length);
        const found = sortedAllowed.find((name) => inside.startsWith(name));

        if (found) set.add(found);
    }

    return set;
}

function pickFirst(obj, keys) {
    for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
            return obj[k];
        }
    }
    return '';
}

function describeLocationMapping({ locRef, name, normalized, candidate, fallbackLocation, locationKey, hasDatastream }) {
    let reason = 'name-normalized';
    if (candidate) {
        reason = 'allowed-location-match';
    } else if (fallbackLocation) {
        reason = 'forced-fallback-rule';
    }

    const dsStatus = hasDatastream ? 'datastreams-found' : 'no-datastreams';
    return `[MAP] locRef=${locRef} | oracle='${name}' | normalized='${normalized}' | wf='${locationKey}' | reason=${reason} | ${dsStatus}`;
}

function logDatastreamMatching(wfLocation, datastreams) {
    const sales = datastreams.filter((d) => d.type === 'sales');
    const checks = datastreams.filter((d) => d.type === 'checks');

    console.log(`[MATCH] wf=${wfLocation} | salesDS=${sales.length} | checksDS=${checks.length} | totalDS=${datastreams.length}`);

    for (const ds of datastreams) {
        console.log(`[MATCH_DS] type=${ds.type} | key=${ds.key} | id=${ds.id}`);
    }
}

function mapLocationsFromArray(arr) {
    if (!Array.isArray(arr)) return [];

    return arr
        .map((x) => ({
            locRef: String(
                pickFirst(x, ['locRef', 'locationRef', 'locationID', 'id', 'locationNumber', 'locNum'])
            ),
            name: String(
                pickFirst(x, ['name', 'locationName', 'displayName', 'locationDisplayName', 'description'])
            ),
        }))
        .filter((x) => x.locRef && x.name);
}

function extractLocations(payload) {
    const directCandidates = [
        payload,
        payload?.locations,
        payload?.location,
        payload?.items,
        payload?.records,
        payload?.results,
        payload?.data,
        payload?.response?.locations,
        payload?.response?.items,
        payload?.result?.locations,
        payload?.result?.items,
    ];

    for (const candidate of directCandidates) {
        const mapped = mapLocationsFromArray(candidate);
        if (mapped.length > 0) return mapped;
    }

    // Fallback: buscar arreglos de objetos en el payload de forma superficial.
    const queue = [payload];
    while (queue.length) {
        const current = queue.shift();
        if (!current || typeof current !== 'object') continue;

        for (const k of Object.keys(current)) {
            const v = current[k];
            if (Array.isArray(v)) {
                const mapped = mapLocationsFromArray(v);
                if (mapped.length > 0) return mapped;
            } else if (v && typeof v === 'object') {
                queue.push(v);
            }
        }
    }

    return [];
}

async function fetchLocationsFromLabor(debugLocations = false) {
    if (!LABOR_API_TOKEN || !LABOR_API_PASSWORD) {
        return {
            ok: false,
            reason: 'Missing ORACLE_LABOR_API_TOKEN / ORACLE_LABOR_API_PASSWORD',
            locations: [],
        };
    }

    const url = `${LABOR_BASE_URL}/rest/services/v1/locations`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            username: LABOR_API_TOKEN,
            password: LABOR_API_PASSWORD,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        traceApi(TRACE_FILE, {
            apiName: 'oracleLabor.getLocations',
            method: 'GET',
            url,
            statusCode: response.status,
            responseBody: text,
            ok: false,
            error: 'Labor locations request failed',
        });
        return {
            ok: false,
            reason: `Labor locations request failed (${response.status}): ${text.slice(0, 300)}`,
            locations: [],
        };
    }

    const payload = await response.json();
    const locations = extractLocations(payload);
    traceApi(TRACE_FILE, {
        apiName: 'oracleLabor.getLocations',
        method: 'GET',
        url,
        statusCode: response.status,
        responseBody: payload,
        ok: true,
    });

    if (debugLocations) {
        const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
        console.log(`[DEBUG] Labor payload top-level keys: ${keys.join(', ') || '(none)'}`);
        console.log(`[DEBUG] Locations mapped: ${locations.length}`);
        if (locations.length > 0) {
            console.log(`[DEBUG] First location: ${locations[0].locRef} | ${locations[0].name}`);
        } else {
            const preview = JSON.stringify(payload).slice(0, 600);
            console.log(`[DEBUG] Payload preview: ${preview}`);
        }
    }

    return { ok: true, reason: 'ok', locations };
}

async function queryQuarterHourTotals(accessToken, locRef, busDate) {
    // Usar getOperationsQuarterHourTotals para ventas y cuentas
    const url = `${BI_BASE_URL}/bi/v1/${env_orgIdentifier}/getOperationsQuarterHourTotals`;
    const body = {
        applicationName: APP_NAME,
        busDt: busDate,
        locRef,
    };

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
            apiName: 'oracleBI.getOperationsQuarterHourTotals',
            method: 'POST',
            url,
            requestBody: body,
            statusCode: response.status,
            responseBody: text,
            ok: false,
            error: `BI query failed for locRef ${locRef}`,
        });
        throw new Error(`BI query failed for locRef ${locRef} (${response.status}): ${text.slice(0, 300)}`);
    }

    traceApi(TRACE_FILE, {
        apiName: 'oracleBI.getOperationsQuarterHourTotals',
        method: 'POST',
        url,
        requestBody: body,
        statusCode: response.status,
        responseBody: data,
        ok: true,
    });

    return data;
}

function computeTotals(data) {
    let totalSales = 0;
    let totalCount = 0;

    const rvcs = Array.isArray(data?.revenueCenters) ? data.revenueCenters : [];
    for (const rvc of rvcs) {
        const qhs = Array.isArray(rvc?.quarterHours) ? rvc.quarterHours : [];
        for (const qh of qhs) {
            const items = Array.isArray(qh?.menuItems) ? qh.menuItems : [];
            for (const mi of items) {
                totalSales += Number(mi?.slsTtl || 0);
                totalCount += Number(mi?.slsCnt || 0);
            }
        }
    }

    return { totalSales, totalCount };
}

function printUsage() {
    console.log('Usage:');
    console.log('  node src/scripts/sync_stats_all_stores.js [--date YYYY-MM-DD] [--max N] [--locRef NNNNN] [--tz -04:00] [--publish] [--raw] [--debug-locations] [--checks-mode auto|strict|menuitems]');
    console.log('');
    console.log('Required env for locations endpoint:');
    console.log('  ORACLE_LABOR_API_TOKEN');
    console.log('  ORACLE_LABOR_API_PASSWORD');
    console.log('');
    console.log('Optional env:');
    console.log('  ORACLE_BI_BASE_URL, ORACLE_APP_NAME, ORACLE_BUS_DATE, MAX_LOCATIONS, ORACLE_LABOR_BASE_URL, WORKFORCE_TOKEN');
}

async function run() {
    const args = parseArgs(process.argv);

    console.log('--- Sync Stats All Stores ---');
    console.log(`Date: ${args.busDate}`);
    console.log(`Mode: ${args.publish ? 'publish' : 'dry-run'}`);
    console.log(`Resolve mode: ${DEMO_MODE ? 'demo' : 'prod'}`);
    console.log(`Checks mode: ${args.checksMode}`);
    if (args.publish) {
        console.log(`Workforce target: ${WORKFORCE_API_URL}`);
    }
    console.log(`Trace file: ${TRACE_FILE}`);

    traceStep(TRACE_FILE, 'sync_stats_all_stores.start', {
        busDate: args.busDate,
        mode: args.publish ? 'publish' : 'dry-run',
        checksMode: args.checksMode,
        locRef: args.locRef || '',
    });

    const tokenData = await runFlow();
    if (!tokenData?.access_token) {
        throw new Error('Auth failed. Could not get access token.');
    }

    console.log('Paso 1: buscando locaciones en Oracle Labor...');
    traceStep(TRACE_FILE, 'step-1.fetch-oracle-locations.start');
    const locationResult = await fetchLocationsFromLabor(args.debugLocations);

    if (!locationResult.ok) {
        console.error('Could not fetch locations list:', locationResult.reason);
        console.log('Tip: set ORACLE_LABOR_API_TOKEN and ORACLE_LABOR_API_PASSWORD, then retry.');
        printUsage();
        process.exitCode = 1;
        return;
    }

    const datastreamLocations = getDatastreamLocationSet();
    let locations = locationResult.locations;

    console.log(`Paso 1 OK: se encontraron ${locationResult.locations.length} locaciones en Oracle.`);
    traceStep(TRACE_FILE, 'step-1.fetch-oracle-locations.done', {
        locationsFound: locationResult.locations.length,
    });
    console.log('Locaciones Oracle encontradas:');
    for (const x of locationResult.locations) {
        console.log(`  - locRef=${x.locRef} | name=${x.name}`);
    }

    if (args.locRef) {
        locations = locations.filter((x) => x.locRef === args.locRef);
        console.log(`Filtro aplicado: locRef=${args.locRef} -> ${locations.length} locaciones.`);
    }
    if (args.max > 0) {
        locations = locations.slice(0, args.max);
        console.log(`Filtro aplicado: max=${args.max} -> ${locations.length} locaciones.`);
    }

    if (!locations.length) {
        console.log('No locations to process with current filters.');
        console.log(`Fetched locations before filters: ${locationResult.locations.length}`);
        if (args.locRef) {
            console.log(`Filter --locRef applied: ${args.locRef}`);
        }
        console.log('Try again with --debug-locations to inspect Labor response mapping.');
        return;
    }

    const summary = [];

    console.log('Paso 2: evaluando mapeo Oracle -> Workforce por locacion...');

    for (const loc of locations) {
        const normalized = normalizeLocationName(loc.name);
        const candidate = [...ALLOWED_LOCATION_NAMES]
            .sort((a, b) => b.length - a.length)
            .find((name) => normalized.startsWith(name) || name.startsWith(normalized));

        const fallbackLocation = resolveForcedOracleLocation(normalized);
        let locationKey = candidate || fallbackLocation || normalized;
        let hasDatastream = datastreamLocations.has(locationKey);

        console.log(describeLocationMapping({
            locRef: loc.locRef,
            name: loc.name,
            normalized,
            candidate,
            fallbackLocation,
            locationKey,
            hasDatastream,
        }));
        traceStep(TRACE_FILE, 'location.mapping', {
            locRef: loc.locRef,
            oracleName: loc.name,
            normalized,
            resolvedWfLocation: locationKey,
            hasDatastream,
        });

        try {
            console.log(`Paso 3: consultando ventas/checks por 15 minutos para locRef=${loc.locRef}...`);
            const data = await queryQuarterHourTotals(tokenData.access_token, loc.locRef, args.busDate);
            // Guardar la data cruda de Oracle para ventas/checks
            require('fs').writeFileSync(
                `oracle_raw_quarterhour_${loc.locRef}_${args.busDate}.json`,
                JSON.stringify(data, null, 2)
            );
            const baselineTotals = computeTotals(data);
            const hasData = baselineTotals.totalSales !== 0 || baselineTotals.totalCount !== 0;

            // No forzar mapeo genérico: solo se permite fallback explícito por nombre.

            // --- CHECK & CREATE MISSING DATASTREAMS DYNAMICALLY ---
            const requiredKeys = new Set();
            const qhRvcs = Array.isArray(data?.revenueCenters) ? data.revenueCenters : [];
            for (const rvc of qhRvcs) {
                const num = Number(rvc?.rvcNum);
                let channel = '';
                if (num === 1) {
                    channel = 'starbuckscafe';
                } else if (num === 2) {
                    channel = 'drivethru';
                } else if (num === 4 || num === 3) {
                    channel = 'digital';
                } else {
                    channel = 'drivethru';
                }

                if (channel) {
                    requiredKeys.add(`sales(${locationKey}${channel})`);
                    requiredKeys.add(`checks(${locationKey}${channel})`);
                }
            }

            const { createDatastreamInWorkforce } = require('../services/api.service');
            const fs = require('fs');
            const path = require('path');
            let datastreamsUpdated = false;

            for (const key of requiredKeys) {
                if (!datastreamMap[key]) {
                    console.log(`[CREATING DATASTREAM] ${key}`);
                    try {
                        const newId = await createDatastreamInWorkforce(key, 'sales', WF_TOKEN);
                        datastreamMap[key] = newId;
                        datastreamLocations.add(locationKey);
                        hasDatastream = true;
                        datastreamsUpdated = true;
                        console.log(`[CREATED] ${key} -> ID: ${newId}`);
                    } catch (e) {
                        console.error(`[ERROR] Failed to create datastream ${key}: ${e.message}`);
                    }
                }
            }

            if (datastreamsUpdated) {
                fs.writeFileSync(
                    path.join(__dirname, '../config/datastreams.json'),
                    JSON.stringify(datastreamMap, null, 2)
                );
            }
            // --------------------------------------------------------

            const { stats, datastreams } = buildStatsSkeletonForLocation(locationKey, args.busDate, args.tz);
            logDatastreamMatching(locationKey, datastreams);
            const filled = fillSalesChecksStats({
                stats,
                datastreams,
                wfLocation: locationKey,
                busDate: args.busDate,
                tz: args.tz,
                data,
                checksMode: args.checksMode,
            });

            const totals = summarizeStats(filled.stats);
            const hasPublishableDatastreams = datastreams.length > 0;
            const totalsByDatastream = summarizeByDatastream(filled.stats);
            let publishStatus = 'skipped';
            let publishResponse = null;

            if (args.publish && hasPublishableDatastreams) {
                // Publicar todos los intervalos de 15 minutos para mantener cero donde no hay data.
                console.log(`[WF_SEND] wf=${locationKey} | endpoint=${WORKFORCE_API_URL} | rows=${filled.stats.length} | datastreams=${datastreams.length}`);
                publishResponse = await publishDataStreamToWorkforce({ stats: filled.stats }, WF_TOKEN);
                publishStatus = 'published-all-intervals';
            } else if (args.publish && !hasPublishableDatastreams) {
                publishStatus = 'no-datastreams';
            }

            summary.push({
                locRef: loc.locRef,
                name: loc.name,
                normalizedName: normalized,
                matchedLocationKey: locationKey,
                datastreamMatch: hasDatastream,
                totalSales: Number(totals.totalSales.toFixed(2)),
                totalChecks: Number(totals.totalChecks.toFixed(2)),
                baselineCount: baselineTotals.totalCount,
                hasData,
                nonZeroStatsCount: filled.stats.filter((s) => Number(s?.stat || 0) !== 0).length,
                datastreamsCount: datastreams.length,
                missingRvcDatastreamCount: filled.missingDatastreamKeys.length,
                publishStatus,
                publishApiStatusCode: publishResponse?.statusCode || null,
                publishApiBody: publishResponse?.body || '',
                ok: true,
            });

            const nonZeroCount = filled.stats.filter((s) => Number(s?.stat || 0) !== 0).length;
            console.log(`[OK] locRef=${loc.locRef} | wf=${locationKey} | sales=${totals.totalSales.toFixed(2)} | checks=${totals.totalChecks.toFixed(2)} | ds=${datastreams.length} | nonZeroIntervals=${nonZeroCount} | publish=${publishStatus}`);
            traceStep(TRACE_FILE, 'location.done', {
                locRef: loc.locRef,
                wfLocation: locationKey,
                totalSales: Number(totals.totalSales.toFixed(2)),
                totalChecks: Number(totals.totalChecks.toFixed(2)),
                datastreams: datastreams.length,
                nonZeroIntervals: nonZeroCount,
                publishStatus,
            });

            if (publishResponse) {
                console.log(`[WF] endpoint=${publishResponse.endpoint} status=${publishResponse.statusCode} sentRows=${publishResponse.sentRows} sentDatastreams=${publishResponse.uniqueDatastreams}`);
                if (publishResponse.body) {
                    console.log(`[WF] body=${publishResponse.body}`);
                }
            }

            if (nonZeroCount > 0) {
                for (const ds of datastreams) {
                    const total = totalsByDatastream.get(ds.id) || 0;
                    if (total !== 0) {
                        console.log(`[DS] ${ds.key} | id=${ds.id} | total=${Number(total.toFixed(2))}`);
                    }
                }
            }

            console.log(`[CHECKS_SOURCE] qhField=${filled.checksSourceCounts.quarterHourField} | menuFallback=${filled.checksSourceCounts.menuItemsFallback} | strictZero=${filled.checksSourceCounts.strictZero} | menuSplitByChannel=${filled.checksSourceCounts.menuItemsSplitByChannel}`);

            if (args.printRaw) {
                console.log(JSON.stringify(data, null, 2));
                if (filled.missingDatastreamKeys.length) {
                    console.log(`[RAW] Missing RVC datastream keys: ${filled.missingDatastreamKeys.join(', ')}`);
                }
            }

            // MANDA A LLAMAR SYNC_PRODUCT_COUNTS AUTO
            console.log(`Paso 4: Enviando Sales Counts (Product Counts) para locRef=${loc.locRef}...`);
            const countArgs = [
                path.join(__dirname, 'sync_product_counts.js'),
                '--locRef', loc.locRef,
                '--date', args.busDate,
                '--tz', args.tz,
                '--wf-location', locationKey
            ];
            if (args.publish) countArgs.push('--publish');
            if (args.printRaw) countArgs.push('--raw');

            const countResult = spawnSync(process.execPath, countArgs, {
                stdio: 'inherit',
                env: process.env
            });
            if (countResult.status !== 0) {
                console.error(`[WAR] Falla en sync_product_counts.js para locRef=${loc.locRef}`);
            }

        } catch (err) {
            summary.push({
                locRef: loc.locRef,
                name: loc.name,
                normalizedName: normalized,
                matchedLocationKey: locationKey,
                datastreamMatch: hasDatastream,
                ok: false,
                error: err.message,
            });

            console.error(`[ERR] ${loc.locRef} | ${loc.name} | ${err.message}`);
            traceStep(TRACE_FILE, 'location.error', {
                locRef: loc.locRef,
                oracleName: loc.name,
                error: err.message,
            });
        }
    }

    const okCount = summary.filter((x) => x.ok).length;
    const failCount = summary.length - okCount;
    const noDatastreamMatch = summary.filter((x) => x.ok && !x.datastreamMatch).length;
    const noDatastreamMatchWithData = summary.filter((x) => x.ok && x.hasData && !x.datastreamMatch).length;
    const publishedCount = summary.filter((x) => x.ok && String(x.publishStatus || '').startsWith('published')).length;

    console.log('');
    console.log('--- Summary ---');
    console.log(`Processed: ${summary.length}`);
    console.log(`Success:   ${okCount}`);
    console.log(`Failed:    ${failCount}`);
    console.log(`Published: ${publishedCount}`);
    console.log(`No DS map: ${noDatastreamMatch}`);
    console.log(`No DS map with data: ${noDatastreamMatchWithData}`);

    const outPath = `sync_stats_summary_${Date.now()}.json`;
    require('fs').writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`Summary file: ${outPath}`);
    traceStep(TRACE_FILE, 'sync_stats_all_stores.finish', {
        processed: summary.length,
        success: okCount,
        failed: failCount,
        published: publishedCount,
        summaryFile: outPath,
    });
}

run().catch((err) => {
    console.error('Fatal error:', err.message || err);
    process.exitCode = 1;
});
