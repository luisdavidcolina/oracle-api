const request = require('request');
const { WORKFORCE_API_URL } = require('../config/constants');
const { ensureTraceFile, traceApi } = require('../utils/trace.utils');

const TRACE_FILE = ensureTraceFile('sync_api');

function publishDataStreamToWorkforce(jsonDataStream, token) {
    return new Promise((resolve, reject) => {
        const stats = Array.isArray(jsonDataStream?.stats) ? jsonDataStream.stats : [];
        const uniqueDatastreamIds = new Set(
            stats
                .map((s) => Number(s?.datastream_id))
                .filter((id) => Number.isFinite(id))
        );

        const options = {
            'method': 'POST',
            'url': WORKFORCE_API_URL,
            'headers': {
                'Authorization': 'bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(jsonDataStream)
        };

        request(options, function (error, response) {
            if (error) {
                console.error(error);
                traceApi(TRACE_FILE, {
                    apiName: 'workforce.publishDataStream',
                    method: 'POST',
                    url: WORKFORCE_API_URL,
                    requestBody: jsonDataStream,
                    ok: false,
                    error: error.message || String(error),
                });
                reject(error);
            } else {
                if (response.statusCode == 200 || response.statusCode == 201) {
                    traceApi(TRACE_FILE, {
                        apiName: 'workforce.publishDataStream',
                        method: 'POST',
                        url: WORKFORCE_API_URL,
                        requestBody: jsonDataStream,
                        statusCode: response.statusCode,
                        responseBody: response.body,
                        ok: true,
                    });
                    resolve({
                        ok: true,
                        statusCode: response.statusCode,
                        body: String(response.body || '').slice(0, 800),
                        endpoint: WORKFORCE_API_URL,
                        sentRows: stats.length,
                        uniqueDatastreams: uniqueDatastreamIds.size,
                    });
                } else {
                    traceApi(TRACE_FILE, {
                        apiName: 'workforce.publishDataStream',
                        method: 'POST',
                        url: WORKFORCE_API_URL,
                        requestBody: jsonDataStream,
                        statusCode: response.statusCode,
                        responseBody: response.body,
                        ok: false,
                        error: `Unexpected status ${response.statusCode}`,
                    });
                    reject(new Error(`ERROR: STATUS CODE NOT EXPECTED : ${response.statusCode} | BODY: ${String(response.body || '').slice(0, 800)}`));
                }
            }
        });
    });
}

function createDatastreamInWorkforce(name, type, token) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(WORKFORCE_API_URL);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
            const createUrl = `${baseUrl}/api/v2/datastreams`;

            // Definir el tipo de stat principal
            let defaultStatType = 'sales';
            if (typeof type === 'string' && type.toLowerCase().includes('check')) {
                defaultStatType = 'checks';
            }

            // Siempre usar 900 (15 minutos) como data_interval
            const payload = {
                name,
                data_interval: 900,
                default_stat_type: defaultStatType
            };

            const options = {
                method: 'POST',
                url: createUrl,
                headers: {
                    Authorization: 'bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            };

            request(options, function (error, response) {
                if (error) {
                    console.error(error);
                    reject(error);
                } else {
                    if (response.statusCode == 200 || response.statusCode == 201) {
                        let data;
                        try {
                            data = JSON.parse(response.body);
                        } catch (e) {
                            data = {};
                        }
                        if (data.id) {
                            resolve(data.id);
                        } else {
                            reject(new Error(`Created successfully but no ID returned. Body: ${response.body}`));
                        }
                    } else {
                        reject(new Error(`Failed to create datastream ${name}: ${response.statusCode} | ${response.body}`));
                    }
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    publishDataStreamToWorkforce,
    createDatastreamInWorkforce
};
