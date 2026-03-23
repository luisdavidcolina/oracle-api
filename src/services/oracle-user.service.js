const request = require('request');
const crypto = require('crypto');

const ORACLE_BASE_URL = process.env.ORACLE_LABOR_BASE_URL || 'https://simphony-home.sbx5.oraclerestaurants.com';
const ORACLE_API_TOKEN = process.env.ORACLE_LABOR_API_TOKEN || '7dUrTlug8IhW1/Ny1stnIKCINBs8LGFLZ4JZyVyGi8TxHi+VWZtExSHxtgfngQcd3+oV+/i3YBCT08/47awuHg==';
const ORACLE_API_PASSWORD = process.env.ORACLE_LABOR_API_PASSWORD || 'ko0or%5Hu$mm.lD#';
const DEFAULT_LOCATION_REF = process.env.ORACLE_DEFAULT_LOCATION_REF || '4000004';

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 422;
    }
}

function requestPromise(options) {
    return new Promise((resolve, reject) => {
        request(options, (error, response, body) => {
            if (error) return reject(error);
            resolve({ statusCode: response?.statusCode || 0, body: body || '' });
        });
    });
}

function safeString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    const out = String(value).trim();
    return out || fallback;
}

function xmlEscape(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function isValidISODateYYYYMMDD(value) {
    const s = safeString(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t);
}

function firstAndLastFromName(name) {
    const full = safeString(name);
    if (!full) return { firstName: 'N/A', lastName: 'N/A' };

    const parts = full.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || 'N/A';
    const lastName = parts.slice(1).join(' ') || 'N/A';
    return { firstName, lastName };
}

function normalizeIncomingUser(payload) {
    const user = payload?.user || payload?.data?.user || payload?.employee || payload || {};
    const locationRef = safeString(payload?.locationRef || payload?.orgLocationRef || user?.locationRef, DEFAULT_LOCATION_REF);

    const fallbackNames = firstAndLastFromName(user?.name || user?.fullName);
    const firstName = safeString(user?.legal_first_name || user?.firstName, fallbackNames.firstName);
    const lastName = safeString(user?.legal_last_name || user?.lastName, fallbackNames.lastName);

    const today = new Date().toISOString().slice(0, 10);
    const dateOfBirth = safeString(user?.date_of_birth || user?.dateOfBirth, '1990-01-01');
    const hireDate = safeString(user?.employment_start_date || user?.hireDate, today);

    const externalPayrollID = safeString(
        user?.employee_id || user?.externalPayrollID || user?.payrollId || user?.id,
        ''
    );

    if (!externalPayrollID) {
        throw new ValidationError('Missing employee identifier. Expected employee_id, externalPayrollID, payrollId or id.');
    }

    if (!isValidISODateYYYYMMDD(dateOfBirth)) {
        throw new ValidationError('Invalid date_of_birth format. Expected YYYY-MM-DD.');
    }

    if (!isValidISODateYYYYMMDD(hireDate)) {
        throw new ValidationError('Invalid employment_start_date/hireDate format. Expected YYYY-MM-DD.');
    }

    if (!safeString(firstName) || !safeString(lastName)) {
        throw new ValidationError('Missing firstName/lastName after normalization.');
    }

    const levels = Array.isArray(user?.user_levels) ? user.user_levels : [];
    const employeeRole = safeString(user?.employeeRole, levels.length ? levels.join(', ') : 'employee');

    return {
        firstName,
        lastName,
        dateOfBirth,
        hireDate,
        externalPayrollID,
        magCardNumber: safeString(user?.passcode || user?.magCardNumber, '0000'),
        employeeRole,
        locationRef,
    };
}

function buildSecurityHeader(actionRequest) {
    return `
<soapenv:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsse:UsernameToken wsu:Id="UsernameToken-${crypto.randomBytes(8).toString('hex')}">
            <wsse:Username>${ORACLE_API_TOKEN}</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${ORACLE_API_PASSWORD}</wsse:Password>
        </wsse:UsernameToken>
    </wsse:Security>
    <wsa:Action>http://net.mymicros/service/labor/${actionRequest}</wsa:Action>
    <wsa:ReplyTo>
        <wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsa:MessageID>urn:uuid:${crypto.randomUUID()}</wsa:MessageID>
    <wsa:To>${ORACLE_BASE_URL}/labor/labor</wsa:To>
</soapenv:Header>`.trim();
}

async function checkEmployeeExists(externalPayrollID, locationRef) {
    const actionRequest = 'getPortalUserRequest';
    const soapEnvelope = `
<soapenv:Envelope xmlns:ser="http://net.mymicros/service" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
${buildSecurityHeader(actionRequest)}
<soapenv:Body>
    <ser:getEntHREmployee>
        <externalPayrollID>${xmlEscape(externalPayrollID)}</externalPayrollID>
        <orgLocationRef>${xmlEscape(locationRef)}</orgLocationRef>
    </ser:getEntHREmployee>
</soapenv:Body>
</soapenv:Envelope>`.trim();

    const response = await requestPromise({
        method: 'POST',
        url: `${ORACLE_BASE_URL}/labor/labor`,
        headers: {
            'Content-Type': 'text/xml',
            SOAPAction: 'http://net.mymicros/service/labor/getPortalUserRequest',
        },
        body: soapEnvelope,
    });

    const body = String(response.body || '');
    return body.includes('<firstName>') || body.includes('<lastName>');
}

async function upsertOracleEmployee(mapped, action) {
    const actionTag = action === 'create' ? 'createEntHREmployee' : 'modifyEntHREmployee';
    const actionRequest = action === 'create' ? 'createEntHREmployeeRequest' : 'modifyEntHREmployeeRequest';

    const soapEnvelope = `
<soapenv:Envelope xmlns:ser="http://net.mymicros/service" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
${buildSecurityHeader(actionRequest)}
<soapenv:Body>
    <ser:${actionTag}>
        <employee>
            <dateOfBirth>${mapped.dateOfBirth}T00:00:00+00:00</dateOfBirth>
            <entHREmployeeJobRates>
                <effectiveFrom>${new Date().toISOString()}</effectiveFrom>
                <enterprisePOSRef>2</enterprisePOSRef>
                <externalPayrollID>${xmlEscape(mapped.externalPayrollID)}</externalPayrollID>
                <locationRef>${xmlEscape(mapped.locationRef)}</locationRef>
                <primaryJob>true</primaryJob>
                <regPayRate>1.00</regPayRate>
            </entHREmployeeJobRates>
            <externalPayrollID>${xmlEscape(mapped.externalPayrollID)}</externalPayrollID>
            <firstName>${xmlEscape(mapped.firstName)}</firstName>
            <hireDate>${mapped.hireDate}T04:00:00+00:00</hireDate>
            <lastName>${xmlEscape(mapped.lastName)}</lastName>
            <employeeRolePosref>100</employeeRolePosref>
            <entHREmployeePOSConfigs>
                <orgLocationRef>${xmlEscape(mapped.locationRef)}</orgLocationRef>
                <employeeClassPOSRef>3</employeeClassPOSRef>
                <entEmployeePrivilegeID>20144</entEmployeePrivilegeID>
                <magCardNumber>${xmlEscape(mapped.magCardNumber)}</magCardNumber>
                <externalPayrollID>${xmlEscape(mapped.externalPayrollID)}</externalPayrollID>
            </entHREmployeePOSConfigs>
            <employeeRole>${xmlEscape(mapped.employeeRole)}</employeeRole>
            <employeeRoleMasterID>6281658</employeeRoleMasterID>
            <hireStatus>0</hireStatus>
            <homeStoreRef>${xmlEscape(mapped.locationRef)}</homeStoreRef>
        </employee>
    </ser:${actionTag}>
</soapenv:Body>
</soapenv:Envelope>`.trim();

    return requestPromise({
        method: 'POST',
        url: `${ORACLE_BASE_URL}/labor/labor`,
        headers: {
            'Content-Type': 'text/xml',
            SOAPAction: `http://net.mymicros/service/labor/${actionRequest}`,
        },
        body: soapEnvelope,
    });
}

async function syncOracleUser(payload = {}) {
    // 1. Extraer y normalizar el payload recibido (puede venir anidado)
    const rawUser = payload?.payload?.body || payload?.user || payload?.employee || payload;
    const basePayload = { ...payload, user: rawUser };
    const mapped = normalizeIncomingUser(basePayload);

    // 2. Obtener datos adicionales del empleado (por ejemplo, equipos, roles, etc.)
    // --- IMPORTANTE: Aquí debes implementar la lógica para obtener datos faltantes del empleado ---
    // Por ejemplo, podrías hacer una llamada a otra API interna, base de datos, etc.
    // const additionalData = await getAdditionalEmployeeData(mapped.externalPayrollID);
    // Object.assign(mapped, additionalData);

    // 3. Obtener datos actuales del empleado en Oracle Labor (no solo existencia)
    // --- IMPORTANTE: Implementar función que obtenga todos los datos actuales del empleado en Oracle Labor ---
    // Por ahora, solo se verifica existencia, pero se debe obtener el objeto completo para comparar
    // const oracleEmployee = await getOracleEmployeeData(mapped.externalPayrollID, mapped.locationRef);
    // if (!oracleEmployee) { ... }

    // 4. Comparar datos completos (payload+adicionales vs Oracle)
    // --- IMPORTANTE: Implementar función de comparación profunda ---
    // const hasChanges = compareEmployeeData(mapped, oracleEmployee);
    // if (!hasChanges) {
    //     return {
    //         action: 'noop',
    //         exists: true,
    //         mapped,
    //         oracleStatusCode: 200,
    //         oracleResponsePreview: 'No changes detected, no update sent to Oracle.',
    //     };
    // }

    // 5. Si hay cambios o es alta, hacer upsert en Oracle Labor
    const exists = await checkEmployeeExists(mapped.externalPayrollID, mapped.locationRef);
    const action = exists ? 'modify' : 'create';
    const response = await upsertOracleEmployee(mapped, action);

    const oracleBody = String(response.body || '');
    const hasSoapFault = oracleBody.includes('<faultcode>') || oracleBody.includes('<soap:Fault') || oracleBody.includes('<faultstring>');
    if (response.statusCode >= 400 || hasSoapFault) {
        const err = new Error('Oracle SOAP request failed.');
        err.statusCode = 502;
        err.details = oracleBody.slice(0, 1600);
        throw err;
    }

    return {
        action,
        exists,
        mapped,
        oracleStatusCode: response.statusCode,
        oracleResponsePreview: oracleBody.slice(0, 1200),
    };
}

module.exports = {
    syncOracleUser,
    ValidationError,
};
