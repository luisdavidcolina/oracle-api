const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ensureTraceFile, traceStep } = require('../utils/trace.utils');

function parseArgs(argv) {
    const args = {
        date: '',
        locRef: '',
        tz: '',
        wfLocation: '',
        hasExplicitWfLocation: false,
        max: '',
        publish: false,
        raw: false,
        debugLocations: false,
        allOrderTypes: false,
        debugPrefix: '',
        debugLimit: '',
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--date' && argv[i + 1]) args.date = String(argv[++i]);
        else if (a === '--locRef' && argv[i + 1]) args.locRef = String(argv[++i]);
        else if (a === '--tz' && argv[i + 1]) args.tz = String(argv[++i]);
        else if (a === '--wf-location' && argv[i + 1]) {
            args.wfLocation = String(argv[++i]).toLowerCase();
            args.hasExplicitWfLocation = true;
        }
        else if (a === '--max' && argv[i + 1]) args.max = String(argv[++i]);
        else if (a === '--publish') args.publish = true;
        else if (a === '--raw') args.raw = true;
        else if (a === '--debug-locations') args.debugLocations = true;
        else if (a === '--all-order-types') args.allOrderTypes = true;
        else if (a === '--debug-prefix' && argv[i + 1]) args.debugPrefix = String(argv[++i]).toLowerCase();
        else if (a === '--debug-limit' && argv[i + 1]) args.debugLimit = String(argv[++i]);
    }

    return args;
}

function printUsage() {
    console.log('Usage:');
    console.log('  node src/scripts/sync_oracle_all_metrics.js --date 2026-03-19 [--locRef 29402] [--publish] [--tz -04:00] [--wf-location macysponce]');
    console.log('');
    console.log('Optional debug flags:');
    console.log('  --raw --debug-locations --all-order-types --debug-prefix espressodrinks --debug-limit 200');
}

function printStep1MappingSummary(rows) {
    console.log('');
    console.log('--- Step 1 Mapping Summary ---');
    for (const row of rows) {
        const locRef = String(row?.locRef || '(none)');
        const name = String(row?.name || '(no-name)');
        const wf = String(row?.matchedLocationKey || '(none)');
        const ds = Number(row?.datastreamsCount || 0);
        const sales = Number(row?.totalSales || 0).toFixed(2);
        const checks = Number(row?.totalChecks || 0).toFixed(2);
        const ok = row?.ok ? 'ok' : 'err';
        console.log(`[MAP][${ok}] locRef=${locRef} | name=${name} | wf=${wf} | ds=${ds} | sales=${sales} | checks=${checks}`);
    }
}

function listStatsSummaryFiles() {
    return fs
        .readdirSync(process.cwd())
        .filter((name) => /^sync_stats_summary_\d+\.json$/.test(name));
}

function pickNewOrLatestSummary(beforeFiles, afterFiles) {
    const beforeSet = new Set(beforeFiles);
    const newFiles = afterFiles.filter((f) => !beforeSet.has(f));
    const candidates = newFiles.length ? newFiles : afterFiles;
    if (!candidates.length) return '';

    return candidates
        .slice()
        .sort((a, b) => {
            const an = Number((a.match(/(\d+)/) || [0, 0])[1]);
            const bn = Number((b.match(/(\d+)/) || [0, 0])[1]);
            return bn - an;
        })[0];
}

function resolveWfLocationFromSummary(summaryFile, locRef) {
    if (!summaryFile) return '';
    const fullPath = path.join(process.cwd(), summaryFile);
    if (!fs.existsSync(fullPath)) return '';

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {
        return '';
    }

    const rows = Array.isArray(parsed) ? parsed : [];
    const row = rows.find((x) => String(x?.locRef || '') === String(locRef || '')) || rows[0];
    return String(row?.matchedLocationKey || '').toLowerCase();
}

function runNodeScript(scriptPath, scriptArgs, stepName, traceFile) {
    console.log('');
    console.log(`=== ${stepName} ===`);
    traceStep(traceFile, 'child.start', { stepName, scriptPath, args: scriptArgs });
    const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
        stdio: 'inherit',
        env: {
            ...process.env,
            SYNC_TRACE_FILE: traceFile,
        },
    });

    if (result.error) {
        throw result.error;
    }

    const exitCode = Number(result.status || 0);
    if (exitCode !== 0) {
        traceStep(traceFile, 'child.fail', { stepName, exitCode });
        throw new Error(`${stepName} failed with exit code ${exitCode}`);
    }
    traceStep(traceFile, 'child.done', { stepName, exitCode });
}

function buildStatsArgs(args) {
    const out = [];
    if (args.date) out.push('--date', args.date);
    if (args.locRef) out.push('--locRef', args.locRef);
    if (args.tz) out.push('--tz', args.tz);
    if (args.max) out.push('--max', args.max);
    if (args.publish) out.push('--publish');
    if (args.raw) out.push('--raw');
    if (args.debugLocations) out.push('--debug-locations');
    return out;
}

function buildSalesCountArgs(args) {
    const out = [];
    if (args.locRef) out.push('--locRef', args.locRef);
    if (args.date) out.push('--date', args.date);
    out.push('--wf-location', args.wfLocation || 'macysponce');
    if (args.tz) out.push('--tz', args.tz);
    if (args.publish) out.push('--publish');
    if (args.raw) out.push('--raw');
    if (args.allOrderTypes) out.push('--all-order-types');
    if (args.debugPrefix) out.push('--debug-prefix', args.debugPrefix);
    if (args.debugLimit) out.push('--debug-limit', args.debugLimit);
    return out;
}

function run() {
    const args = parseArgs(process.argv);
    const traceFile = ensureTraceFile('sync_oracle_all_metrics');

    const statsScript = path.join(__dirname, 'sync_stats_all_stores.js');
    const countsScript = path.join(__dirname, 'sync_product_counts.js');

    console.log('--- Sync Oracle All Metrics ---');
    console.log(`Fecha: ${args.date || '(env/default)'}`);
    console.log(`Alcance: ${args.locRef ? `locRef=${args.locRef}` : 'todas las locaciones'}`);
    console.log(`Modo: ${args.publish ? 'publish' : 'dry-run'}`);
    console.log('Flujo:');
    console.log('  1) Buscar locaciones Oracle y mapearlas a Workforce');
    console.log('  2) Correr Sales Count por cada locacion mapeada');
    console.log(`WF location manual: ${args.wfLocation || '(auto desde step 1)'}`);
    console.log(`Trace file: ${traceFile}`);

    traceStep(traceFile, 'sync_oracle_all_metrics.start', {
        date: args.date || '',
        locRef: args.locRef || '',
        publish: args.publish,
        wfLocationInput: args.wfLocation || '',
    });
    if (args.max) {
        console.log(`note: --max was provided (${args.max}) and will limit step 1 only`);
    }

    const summaryFilesBefore = listStatsSummaryFiles();
    runNodeScript(statsScript, buildStatsArgs(args), 'STEP 1/2 - Sales & Checks', traceFile);

    const summaryFilesAfter = listStatsSummaryFiles();
    const summaryFile = pickNewOrLatestSummary(summaryFilesBefore, summaryFilesAfter);
    const matchedFromStep1 = resolveWfLocationFromSummary(summaryFile, args.locRef);

    if (!args.hasExplicitWfLocation) {
        args.wfLocation = matchedFromStep1 || 'macysponce';
    }

    console.log(`wf-location fallback for step 2: ${args.wfLocation || '(none)'}`);
    if (summaryFile) {
        console.log(`step 1 summary used: ${summaryFile}`);
    }

    const fullSummaryPath = summaryFile ? path.join(process.cwd(), summaryFile) : '';
    if (!fullSummaryPath || !fs.existsSync(fullSummaryPath)) {
        throw new Error('STEP 2/2 - Sales Count cannot continue: summary file from step 1 not found.');
    }

    let parsedSummary;
    try {
        parsedSummary = JSON.parse(fs.readFileSync(fullSummaryPath, 'utf8'));
    } catch {
        throw new Error('STEP 2/2 - Sales Count cannot continue: invalid summary JSON from step 1.');
    }

    const allRows = Array.isArray(parsedSummary) ? parsedSummary : [];
    printStep1MappingSummary(allRows);

    const targetRows = allRows.filter((row) => {
        if (!row?.ok) return false;
        if (!row?.locRef) return false;
        if (args.locRef && String(row.locRef) !== String(args.locRef)) return false;
        return true;
    });

    if (!targetRows.length) {
        throw new Error('STEP 2/2 - Sales Count found no valid locations from step 1 summary.');
    }

    console.log(`step 2 target locations: ${targetRows.length}`);

    let step2Ok = 0;
    let step2Fail = 0;
    let step2Skip = 0;

    for (const row of targetRows) {
        const rowLocRef = String(row.locRef);
        const rowWfLocation = args.hasExplicitWfLocation
            ? args.wfLocation
            : String(row.matchedLocationKey || args.wfLocation || '').toLowerCase();

        const rowDatastreamsCount = Number(row.datastreamsCount || 0);

        if (!args.hasExplicitWfLocation && rowDatastreamsCount <= 0) {
            console.log(`[STEP2][SKIP] locRef=${rowLocRef} | wf=${rowWfLocation || '(none)'} (no datastreams matched in step 1)`);
            step2Skip += 1;
            continue;
        }

        if (!rowWfLocation) {
            console.log(`[STEP2][SKIP] locRef=${rowLocRef} (missing wf-location)`);
            step2Skip += 1;
            continue;
        }

        const step2Args = {
            ...args,
            locRef: rowLocRef,
            wfLocation: rowWfLocation,
        };

        try {
            runNodeScript(
                countsScript,
                buildSalesCountArgs(step2Args),
                `STEP 2/2 - Sales Count | locRef=${rowLocRef} | wf=${rowWfLocation}`,
                traceFile
            );
            step2Ok += 1;
        } catch (err) {
            console.error(`[STEP2][ERR] locRef=${rowLocRef} | wf=${rowWfLocation} | ${err.message || err}`);
            step2Fail += 1;
        }
    }

    console.log('');
    console.log('--- Step 2 Summary ---');
    console.log(`Locations processed: ${targetRows.length}`);
    console.log(`Success: ${step2Ok}`);
    console.log(`Skipped: ${step2Skip}`);
    console.log(`Failed: ${step2Fail}`);

    if (step2Fail > 0) {
        throw new Error(`STEP 2/2 - Sales Count had failures (${step2Fail}).`);
    }

    console.log('');
    console.log('Combined sync completed successfully.');
    traceStep(traceFile, 'sync_oracle_all_metrics.finish', {
        locationsProcessed: targetRows.length,
        success: step2Ok,
        skipped: step2Skip,
        failed: step2Fail,
    });
}

try {
    run();
} catch (err) {
    console.error('Combined sync failed:', err.message || err);
    process.exitCode = 1;
}
