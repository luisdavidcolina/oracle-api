const { log, makeCorrelationId } = require('../utils/logger.utils');
const { convertDateTimeToEpoch, convertTimeFormat } = require('../utils/date.utils');
const { publishDataStreamToWorkforce } = require('./api.service');
const { DEFAULT_WORKFORCE_TOKEN } = require('../config/constants');
// Load datastreams dynamically to allow it to be updated easily
let jsonWorkforceDataStreams = {};
try {
    jsonWorkforceDataStreams = require('../config/datastreams.json');
} catch (e) {
    console.warn("datastreams.json not found yet, ensure extract_streams.js was run");
}

function getTypeForDataStream(dataStreamName) {
    const lowerCaseName = (dataStreamName).toLowerCase();
    if (lowerCaseName.includes('count')) {
        return 'sales count';
    } else if (lowerCaseName.includes('checks')) {
        return 'checks';
    } else if (lowerCaseName.includes('sales')) {
        return 'sales';
    } else {
        return 'unknown';
    }
}

async function generateInitialData(workforceStreamsMap, businessDate) {
    const startHour = 6;
    const endHour = 23;
    const minutesInterval = 15;

    const [year, month, day] = businessDate.split('-');
    const formattedDate = `${day}/${month}/${year}`;

    const initialData = [];

    for (const dataStreamName in workforceStreamsMap) {
        const dataStreamId = workforceStreamsMap[dataStreamName];
        const type = getTypeForDataStream(dataStreamName);

        for (let hour = startHour; hour <= endHour; hour++) {
            for (let minute = 0; minute < 60; minute += minutesInterval) {
                const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                const epochTime = await convertDateTimeToEpoch(formattedDate, timeString);

                initialData.push({
                    datastream_id: dataStreamId,
                    time: epochTime,
                    stat: 0,
                    type: type
                });
            }
        }
    }

    return initialData;
}

async function processAndSendData(data, locationName, meta = {}) {
    const { filenameBusinessDate, filenameEndTime } = meta;
    const correlationId = makeCorrelationId();
    const t0 = Date.now();

    log('start', {
        correlationId,
        location: locationName,
        filenameBusinessDate,
        filenameEndTime,
        records: Array.isArray(data) ? data.length : 0,
    });

    try {
        let businessDate;
        let jsonWorkforceDataStream = [];

        // Procesar todos los registros
        for (const x of data) {
            const dataStreamNames = Array.isArray(x['Data Stream Name']) ? x['Data Stream Name'] : [x['Data Stream Name']];
            const dataTypes = Array.isArray(x['Data Type']) ? x['Data Type'] : [x['Data Type']];
            const dataPoints = Array.isArray(x['Data Point']) ? x['Data Point'] : [x['Data Point']];

            businessDate = x.Date;

            let [day, month, year] = businessDate.split('/');
            if (day.length === 1) day = '0' + day;
            if (month.length === 1) month = '0' + month;
            businessDate = `${year}-${month}-${day}`;

            if (!dataStreamNames[0]?.includes('MODIFIERS')) {
                for (let i = 0; i < dataStreamNames.length; i++) {
                    let dataStreamName = typeof dataStreamNames[i] === "string"
                        ? dataStreamNames[i].split(' ').join('').toLowerCase()
                        : '';

                    dataStreamName = dataStreamName.includes('plazamallhumacao')
                        ? dataStreamName.replace('plazamallhumacao', 'plazahumacao')
                        : dataStreamName;

                    dataStreamName = dataStreamName.includes('rivertownplaza')
                        ? dataStreamName.replace('rivertownplaza', 'rivertown')
                        : dataStreamName;

                    let dataStreamId = jsonWorkforceDataStreams[dataStreamName];
                    if (!dataStreamId) {
                        console.error(`Data stream not found in Workforce: ${dataStreamNames[i]}`);
                        continue;
                    }

                    jsonWorkforceDataStream.push({
                        datastream_id: dataStreamId,
                        time: await convertDateTimeToEpoch(x.Date, convertTimeFormat(x.Time)),
                        stat: Number(dataPoints[i]),
                        type: dataTypes[i],
                    });
                }
            }
        }

        // Generar base inicial
        const initialData = await generateInitialData(jsonWorkforceDataStreams, businessDate);

        // Merge con stats reales
        let stats = [];
        for (const storestat of initialData) {
            const index = jsonWorkforceDataStream.findIndex(
                x => x.datastream_id === storestat.datastream_id && x.time === storestat.time
            );
            stats.push(index === -1 ? storestat : jsonWorkforceDataStream[index]);
        }

        const json = { stats };

        // Totales para logging
        const totals = stats.reduce(
            (acc, s) => {
                const t = String(s.type || '').toLowerCase();
                const v = Number(s.stat) || 0;
                if (t === 'sales') acc.sales += v;
                if (t === 'checks') acc.checks += v;
                return acc;
            },
            { sales: 0, checks: 0 }
        );

        const counts = {
            stats: stats.length,
            datastreams: Object.keys(jsonWorkforceDataStreams || {}).length,
        };

        // Publicar en Workforce
        await publishDataStreamToWorkforce(json, DEFAULT_WORKFORCE_TOKEN);

        log('finish', {
            correlationId,
            location: locationName,
            filenameBusinessDate,
            filenameEndTime,
            ok: true,
            totals,
            counts,
            durationMs: Date.now() - t0,
        });

        return {
            status: 'Process completed including the publishing to Workforce API.',
            json,
            totals,
        };
    } catch (err) {
        log('finish', {
            correlationId,
            location: locationName,
            filenameBusinessDate,
            filenameEndTime,
            ok: false,
            error: String(err?.message || err),
            durationMs: Date.now() - t0,
        });
        throw err;
    }
}

module.exports = {
    processAndSendData,
    generateInitialData,
    getTypeForDataStream
};
