const { runFlow, env_orgIdentifier } = require('../../auth');
const datastreamMap = require('../config/datastreams.json');

const BI_BASE_URL = process.env.ORACLE_BI_BASE_URL || 'https://sbx5-omra.oracleindustry.com';
const APP_NAME = process.env.ORACLE_APP_NAME || 'Postman Testing';
const BUS_DATE = process.env.ORACLE_BUS_DATE || new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
    const args = {
        locRef: '',
        busDate: BUS_DATE,
        wfLocation: 'macysponce',
        top: 20,
        raw: false,
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--locRef' && argv[i + 1]) args.locRef = String(argv[++i]);
        else if (a === '--date' && argv[i + 1]) args.busDate = String(argv[++i]);
        else if (a === '--wf-location' && argv[i + 1]) args.wfLocation = String(argv[++i]).toLowerCase();
        else if (a === '--top' && argv[i + 1]) args.top = Number(argv[++i]);
        else if (a === '--raw') args.raw = true;
    }

    return args;
}

function printUsage() {
    console.log('Usage:');
    console.log('  node src/scripts/validate_menuitem_categories.js --locRef 29402 --date 2026-02-23 --wf-location macysponce [--top 20] [--raw]');
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
        throw new Error(`${endpoint} failed (${response.status}): ${text.slice(0, 400)}`);
    }

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

function resolveCategoryPrefix(rawCategoryName) {
    const n = normalizeText(rawCategoryName);
    if (!n) return '';

    const skipPatterns = [
        'option',
        'syrup',
        'sauce',
        'addon',
        'add-on',
        'foam',
        'milkbase',
        'confection',
        'dairy',
        'preparationservingoption',
    ];
    if (skipPatterns.some((p) => n.includes(normalizeText(p)))) {
        return '__skip__';
    }

    const byContains = [
        ['brewedcoffee', ['coffeecoldbrew', 'coldbrew']],
        ['brewedcoffee', ['coffeebrewedcoffee', 'brewedcoffee']],
        ['blendedbeverages', ['frappuccinocremefrappuccino', 'frappuccino', 'blendedbeverages', 'blendedbeverage']],
        ['tea', ['tea&shaken', 'teaandshaken', 'tea']],
        ['sand/ppdfood', ['lunchsandwich', 'breakfastsandwich', 'sand/ppdfood', 'sandppdfood', 'sandwichpreparedfood', 'sandwich', 'preparedfood']],
        ['bakery', ['bakery', 'bagel', 'cake', 'laminatedpastry', 'bread', 'muffin', 'loaf', 'danish', 'croissant']],
        ['packagedfood', ['snackchips', 'snackbar', 'snackdip', 'lunchproteinbox', 'packagedfood', 'yogurtparfait', 'breakfastyogurt']],
        ['otherbeverages', ['ready-to-drink', 'readytodrink', 'juice', 'water', 'otherbeverages', 'otherbeverage']],
        ['sand/ppdfood', ['sand/ppdfood', 'sandppdfood', 'sandwichpreparedfood', 'sandwich', 'preparedfood']],
        ['blendedbeverages', ['blendedbeverages', 'blendedbeverage']],
        ['brewedcoffee', ['brewedcoffee']],
        ['brewing', ['brewing']],
        ['espressodrinks', ['espressodrinks', 'espresso']],
        ['otherbeverages', ['otherbeverages', 'otherbeverage']],
        ['packagedfood', ['packagedfood']],
        ['retailcoffee', ['retailcoffee']],
        ['retailtea', ['retailtea']],
        ['serveware', ['serveware']],
        ['bakery', ['bakery']],
    ];

    for (const [prefix, patterns] of byContains) {
        if (patterns.some((p) => n.includes(normalizeText(p)))) {
            return prefix;
        }
    }

    return '';
}

function getDatastreamIdForCategory(prefix, wfLocation) {
    const key = `${prefix}(${wfLocation})`;
    return { key, id: datastreamMap[key] || null };
}

function flattenMenuItemsFromDailyTotals(payload) {
    const out = [];
    const rvcs = Array.isArray(payload?.revenueCenters) ? payload.revenueCenters : [];

    for (const rvc of rvcs) {
        const items = Array.isArray(rvc?.menuItems) ? rvc.menuItems : [];
        for (const mi of items) {
            out.push(mi);
        }
    }

    return out;
}

async function run() {
    const args = parseArgs(process.argv);
    if (!args.locRef) {
        console.error('Missing required --locRef');
        printUsage();
        process.exitCode = 1;
        return;
    }

    console.log('--- Validate MenuItem Categories ---');
    console.log(`locRef: ${args.locRef}`);
    console.log(`date: ${args.busDate}`);
    console.log(`wf-location: ${args.wfLocation}`);

    const tokenData = await runFlow();
    if (!tokenData?.access_token) {
        throw new Error('Auth failed: no access token');
    }

    const accessToken = tokenData.access_token;

    const dimensions = await queryBi(accessToken, 'getMenuItemDimensions', {
        applicationName: APP_NAME,
        locRef: args.locRef,
    });

    const dailyTotals = await queryBi(accessToken, 'getMenuItemDailyTotals', {
        applicationName: APP_NAME,
        locRef: args.locRef,
        busDt: args.busDate,
        include: 'locRef,busDt,revenueCenters',
    });

    const dimItems = extractArray(dimensions, 'menuItems');
    const totalItems = flattenMenuItemsFromDailyTotals(dailyTotals);

    const dimByMiNum = new Map();
    for (const d of dimItems) {
        const miNum = Number(d?.miNum || d?.menuItemNum || d?.num);
        if (!Number.isFinite(miNum)) continue;
        dimByMiNum.set(miNum, d);
    }

    const aggByPrefix = new Map();
    const unknown = [];
    const unknownByCategory = new Map();
    const skippedByCategory = new Map();
    let skippedRows = 0;

    for (const row of totalItems) {
        const miNum = Number(row?.miNum || row?.menuItemNum || row?.num);
        const dim = dimByMiNum.get(miNum) || {};

        const categoryName = pickFirst(dim, [
            'famGrpName',
            'familyGroupName',
            'famGrp',
            'familyName',
            'className',
            'reportGroupName',
        ]);

        const prefix = resolveCategoryPrefix(categoryName);
        const sales = Number(row?.slsTtl || 0);
        const count = Number(row?.slsCnt || 0);

        if (prefix === '__skip__') {
            skippedRows += 1;
            const currentSkipped = skippedByCategory.get(categoryName || '(empty)') || 0;
            skippedByCategory.set(categoryName || '(empty)', currentSkipped + 1);
            continue;
        }

        if (!prefix) {
            unknown.push({ miNum, categoryName });
            const current = unknownByCategory.get(categoryName || '(empty)') || 0;
            unknownByCategory.set(categoryName || '(empty)', current + 1);
            continue;
        }

        const current = aggByPrefix.get(prefix) || {
            prefix,
            categoryName,
            sales: 0,
            count: 0,
            items: 0,
        };

        current.sales += sales;
        current.count += count;
        current.items += 1;
        aggByPrefix.set(prefix, current);
    }

    const rows = [...aggByPrefix.values()].sort((a, b) => b.count - a.count);

    console.log(`menuItemDimensions rows: ${dimItems.length}`);
    console.log(`menuItemDailyTotals rows: ${totalItems.length}`);
    console.log('');
    console.log('--- Category Match vs Datastreams ---');

    for (const r of rows.slice(0, args.top > 0 ? args.top : rows.length)) {
        const ds = getDatastreamIdForCategory(r.prefix, args.wfLocation);
        console.log(
            `[CAT] ${r.prefix} | ds=${ds.key} | id=${ds.id || '(missing)'} | sales=${r.sales.toFixed(2)} | count=${r.count}`
        );
    }

    console.log('');
    console.log(`Skipped rows (modifier/options): ${skippedRows}`);
    if (skippedRows > 0) {
        const topSkippedCategories = [...skippedByCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        for (const [cat, qty] of topSkippedCategories) {
            console.log(`[SKIPPED_CAT] ${cat} | rows=${qty}`);
        }
        console.log('');
    }

    console.log(`Unknown category rows (no prefix map): ${unknown.length}`);
    if (unknown.length) {
        const preview = unknown.slice(0, 20);
        for (const u of preview) {
            console.log(`[UNKNOWN] miNum=${u.miNum || '(none)'} | category='${u.categoryName || ''}'`);
        }
        if (unknown.length > preview.length) {
            console.log(`... +${unknown.length - preview.length} more`);
        }

        const topUnknownCategories = [...unknownByCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        if (topUnknownCategories.length) {
            console.log('Top unknown categories:');
            for (const [cat, qty] of topUnknownCategories) {
                console.log(`[UNKNOWN_CAT] ${cat} | rows=${qty}`);
            }
        }
    }

    if (args.raw) {
        console.log('');
        console.log('--- RAW getMenuItemDimensions ---');
        console.log(JSON.stringify(dimensions, null, 2));
        console.log('--- RAW getMenuItemDailyTotals ---');
        console.log(JSON.stringify(dailyTotals, null, 2));
    }
}

run().catch((err) => {
    console.error('Fatal error:', err.message || err);
    process.exitCode = 1;
});
