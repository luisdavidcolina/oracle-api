const { runFlow, env_orgIdentifier } = require('../../auth');

const BI_BASE_URL = process.env.ORACLE_BI_BASE_URL || 'https://sbx5-omra.oracleindustry.com';
const APP_NAME = process.env.ORACLE_APP_NAME || 'Postman Testing';

async function getRevenueCenterDimensions(accessToken, locRef) {
    const url = `${BI_BASE_URL}/bi/v1/${env_orgIdentifier}/getRevenueCenterDimensions`;
    const body = {
        applicationName: APP_NAME,
        locRef: locRef
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
    if (!response.ok) {
        throw new Error(`Query failed for locRef ${locRef} (${response.status}): ${text.slice(0, 300)}`);
    }

    return JSON.parse(text);
}

async function run() {
    const locRef = process.argv[2] || '4000004'; // Puedes pasar el locRef como argumento (e.g., node script.js 29402)
    
    console.log('--- Obteniendo Nombres de Revenue Centers ---');
    console.log(`Locación: ${locRef}`);
    
    console.log('1. Autenticando...');
    const tokenData = await runFlow();
    if (!tokenData?.access_token) {
        throw new Error('Falló la autenticación. No se pudo obtener el token.');
    }

    console.log(`2. Consultando endpoint getRevenueCenterDimensions...`);
    const data = await getRevenueCenterDimensions(tokenData.access_token, locRef);
    
    const rvcs = data.revenueCenters || data.items || data.records || [];
    
    if (rvcs.length === 0) {
        console.log('No se encontraron Revenue Centers en la respuesta o el formato es distinto:');
        console.log(JSON.stringify(data, null, 2).slice(0, 500) + '...');
        return;
    }

    console.log('\n=== Revenue Centers Encontrados ===');
    const tableData = rvcs.map(r => ({
        rvcNum: r.rvcNum || r.id || r.locRef,
        rvcName: r.name || r.description || r.rvcName || 'N/A'
    }));
    
    console.table(tableData);
    console.log('\n========================================================================');
    console.log('Por favor, ejecuta el script (o usa esta tabla) para indicarme qué número es Café, cuál es DT y cuál es Digital.');
}

run().catch(err => {
    console.error('Error:', err.message);
});
