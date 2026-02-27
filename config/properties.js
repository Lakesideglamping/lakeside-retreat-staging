/**
 * Property Mapping Configuration
 * 
 * Centralized mapping between internal accommodation IDs and Uplisting property IDs.
 * Previously duplicated in 3 places in server.js (checkUplistingAvailability, 
 * syncBookingToUplisting, getAccommodationFromPropertyId).
 * 
 * @see EFFICIENCY_REPORT.md - Issue #1
 */

// Forward mapping: internal name → Uplisting property ID
const PROPERTY_IDS = {
    'dome-pinot': process.env.UPLISTING_PINOT_ID,
    'dome-rose': process.env.UPLISTING_ROSE_ID,
    'lakeside-cottage': process.env.UPLISTING_COTTAGE_ID
};

/**
 * Get the Uplisting property ID for a given accommodation name.
 * @param {string} accommodation - Internal accommodation identifier (e.g., 'dome-pinot')
 * @returns {string|undefined} Uplisting property ID, or undefined if not found
 */
function getPropertyId(accommodation) {
    return PROPERTY_IDS[accommodation];
}

/**
 * Get the internal accommodation name for a given Uplisting property ID.
 * @param {string} propertyId - Uplisting property ID
 * @returns {string} Internal accommodation name, or 'unknown' if not found
 */
function getAccommodationName(propertyId) {
    for (const [name, id] of Object.entries(PROPERTY_IDS)) {
        if (id === propertyId) return name;
    }
    return 'unknown';
}

/**
 * Get all configured property mappings (for debugging/admin).
 * @returns {Object} Copy of the property mapping
 */
function getAllMappings() {
    return { ...PROPERTY_IDS };
}

module.exports = {
    PROPERTY_IDS,
    getPropertyId,
    getAccommodationName,
    getAllMappings
};
