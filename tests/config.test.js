/**
 * Tests for config/accommodations.js and config/properties.js
 *
 * Covers: accommodations array shape, getAll, getById, getValidIds,
 *         getPropertyId, getAccommodationName
 */

// ---------------------------------------------------------------------------
// config/accommodations.js
// ---------------------------------------------------------------------------
describe('config/accommodations', () => {
    const { accommodations, getAll, getById, getValidIds } = require('../config/accommodations');

    test('exports an array of accommodations', () => {
        expect(Array.isArray(accommodations)).toBe(true);
        expect(accommodations.length).toBeGreaterThan(0);
    });

    test('each accommodation has required properties', () => {
        const requiredKeys = ['id', 'name', 'description', 'maxGuests', 'basePrice', 'amenities', 'images'];

        for (const acc of accommodations) {
            for (const key of requiredKeys) {
                expect(acc).toHaveProperty(key);
            }
        }
    });

    test('each accommodation id is a non-empty string', () => {
        for (const acc of accommodations) {
            expect(typeof acc.id).toBe('string');
            expect(acc.id.length).toBeGreaterThan(0);
        }
    });

    test('each accommodation has numeric basePrice and maxGuests', () => {
        for (const acc of accommodations) {
            expect(typeof acc.basePrice).toBe('number');
            expect(acc.basePrice).toBeGreaterThan(0);
            expect(typeof acc.maxGuests).toBe('number');
            expect(acc.maxGuests).toBeGreaterThan(0);
        }
    });

    test('amenities is an array of strings', () => {
        for (const acc of accommodations) {
            expect(Array.isArray(acc.amenities)).toBe(true);
            for (const amenity of acc.amenities) {
                expect(typeof amenity).toBe('string');
            }
        }
    });

    test('images is an array of strings', () => {
        for (const acc of accommodations) {
            expect(Array.isArray(acc.images)).toBe(true);
            for (const img of acc.images) {
                expect(typeof img).toBe('string');
            }
        }
    });

    // getAll
    test('getAll returns the full accommodations array', () => {
        const all = getAll();
        expect(all).toBe(accommodations); // same reference
        expect(all.length).toBe(accommodations.length);
    });

    // getById
    test('getById returns the correct accommodation for a known id', () => {
        const dome = getById('dome-pinot');
        expect(dome).toBeDefined();
        expect(dome.id).toBe('dome-pinot');
        expect(dome.name).toBe('Dome Pinot');
    });

    test('getById returns undefined for an unknown id', () => {
        expect(getById('nonexistent')).toBeUndefined();
    });

    // getValidIds
    test('getValidIds returns an array of all accommodation ids', () => {
        const ids = getValidIds();
        expect(Array.isArray(ids)).toBe(true);
        expect(ids).toContain('dome-pinot');
        expect(ids).toContain('dome-rose');
        expect(ids).toContain('lakeside-cottage');
        expect(ids.length).toBe(accommodations.length);
    });
});

// ---------------------------------------------------------------------------
// config/properties.js
// ---------------------------------------------------------------------------
describe('config/properties', () => {
    // Set env vars BEFORE requiring properties.js so it picks them up
    const originalEnv = process.env;

    beforeAll(() => {
        process.env = {
            ...originalEnv,
            UPLISTING_PINOT_ID: 'prop-pinot-123',
            UPLISTING_ROSE_ID: 'prop-rose-456',
            UPLISTING_COTTAGE_ID: 'prop-cottage-789'
        };
        // Clear the module cache so properties.js re-reads process.env
        jest.resetModules();
    });

    afterAll(() => {
        process.env = originalEnv;
        jest.resetModules();
    });

    test('getPropertyId returns the correct property id for dome-pinot', () => {
        const { getPropertyId } = require('../config/properties');
        expect(getPropertyId('dome-pinot')).toBe('prop-pinot-123');
    });

    test('getPropertyId returns the correct property id for dome-rose', () => {
        const { getPropertyId } = require('../config/properties');
        expect(getPropertyId('dome-rose')).toBe('prop-rose-456');
    });

    test('getPropertyId returns the correct property id for lakeside-cottage', () => {
        const { getPropertyId } = require('../config/properties');
        expect(getPropertyId('lakeside-cottage')).toBe('prop-cottage-789');
    });

    test('getPropertyId returns undefined for an unknown accommodation', () => {
        const { getPropertyId } = require('../config/properties');
        expect(getPropertyId('unknown-place')).toBeUndefined();
    });

    test('getAccommodationName returns the accommodation name for a known property id', () => {
        const { getAccommodationName } = require('../config/properties');
        expect(getAccommodationName('prop-pinot-123')).toBe('dome-pinot');
        expect(getAccommodationName('prop-rose-456')).toBe('dome-rose');
        expect(getAccommodationName('prop-cottage-789')).toBe('lakeside-cottage');
    });

    test('getAccommodationName returns "unknown" for an unrecognized property id', () => {
        const { getAccommodationName } = require('../config/properties');
        expect(getAccommodationName('nonexistent-id')).toBe('unknown');
    });
});
