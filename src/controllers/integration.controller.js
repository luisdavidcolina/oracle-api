const { ALLOWED_LOCATION_NAMES } = require('../config/constants');
const workforceService = require('../services/workforce.service');

const starbucksIntegration = async (req, res) => {
    try {
        let body;

        // Validar JSON
        if (typeof req.body === "string") {
            try {
                body = JSON.parse(req.body);
            } catch (error) {
                console.warn("No se pudo parsear req.body, usando texto plano.");
                body = req.body;
            }
        } else {
            body = req.body;
        }

        const headers = req.headers;
        let filename = headers.filename || "";
        filename = filename.trim().replace(/\s+/g, " ");

        const parts = filename.split(" ");
        const filenameBusinessDate = parts[parts.length - 2] || null;
        const filenameEndTime = parts[parts.length - 1] || null;

        let locationName = parts.slice(0, parts.length - 2).join(" ")
            .trim()
            .replace(/\s+/g, "")
            .toLowerCase();

        if (locationName === "rivertownplaza") locationName = "rivertown";
        if (locationName === "plazamallhumacao") locationName = "plazahumacao";

        if (!ALLOWED_LOCATION_NAMES.includes(locationName)) {
            console.log('Locacion no permitida:', locationName);
            return res.json({ status: 'recibido pero no publicado' });
        }

        const status = await workforceService.processAndSendData(body, locationName, {
            filenameBusinessDate,
            filenameEndTime
        });

        return res.json({ status });
    } catch (e) {
        return res.status(500).json({ error: e.message || 'Error interno del servidor' });
    }
};

module.exports = {
    starbucksIntegration,
};
