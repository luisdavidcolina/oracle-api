const { runFlow, env_orgIdentifier } = require('./auth');

// --- Query Variables ---
const env_appServerURL = 'https://sbx5-omra.oracleindustry.com';
const appName = 'Postman Testing';
const env_busDate = '2026-02-23';
const env_locRef = '29402';

async function getMenuItemQuarterHourTotals() {
    console.log("--- Initiating Menu Item Query ---");

    // 1. Get Access Token
    const tokenData = await runFlow();
    if (!tokenData || !tokenData.access_token) {
        console.error("Failed to authenticate.");
        return;
    }

    const accessToken = tokenData.access_token;
    console.log("Using access token for query...");

    // 2. Perform Query
    const url = `${env_appServerURL}/bi/v1/${env_orgIdentifier}/getMenuItemQuarterHourTotals`;

    const body = {
        applicationName: appName,
        busDt: env_busDate,
        locRef: env_locRef
        // include: "",
        // searchCriteria: ""
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'PostmanRuntime/7.32.3'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        console.log("\n--- Query Result ---");
        console.log(JSON.stringify(data, null, 2));

        // --- Totals Calculation ---
        let totalSales = 0;
        let totalCount = 0;

        if (data && data.revenueCenters) {
            data.revenueCenters.forEach(rvc => {
                if (rvc.quarterHours) {
                    rvc.quarterHours.forEach(qh => {
                        if (qh.menuItems) {
                            qh.menuItems.forEach(mi => {
                                totalSales += mi.slsTtl || 0;
                                totalCount += mi.slsCnt || 0;
                            });
                        }
                    });
                }
            });
        }

        console.log("\n--- Totals ---");
        console.log(`Total Sales: ${totalSales.toFixed(2)}`);
        console.log(`Total Count: ${totalCount}`);
    } catch (error) {
        console.error("Error during query:", error);
    }
}

getMenuItemQuarterHourTotals();
