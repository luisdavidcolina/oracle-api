const fs = require('fs');
const path = require('path');

// Buscar todos los archivos raw generados por el script principal
const files = fs.readdirSync(__dirname).filter(f => f.startsWith('oracle_raw_quarterhour_') && f.endsWith('.json'));

if (files.length === 0) {
    console.log("No se encontraron archivos 'oracle_raw_quarterhour_*.json'.");
    console.log("Por favor, ejecuta primero tu script normal de oracle para la fecha de hoy (o la fecha de las pruebas) de la sucursal que usaste, con el fin de generar el archivo JSON.");
    process.exit(1);
}

const summary = {};

files.forEach(file => {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
        const rvcs = Array.isArray(data?.revenueCenters) ? data.revenueCenters : [];
        
        rvcs.forEach(rvc => {
            const rvcId = rvc.rvcNum;
            if (!summary[rvcId]) {
                summary[rvcId] = {
                    rvcNum: rvcId,
                    rvcName: rvc.name || rvc.rvcName || 'N/A', // Intentamos extraer el nombre si existe
                    totalVentas: 0,
                    totalCuentas: 0,
                    archivosEncontrados: new Set()
                };
            }
            
            summary[rvcId].archivosEncontrados.add(file);
            
            const qhs = Array.isArray(rvc.quarterHours) ? rvc.quarterHours : [];
            qhs.forEach(qh => {
                // Sumar ventas
                const sales = typeof qh.netSlsTtl !== 'undefined' ? Number(qh.netSlsTtl) : Number(qh.slsTtl || 0);
                summary[rvcId].totalVentas += sales;
                
                // Sumar cuentas
                const checks = typeof qh.chkCnt !== 'undefined' ? Number(qh.chkCnt) : Number(qh.checks || 0);
                summary[rvcId].totalCuentas += checks;
            });
        });
    } catch (err) {
        console.error(`Error leyendo el archivo ${file}:`, err.message);
    }
});

// Convertir para mostrar en tabla (y redondear ventas)
const result = Object.values(summary).map(s => ({
    rvcNum: s.rvcNum,
    rvcName: s.rvcName,
    totalVentas: Number(s.totalVentas.toFixed(2)),
    totalCuentas: s.totalCuentas,
    archivosUsados: Array.from(s.archivosEncontrados).join(', ')
}));

console.log("\n=== Resumen de Canales (Revenue Centers) Encontrados en los JSON ===");
console.table(result);
console.log("\n=========================================================================");
console.log("Por favor, cópiame la tabla de arriba y confírmame:");
console.log("1. ¿Qué 'rvcNum' corresponde a Café?");
console.log("2. ¿Qué 'rvcNum' corresponde a DT (Drive Thru)?");
console.log("3. ¿Qué 'rvcNum' corresponde a Digital?");
console.log("Con esa información podré ajustar el código correctamente.");
