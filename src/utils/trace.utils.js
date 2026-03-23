const fs = require('fs');
const path = require('path');

function ensureTraceFile(scriptName = 'sync') {
    if (process.env.SYNC_TRACE_FILE) {
        return process.env.SYNC_TRACE_FILE;
    }

    const logsDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const stamp = Date.now();
    return path.join(logsDir, `${scriptName}_${stamp}.log`);
}

function safePreview(value, maxLen = 6000) {
    if (value === undefined || value === null) return '';
    let text;
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch {
            text = String(value);
        }
    }
    return text.length > maxLen ? `${text.slice(0, maxLen)}...<truncated>` : text;
}

function appendTrace(traceFile, level, message, extra = {}) {
    try {
        const row = {
            ts: new Date().toISOString(),
            level,
            message,
            ...extra,
        };
        fs.appendFileSync(traceFile, `${JSON.stringify(row)}\n`);
    } catch {
        // never break execution by logging failures
    }
}

function traceStep(traceFile, message, extra = {}) {
    appendTrace(traceFile, 'step', message, extra);
}

function traceApi(traceFile, payload = {}) {
    const apiLog = {
        apiName: payload.apiName || '',
        method: payload.method || '',
        url: payload.url || '',
        requestBody: safePreview(payload.requestBody),
        statusCode: payload.statusCode || null,
        responseBody: safePreview(payload.responseBody),
        ok: payload.ok !== false,
        error: payload.error ? safePreview(payload.error) : '',
    };
    appendTrace(traceFile, 'api', 'api-call', apiLog);
}

module.exports = {
    ensureTraceFile,
    traceStep,
    traceApi,
};
