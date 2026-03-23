require('dotenv').config();
const { syncOracleUser } = require('../services/oracle-user.service');

async function runTest() {
    const mockPayload = {
        user: {
            employee_id: "EMP-TEST-1234",
            legal_first_name: "John",
            legal_last_name: "Doe",
            date_of_birth: "1990-01-01",
            employment_start_date: "2026-03-20",
            passcode: "5555",
            user_levels: ["employee"]
        },
        locationRef: "4000004" // Sandbox location usually
    };

    console.log("Iniciando prueba de sincronización de usuario...");
    console.warn("ADVERTENCIA: Este script interactuará con la API configurada de Oracle (por defecto sbx5). Se recomienda usar IDs de prueba.\n");

    try {
        console.log("=== Flujo 1: Primer intento (Creación o Modificación base) ===");
        const result1 = await syncOracleUser(mockPayload);
        console.log(`Acción resultante: ${result1.action}`);
        console.log(`Existe previamente: ${result1.exists}`);
        
        console.log("\n=== Flujo 2: Mismo usuario sin cambios (Debería ser 'noop') ===");
        const result2 = await syncOracleUser(mockPayload);
        console.log(`Acción resultante: ${result2.action}`);
        
        console.log("\n=== Flujo 3: Mismo usuario con cambios (Debería ser 'modify') ===");
        mockPayload.user.passcode = "9999";
        const result3 = await syncOracleUser(mockPayload);
        console.log(`Acción resultante: ${result3.action}`);

    } catch (e) {
        console.error("Error durante las pruebas:", e.message);
        if (e.details) {
            console.error("Detalles (SOAP Fault/Body):", e.details);
        }
    }
}

runTest();
