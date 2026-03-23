function makeCorrelationId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function log(evt, payload) {
    const line = JSON.stringify({
        ts: new Date().toISOString(),
        service: 'queryGateway',
        evt,
        ...payload,
    });
    // Railway recoge stdout
    if (evt === 'finish' && payload.ok === false) {
        console.error(line);
    } else {
        console.log(line);
    }
}

module.exports = { log, makeCorrelationId };
