const fs = require('fs');
const path = require('path');
const { processAndSendData } = require('../services/workforce.service');

function parseArgs(argv) {
    const args = {
        file: 'mocks/ejemplo.json',
        location: 'auxiliomutuo',
        businessDate: null,
        endTime: null,
    };

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--file' && argv[i + 1]) args.file = argv[++i];
        else if (a === '--location' && argv[i + 1]) args.location = argv[++i];
        else if (a === '--businessDate' && argv[i + 1]) args.businessDate = argv[++i];
        else if (a === '--endTime' && argv[i + 1]) args.endTime = argv[++i];
    }

    return args;
}

async function run() {
    const args = parseArgs(process.argv);
    const fullPath = path.resolve(args.file);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`Input file not found: ${fullPath}`);
    }

    const input = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    if (!Array.isArray(input)) {
        throw new Error('Input JSON must be an array of records.');
    }

    console.log('--- Verify Workforce Publish From Mock ---');
    console.log(`File: ${fullPath}`);
    console.log(`Location: ${args.location}`);

    const result = await processAndSendData(
        input,
        String(args.location).toLowerCase(),
        {
            filenameBusinessDate: args.businessDate,
            filenameEndTime: args.endTime,
        }
    );

    console.log('--- Publish Result ---');
    console.log(`Status: ${result.status}`);
    console.log(`Totals.sales: ${result.totals.sales}`);
    console.log(`Totals.checks: ${result.totals.checks}`);
    console.log(`Stats payload size: ${result.json?.stats?.length || 0}`);
    console.log('Publish call finished without throw (200/201 expected by service).');
}

run().catch((err) => {
    console.error('Publish verification failed:', err.message || err);
    process.exitCode = 1;
});
