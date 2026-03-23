const { Router } = require("express");
const router = Router();
const integrationController = require('../controllers/integration.controller');
const oracleUserController = require('../controllers/oracle-user.controller');

// Notice since app.js has app.use('/starbucks', ...), the route here is just /integration
// router.post("/integration", integrationController.starbucksIntegration); // Temporalmente deshabilitado
// router.post('/oracle-user-sync', oracleUserController.syncOracleUser); // Temporalmente deshabilitado

module.exports = router;
