const oracleUserService = require('../services/oracle-user.service');

const ENDPOINT_TOKEN = process.env.ORACLE_USER_SYNC_ENDPOINT_TOKEN || '';

function isAuthorized(req) {
    if (!ENDPOINT_TOKEN) return true;

    const rawHeaderToken = req.headers['x-oracle-user-sync-token'];
    const headerToken = Array.isArray(rawHeaderToken) ? rawHeaderToken[0] : rawHeaderToken;
    const auth = req.headers.authorization || '';
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

    return String(headerToken || '').trim() === ENDPOINT_TOKEN || String(bearer || '').trim() === ENDPOINT_TOKEN;
}

const syncOracleUser = async (req, res) => {
    try {
        console.log('[WEBHOOK] Payload recibido:', JSON.stringify(req.body).slice(0, 1000));
        if (!isAuthorized(req)) {
            console.warn('[WEBHOOK] Llamada no autorizada');
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized',
            });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                body = {};
            }
        }

        const result = await oracleUserService.syncOracleUser(body || {});

        console.log('[WEBHOOK] Acción:', result.action, '| Empleado:', result.mapped.externalPayrollID, '| Código Oracle:', result.oracleStatusCode);
        if (result.oracleResponsePreview) {
            console.log('[WEBHOOK] Respuesta Oracle (preview):', result.oracleResponsePreview.slice(0, 400));
        }

        return res.status(200).json({
            status: 'ok',
            action: result.action,
            oracleStatusCode: result.oracleStatusCode,
            employee: {
                externalPayrollID: result.mapped.externalPayrollID,
                firstName: result.mapped.firstName,
                lastName: result.mapped.lastName,
                locationRef: result.mapped.locationRef,
            },
            oracleResponsePreview: result.oracleResponsePreview,
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode) || 400;
        console.error('[WEBHOOK] Error al procesar usuario Oracle:', error.message, error.details || '');
        return res.status(statusCode).json({
            status: 'error',
            message: error.message || 'Failed to sync user in Oracle',
            details: error?.details || undefined,
        });
    }
};

module.exports = {
    syncOracleUser,
};
