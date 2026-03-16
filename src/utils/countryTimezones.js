// utils/countryTimezones.js
/**
 * Map of country calling codes to their most common timezone
 * This helps determine the likely timezone for students based on their country code
 */
const countryTimezones = {
    // Middle East
    '972': 'Asia/Jerusalem', // Israel
    '971': 'Asia/Dubai',     // UAE
    '962': 'Asia/Amman',     // Jordan
    '966': 'Asia/Riyadh',    // Saudi Arabia
    '974': 'Asia/Qatar',     // Qatar
    '973': 'Asia/Bahrain',   // Bahrain
    '968': 'Asia/Muscat',    // Oman
    '965': 'Asia/Kuwait',    // Kuwait
    '961': 'Asia/Beirut',    // Lebanon
    
    // North America
    '1': 'America/New_York',  // USA/Canada (default Eastern time)
    
    // Europe
    '44': 'Europe/London',    // UK
    '33': 'Europe/Paris',     // France
    '49': 'Europe/Berlin',    // Germany
    '39': 'Europe/Rome',      // Italy
    '34': 'Europe/Madrid',    // Spain
    '31': 'Europe/Amsterdam', // Netherlands
    '41': 'Europe/Zurich',    // Switzerland
    '32': 'Europe/Brussels',  // Belgium
    '43': 'Europe/Vienna',    // Austria
    '46': 'Europe/Stockholm', // Sweden
    '47': 'Europe/Oslo',      // Norway
    '45': 'Europe/Copenhagen',// Denmark
    '358': 'Europe/Helsinki', // Finland
    '30': 'Europe/Athens',    // Greece
    '351': 'Europe/Lisbon',   // Portugal
    '353': 'Europe/Dublin',   // Ireland
    '48': 'Europe/Warsaw',    // Poland
    '420': 'Europe/Prague',   // Czech Republic
    '36': 'Europe/Budapest',  // Hungary
    '40': 'Europe/Bucharest', // Romania
    '359': 'Europe/Sofia',    // Bulgaria
    '385': 'Europe/Zagreb',   // Croatia
    '386': 'Europe/Ljubljana',// Slovenia
    '421': 'Europe/Bratislava',// Slovakia
    '370': 'Europe/Vilnius',  // Lithuania
    '371': 'Europe/Riga',     // Latvia
    '372': 'Europe/Tallinn',  // Estonia
    '357': 'Asia/Nicosia',    // Cyprus
    
    // Asia
    '91': 'Asia/Kolkata',     // India
    '86': 'Asia/Shanghai',    // China
    '81': 'Asia/Tokyo',       // Japan
    '82': 'Asia/Seoul',       // South Korea
    '852': 'Asia/Hong_Kong',  // Hong Kong
    '65': 'Asia/Singapore',   // Singapore
    '66': 'Asia/Bangkok',     // Thailand
    '60': 'Asia/Kuala_Lumpur',// Malaysia
    '62': 'Asia/Jakarta',     // Indonesia
    '63': 'Asia/Manila',      // Philippines
    '84': 'Asia/Ho_Chi_Minh', // Vietnam
    
    // Australia & New Zealand
    '61': 'Australia/Sydney', // Australia (default to Sydney)
    '64': 'Pacific/Auckland', // New Zealand
    
    // South America
    '55': 'America/Sao_Paulo', // Brazil
    '54': 'America/Argentina/Buenos_Aires', // Argentina
    '56': 'America/Santiago', // Chile
    '57': 'America/Bogota',   // Colombia
    '58': 'America/Caracas',  // Venezuela
    '51': 'America/Lima',     // Peru
    '52': 'America/Mexico_City', // Mexico
    '53': 'America/Havana',   // Cuba
    '599': 'America/Curacao', // Curaçao
    
    // Africa
    '27': 'Africa/Johannesburg', // South Africa
    '20': 'Africa/Cairo',     // Egypt
    '212': 'Africa/Casablanca', // Morocco
    '216': 'Africa/Tunis',    // Tunisia
  };
  
  /**
   * Get the timezone for a country code
   * @param {string} countryCode - Country code (e.g. '972' for Israel)
   * @returns {string} - Timezone for the country or 'UTC' if not found
   */
  const getTimezoneForCountry = (countryCode) => {
    // Clean the country code (remove + and spaces)
    const cleanCode = (countryCode || '').replace(/[+\s]/g, '');
    
    // Return the timezone if found, otherwise default to UTC
    return countryTimezones[cleanCode] || 'UTC';
  };
  
  module.exports = {
    countryTimezones,
    getTimezoneForCountry
  };