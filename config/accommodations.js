/**
 * Accommodations Configuration
 * 
 * Centralized accommodation data. Previously hardcoded inline in the
 * /api/accommodations endpoint handler in server.js (~line 392).
 * 
 * This can later be migrated to a database table for admin-editable content.
 * 
 * @see EFFICIENCY_REPORT.md - Issue #5
 */

const accommodations = [
    {
        id: 'dome-pinot',
        name: 'Dome Pinot',
        description: 'Luxury eco-dome with vineyard views and spa bath',
        maxGuests: 2,
        basePrice: 295,
        weekendPrice: 325,
        peakPrice: 350,
        amenities: ['King bed', 'Spa bath', 'Vineyard views', 'Solar powered'],
        images: ['dome-pinot-exterior.jpeg', 'dome-pinot-interior.jpeg']
    },
    {
        id: 'dome-rose',
        name: 'Dome Rosé',
        description: 'Romantic eco-dome with mountain views and outdoor spa',
        maxGuests: 2,
        basePrice: 295,
        weekendPrice: 325,
        peakPrice: 350,
        amenities: ['King bed', 'Outdoor spa', 'Mountain views', 'Solar powered'],
        images: ['dome-rose-exterior.jpeg', 'dome-rose-interior.jpeg']
    },
    {
        id: 'lakeside-cottage',
        name: 'Lakeside Cottage',
        description: 'Spacious cottage with lake views, perfect for families',
        maxGuests: 6,
        basePrice: 245,
        weekendPrice: 275,
        peakPrice: 300,
        extraGuestFee: 100,
        petFee: 25,
        amenities: ['2 bedrooms', 'Full kitchen', 'Lake views', 'Pet friendly'],
        images: ['lakesidecottageexterior.jpeg', 'lakesidecottageinterior.jpeg']
    }
];

/**
 * Get all accommodations.
 * @returns {Array} List of accommodation objects
 */
function getAll() {
    return accommodations;
}

/**
 * Get a single accommodation by ID.
 * @param {string} id - Accommodation identifier (e.g., 'dome-pinot')
 * @returns {Object|undefined} Accommodation object, or undefined if not found
 */
function getById(id) {
    return accommodations.find(a => a.id === id);
}

/**
 * Get valid accommodation IDs (for input validation).
 * @returns {string[]} Array of valid accommodation IDs
 */
function getValidIds() {
    return accommodations.map(a => a.id);
}

module.exports = {
    accommodations,
    getAll,
    getById,
    getValidIds
};
