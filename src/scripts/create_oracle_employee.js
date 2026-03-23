const request = require('request');
const { DEFAULT_WORKFORCE_TOKEN } = require('../config/constants');
const crypto = require('crypto');

// --- Configuration ---
const ORACLE_BASE_URL = 'https://simphony-home.sbx5.oraclerestaurants.com';
const ORACLE_API_TOKEN = '7dUrTlug8IhW1/Ny1stnIKCINBs8LGFLZ4JZyVyGi8TxHi+VWZtExSHxtgfngQcd3+oV+/i3YBCT08/47awuHg==';
const ORACLE_API_PASSWORD = 'ko0or%5Hu$mm.lD#';
const WORKFORCE_API_BASE = 'https://staging.workforce.com';
const LOCATION_REF = '4000004'; // Target location

// --- Helpers ---

/**
 * Fetches a list of users from Workforce (Tanda)
 */
async function getWorkforceUsers() {
    console.log('Fetching users from Workforce (targeting #10)...');
    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            url: `${WORKFORCE_API_BASE}/api/v2/users?page_size=10&page=1`,
            headers: {
                'Authorization': `bearer ${DEFAULT_WORKFORCE_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        request(options, (error, response, body) => {
            if (error) return reject(error);
            if (response.statusCode !== 200) return reject(new Error(`Workforce API error: ${response.statusCode} - ${body}`));
            resolve(JSON.parse(body));
        });
    });
}

/**
 * Checks if an employee already exists in Oracle Simphony
 */
async function checkEmployeeExists(externalPayrollID) {
    console.log(`Checking if employee ${externalPayrollID} exists in Oracle...`);

    const soapEnvelope = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://net.mymicros/service">
   <soapenv:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
        <wsse:UsernameToken wsu:Id="UsernameToken-D5B4C1394E66FEE9D015619983318702">
            <wsse:Username>${ORACLE_API_TOKEN}</wsse:Username>
            <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${ORACLE_API_PASSWORD}</wsse:Password>
        </wsse:UsernameToken>
    </wsse:Security>
    <wsa:Action>http://net.mymicros/service/labor/getPortalUserRequest</wsa:Action>
    <wsa:ReplyTo>
        <wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsa:MessageID>urn:uuid:${crypto.randomUUID()}</wsa:MessageID>
    <wsa:To>${ORACLE_BASE_URL}/labor/labor</wsa:To>
</soapenv:Header>
   <soapenv:Body>
      <ser:getEntHREmployee>
         <externalPayrollID>${externalPayrollID}</externalPayrollID>
         <orgLocationRef>${LOCATION_REF}</orgLocationRef>
      </ser:getEntHREmployee>
   </soapenv:Body>
</soapenv:Envelope>`.trim();

    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            url: `${ORACLE_BASE_URL}/labor/labor`,
            headers: {
                'Content-Type': 'text/xml',
                'SOAPAction': 'http://net.mymicros/service/labor/getPortalUserRequest'
            },
            body: soapEnvelope
        };

        request(options, (error, response, body) => {
            if (error) return reject(error);
            if (body.includes('<firstName>') || body.includes('<lastName>')) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

/**
 * Creates OR Modifies an employee in Oracle Simphony via SOAP
 */
async function processOracleEmployee(employeeData, action = 'create') {
    const actionTag = action === 'create' ? 'createEntHREmployee' : 'modifyEntHREmployee';
    const actionRequest = action === 'create' ? 'createEntHREmployeeRequest' : 'modifyEntHREmployeeRequest';

    console.log(`${action === 'create' ? 'Registering' : 'Updating'} employee ${employeeData.firstName} ${employeeData.lastName} in Oracle...`);

    // Construct SOAP Envelope
    const soapEnvelope = `
<soapenv:Envelope xmlns:ser="http://net.mymicros/service" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
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
    </soapenv:Header>
    <soapenv:Body>
        <ser:${actionTag}>
            <employee>
                <dateOfBirth>${employeeData.dateOfBirth}T00:00:00+00:00</dateOfBirth>
                <entHREmployeeJobRates>
                    <effectiveFrom>${new Date().toISOString()}</effectiveFrom>
                    <enterprisePOSRef>2</enterprisePOSRef>
                    <externalPayrollID>${employeeData.externalPayrollID}</externalPayrollID>
                    <locationRef>${LOCATION_REF}</locationRef>
                    <primaryJob>true</primaryJob>
                    <regPayRate>1.00</regPayRate>
                </entHREmployeeJobRates>
                <externalPayrollID>${employeeData.externalPayrollID}</externalPayrollID>
                <firstName>${employeeData.firstName}</firstName>
                <hireDate>${employeeData.hireDate}T04:00:00+00:00</hireDate>
                <lastName>${employeeData.lastName}</lastName>
                <employeeRolePosref>100</employeeRolePosref>
                <entHREmployeePOSConfigs>
                    <orgLocationRef>${LOCATION_REF}</orgLocationRef>
                    <employeeClassPOSRef>3</employeeClassPOSRef>
                    <entEmployeePrivilegeID>20144</entEmployeePrivilegeID>
                    <magCardNumber>${employeeData.magCardNumber || '0000'}</magCardNumber>
                    <externalPayrollID>${employeeData.externalPayrollID}</externalPayrollID>
                </entHREmployeePOSConfigs>
                <employeeRole>${employeeData.employeeRole}</employeeRole>
                <employeeRoleMasterID>6281658</employeeRoleMasterID>
                <hireStatus>0</hireStatus>
                <homeStoreRef>${LOCATION_REF}</homeStoreRef>
            </employee>
        </ser:${actionTag}>
    </soapenv:Body>
</soapenv:Envelope>`.trim();

    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            url: `${ORACLE_BASE_URL}/labor/labor`,
            headers: {
                'Content-Type': 'text/xml',
                'SOAPAction': `http://net.mymicros/service/labor/${actionRequest}`
            },
            body: soapEnvelope
        };

        request(options, (error, response, body) => {
            if (error) return reject(error);
            resolve({ statusCode: response.statusCode, body });
        });
    });
}

// --- Main Execution ---

async function run() {
    try {
        const wfUsers = await getWorkforceUsers();
        if (!wfUsers || wfUsers.length < 10) {
            console.error(`Not enough users found in Workforce (found ${wfUsers ? wfUsers.length : 0}, need at least 10).`);
            return;
        }

        const user = wfUsers[9]; // Get the 10th user (index 9)
        console.log('Workforce User matched (#10):', JSON.stringify(user, null, 2));

        const externalPayrollID = user.employee_id || `WF-${user.id}`;

        // 1. Check if exists
        const exists = await checkEmployeeExists(externalPayrollID);
        const action = exists ? 'modify' : 'create';

        if (exists) {
            console.log(`Employee with externalPayrollID ${externalPayrollID} already exists in Oracle. Proceeding with UPDATE...`);
        } else {
            console.log(`Employee with externalPayrollID ${externalPayrollID} not found. Proceeding with CREATE...`);
        }

        // 2. Map data
        const mapping = {
            firstName: user.legal_first_name || user.name.split(' ')[0],
            lastName: user.legal_last_name || user.name.split(' ').slice(1).join(' ') || 'N/A',
            dateOfBirth: user.date_of_birth || '1990-01-01',
            hireDate: user.employment_start_date || new Date().toISOString().split('T')[0],
            externalPayrollID: externalPayrollID,
            magCardNumber: user.passcode,
            employeeRole: (user.user_levels && user.user_levels.length > 0) ? user.user_levels.join(', ') : 'employee'
        };

        console.log('Mapped data for Oracle:', mapping);

        // 3. Process (Create or Update)
        const result = await processOracleEmployee(mapping, action);
        console.log(`Oracle Response (${result.statusCode}):`);
        // Basic log of body, truncated if too long
        console.log(result.body.length > 1000 ? result.body.substring(0, 1000) + '...' : result.body);

        // Identify missing/defaulted fields
        const missingFields = [];
        if (!user.legal_first_name) missingFields.push('legal_first_name (used preferred name)');
        if (!user.legal_last_name) missingFields.push('legal_last_name (inferred from name)');
        if (!user.date_of_birth) missingFields.push('date_of_birth (defaulted)');
        if (!user.employment_start_date) missingFields.push('employment_start_date (defaulted to today)');
        if (!user.employee_id) missingFields.push('employee_id (generated from user ID)');
        if (!user.passcode) missingFields.push('passcode (defaulted to 0000)');
        if (!user.user_levels || user.user_levels.length === 0) missingFields.push('user_levels (defaulted to employee)');

        if (missingFields.length > 0) {
            console.log('\n--- Missing or Incomplete Data from Workforce ---');
            missingFields.forEach(f => console.log(`- ${f}`));
        }

    } catch (err) {
        console.error('Execution failed:', err.message);
    }
}

run();
