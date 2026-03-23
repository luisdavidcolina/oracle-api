const readline = require('readline');
const request = require('request');
const fs = require('fs');
const path = require('path');
const { DEFAULT_WORKFORCE_TOKEN } = require('../config/constants');
const datastreamMap = require('../config/datastreams.json');

const WF_TOKEN = process.env.WORKFORCE_TOKEN || DEFAULT_WORKFORCE_TOKEN;
const WF_BASE_URL = 'https://staging.workforce.com'; // Usando staging porque las pruebas se enviaron allí

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const preguntar = (pregunta) => new Promise(resolve => rl.question(pregunta, resolve));

function getStatsWorkforce(datastreamId, fromDate, toDate) {
    return new Promise((resolve, reject) => {
        const url = `${WF_BASE_URL}/api/v2/storestats/for_datastream/${datastreamId}?from=${fromDate}&to=${toDate}`;
        const options = {
            method: 'GET',
            url: url,
            headers: {
                Authorization: 'bearer ' + WF_TOKEN
            }
        };

        request(options, function (error, response) {
            if (error) {
                return reject(error);
            }
            if (response.statusCode === 200) {
                try {
                    const data = JSON.parse(response.body);
                    resolve(data);
                } catch (e) {
                    reject(new Error("Invalid JSON: " + response.body));
                }
            } else {
                reject(new Error(`API Error ${response.statusCode}: ${response.body}`));
            }
        });
    });
}

function formatDateAPI(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function validateData() {
    console.log('===========================================================');
    console.log('   Validador de Datos en Workforce (Via API)             ');
    console.log('===========================================================');

    try {
        const todayStr = formatDateAPI(new Date()).replace(/-/g, '');
        let locName = await preguntar('Ingresa el local (nombre en workforce, ej: zpurtestlab) [default: zpurtestlab]: ');
        locName = locName.trim() || 'zpurtestlab';

        let dateStr = await preguntar(`Ingresa la fecha a validar (Formato YYYYMMDD) [default: ${todayStr}]: `);
        dateStr = dateStr.trim() || todayStr;

        if (dateStr.length !== 8) {
            console.error('Formato de fecha inválido. Debe ser YYYYMMDD.');
            process.exit(1);
        }

        const y = parseInt(dateStr.substring(0, 4), 10);
        const m = parseInt(dateStr.substring(4, 6), 10) - 1;
        const d = parseInt(dateStr.substring(6, 8), 10);
        const targetDateObj = new Date(y, m, d);

        const prev = new Date(targetDateObj); prev.setDate(prev.getDate() - 1);
        const next = new Date(targetDateObj); next.setDate(next.getDate() + 1);
        
        const fromDate = formatDateAPI(prev);
        const toDate = formatDateAPI(next);
        const targetDateDDMMYYYY = `${String(targetDateObj.getDate()).padStart(2, '0')}/${String(targetDateObj.getMonth() + 1).padStart(2, '0')}/${targetDateObj.getFullYear()}`;

        console.log(`\n>>> Consultando rango en la API: ${fromDate} a ${toDate}`);
        console.log(`>>> Filtrando resultados para la fecha local: ${targetDateDDMMYYYY} (GMT: -04:00)`);

        // Identificar DataStreams para este local de nuestro map local
        const streamsToQuery = [];
        const base = locName.trim().toLowerCase().replace(/\s+/g, '');
        
        for (const [key, id] of Object.entries(datastreamMap)) {
            // Buscamos cualquier datastream que pertenezca a este local
            if (key.includes(`(${base}`)) {
                let sType = 'sales count';
                if (key.startsWith('sales(')) sType = 'sales';
                if (key.startsWith('checks(')) sType = 'checks';

                streamsToQuery.push({
                    id: id,
                    name: key,
                    type: sType
                });
            }
        }

        if (streamsToQuery.length === 0) {
            console.error(`\nNo se encontraron DataStreams mapeados para el local: ${locName} en datastreams.json`);
            process.exit(1);
        }

        console.log('\n' + '='.repeat(60));
        console.log(`| ${'DATASTREAM'.padEnd(35)} | ${'TOTAL STAT'.padStart(20)} |`);
        console.log('-'.repeat(60));

        // Ordenar streams para que salgan pareados (sales y checks)
        streamsToQuery.sort((a, b) => a.name.localeCompare(b.name));

        for (const stream of streamsToQuery) {
            try {
                const allStats = await getStatsWorkforce(stream.id, fromDate, toDate);
                
                let total = 0;
                let countFound = 0;

                // En algunos endpoints retorna { results: [...] } o directo [...]
                const statsArray = Array.isArray(allStats) ? allStats : (allStats.results || []);

                if (Array.isArray(statsArray)) {
                    const filteredStats = statsArray.filter(s => {
                        // El s.time es epoch en SEGUNDOS
                        // Ajustamos a GMT-4 (-04:00)
                        const tzOffsetHours = -4; 
                        const dateInTZ = new Date((s.time * 1000) + (tzOffsetHours * 3600 * 1000));
                        
                        const localD = String(dateInTZ.getUTCDate()).padStart(2, '0');
                        const localM = String(dateInTZ.getUTCMonth() + 1).padStart(2, '0');
                        const localY = dateInTZ.getUTCFullYear();
                        const localDateStr = `${localD}/${localM}/${localY}`;
                        
                        return localDateStr === targetDateDDMMYYYY;
                    });

                    countFound = filteredStats.length;
                    total = filteredStats.reduce((acc, curr) => acc + (parseFloat(curr.stat) || 0), 0);
                }

                let totalStr = '';
                if (stream.type === 'sales') {
                    totalStr = `$${total.toFixed(2)}`;
                } else if (stream.type === 'checks') {
                    totalStr = total.toString() + ' (chk)';
                } else {
                    totalStr = total.toString() + ' (item)';
                }
                console.log(`| ${stream.name.padEnd(35)} | ${totalStr.padStart(20)} |`);

            } catch (err) {
                console.log(`| ${stream.name.padEnd(35)} | ${'ERROR AL CONSULTAR'.padStart(20)} |`);
                console.error(`  -> Error: ${err.message}`);
            }
        }

        console.log('='.repeat(60));
        console.log('\nConsulta de API finalizada.');

    } catch (err) {
        console.error(`Error durante la validación: ${err.message}`);
    } finally {
        rl.close();
    }
}

validateData();
