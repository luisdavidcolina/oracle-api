const ALLOWED_LOCATION_NAMES = [
    'aeropuerto', 'anag.mendez', 'bairoa', 'buchanan', 'calacostas', 'caribehilton',
    'colobos', 'condadoplaza', 'condadovillage', 'doradoexpress', 'doubletree',
    'escorial', 'express', 'gardenhills', 'hotelsanjuan', 'losprados', 'macysponce',
    'montehiedra', 'osj1-tetuanstreet', 'pdckiosk', 'paseoslascumbres', 'plazacarolinamall',
    'plazadelmar', 'plazadorada', 'plazalasamericas', 'plazaolmedo', 'plazasultana',
    'plazadelsol', 'plazalasamericas2', 'plazoleta169', 'riohondo', 'sanpatricio',
    'santaisabel', 'rivertown', 'auxiliomutuo', 'plazahumacao'
];

const WORKFORCE_API_URL = process.env.WORKFORCE_API_URL || 'https://staging.workforce.com/api/v2/storestats/for_datastream';
const DEFAULT_WORKFORCE_TOKEN = process.env.WORKFORCE_TOKEN || '86b3a86d3a6b7bb8211fbe238f9b29af50ee7831068e8f53525411a3cb0d82fd';

module.exports = {
    ALLOWED_LOCATION_NAMES,
    WORKFORCE_API_URL,
    DEFAULT_WORKFORCE_TOKEN
};
