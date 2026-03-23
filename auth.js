const crypto = require('crypto');

// --- Variables (Corrected from User Input) ---
const env_authServerURL = 'https://sbx5-omra-idm.oracleindustry.com';
const env_clientID = 'UFVSLjVmZWI5MjMzLWFkNzktNDVjNy1hZDUzLWY5OTU0ZmYzZGM3Nw==';
const auth_env_username = 'WF_API';
const auth_env_password = String.raw`2\nL2t71#_.N`;
const env_orgIdentifier = 'PUR';
const redirect_uri = 'apiaccount://callback';

function createRandomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

const randoLength = Math.floor(Math.random() * (128 - 43 + 1)) + 43;
const code_verifier = createRandomString(randoLength);
const hash = crypto.createHash('sha256').update(code_verifier).digest('base64');
const code_challenge = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

function extractAuthCode(redirectUrl) {
    try {
        const url = new URL(redirectUrl);
        const code = url.searchParams.get('code');
        return code ? code + "=" : null;
    } catch (e) {
        const paramsString = redirectUrl.split('?')[1];
        if (paramsString) {
            const eachParamArray = paramsString.split('&');
            for (const param of eachParamArray) {
                const [key, value] = param.split('=');
                if (key === "code") return value + "=";
            }
        }
    }
    return null;
}

async function authorizeRequest() {
    console.log("Step 1: Initiating Authorization Request...");
    const url = new URL(`${env_authServerURL}/oidc-provider/v1/oauth2/authorize`);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('client_id', env_clientID);
    url.searchParams.append('scope', 'openid');
    url.searchParams.append('redirect_uri', redirect_uri);
    url.searchParams.append('state', '');
    url.searchParams.append('code_challenge', code_challenge);
    url.searchParams.append('code_challenge_method', 'S256');

    const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'PostmanRuntime/7.32.3' }
    });

    console.log("Step 1 Response Status:", response.status);
    return response.headers.getSetCookie();
}

async function performSignIn(cookies) {
    console.log("Step 2: Performing Sign-In...");
    const body = new URLSearchParams();
    body.append('username', auth_env_username);
    body.append('password', auth_env_password);
    body.append('orgname', env_orgIdentifier);
    body.append('client_id', env_clientID);

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'PostmanRuntime/7.32.3'
    };
    if (cookies && cookies.length > 0) {
        headers['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
    }

    const url = `${env_authServerURL}/oidc-provider/v1/oauth2/signin?client_id=${env_clientID}`;
    const response = await fetch(url, { method: 'POST', headers, body });
    const data = await response.json();

    if (data.redirectUrl) {
        const authCode = extractAuthCode(data.redirectUrl);
        console.log("Step 3: Success! Auth Code extracted.");
        return authCode;
    }
    console.error("Sign-In failed:", data);
    return null;
}

async function exchangeCodeForToken(authCode) {
    console.log("Step 4: Exchanging Code for Token...");
    const body = new URLSearchParams();
    body.append('grant_type', 'authorization_code');
    body.append('client_id', env_clientID);
    body.append('code_verifier', code_verifier);
    body.append('code', authCode);
    body.append('redirect_uri', redirect_uri);

    const response = await fetch(`${env_authServerURL}/oidc-provider/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'PostmanRuntime/7.32.3'
        },
        body
    });

    const data = await response.json();
    if (data.access_token) {
        console.log("Step 5: SUCCESS! Access Token obtained.");
        return data;
    }
    console.error("Token exchange failed:", data);
    return null;
}

async function runFlow() {
    const cookies = await authorizeRequest();
    const authCode = await performSignIn(cookies);
    if (authCode) {
        return await exchangeCodeForToken(authCode);
    }
    return null;
}

module.exports = { runFlow, env_orgIdentifier };

if (require.main === module) {
    runFlow().then(token => {
        if (token) console.log("--- Auth Flow Successful ---");
    });
}
