/**
 * Tests for middleware/auth.js
 *
 * Covers: escapeHtml, sanitizeInput, ERROR_CODES, sendError, sendSuccess
 */

// Mock the monitoring-system module before requiring auth.js
jest.mock('../monitoring-system', () => ({
    log: jest.fn()
}));

const {
    escapeHtml,
    sanitizeInput,
    ERROR_CODES,
    sendError,
    sendSuccess
} = require('../middleware/auth');

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
    test('escapes < and > characters', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    test('escapes & character', () => {
        expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    test('escapes double quotes', () => {
        expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    test('escapes single quotes', () => {
        expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    test('escapes all special characters together', () => {
        const input = '<div class="x" data-a=\'y\'>&</div>';
        const expected = '&lt;div class=&quot;x&quot; data-a=&#39;y&#39;&gt;&amp;&lt;/div&gt;';
        expect(escapeHtml(input)).toBe(expected);
    });

    test('returns the same string when no special characters are present', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    test('returns null when given null', () => {
        expect(escapeHtml(null)).toBeNull();
    });

    test('returns undefined when given undefined', () => {
        expect(escapeHtml(undefined)).toBeUndefined();
    });

    test('returns a number unchanged when given a number', () => {
        expect(escapeHtml(42)).toBe(42);
    });

    test('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// sanitizeInput
// ---------------------------------------------------------------------------
describe('sanitizeInput', () => {
    test('removes < and > characters', () => {
        expect(sanitizeInput('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    });

    test('removes backslash characters', () => {
        expect(sanitizeInput('path\\to\\file')).toBe('pathtofile');
    });

    test('removes double quote characters', () => {
        expect(sanitizeInput('say "hello"')).toBe('say hello');
    });

    test('removes single quote characters', () => {
        expect(sanitizeInput("it's")).toBe('its');
    });

    test('returns non-string input unchanged', () => {
        expect(sanitizeInput(123)).toBe(123);
        expect(sanitizeInput(null)).toBeNull();
        expect(sanitizeInput(undefined)).toBeUndefined();
    });

    test('returns safe strings unchanged', () => {
        expect(sanitizeInput('hello world 123')).toBe('hello world 123');
    });
});

// ---------------------------------------------------------------------------
// ERROR_CODES
// ---------------------------------------------------------------------------
describe('ERROR_CODES', () => {
    test('contains all expected validation error codes', () => {
        expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
        expect(ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
        expect(ERROR_CODES.MISSING_REQUIRED_FIELDS).toBe('MISSING_REQUIRED_FIELDS');
        expect(ERROR_CODES.INVALID_DATE_RANGE).toBe('INVALID_DATE_RANGE');
    });

    test('contains all expected authentication error codes', () => {
        expect(ERROR_CODES.AUTHENTICATION_REQUIRED).toBe('AUTHENTICATION_REQUIRED');
        expect(ERROR_CODES.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
        expect(ERROR_CODES.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
        expect(ERROR_CODES.INVALID_TOKEN).toBe('INVALID_TOKEN');
    });

    test('contains all expected authorization error codes', () => {
        expect(ERROR_CODES.INSUFFICIENT_PERMISSIONS).toBe('INSUFFICIENT_PERMISSIONS');
        expect(ERROR_CODES.ADMIN_ACCESS_REQUIRED).toBe('ADMIN_ACCESS_REQUIRED');
    });

    test('contains all expected not-found error codes', () => {
        expect(ERROR_CODES.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
        expect(ERROR_CODES.BOOKING_NOT_FOUND).toBe('BOOKING_NOT_FOUND');
        expect(ERROR_CODES.ENDPOINT_NOT_FOUND).toBe('ENDPOINT_NOT_FOUND');
    });

    test('contains all expected conflict error codes', () => {
        expect(ERROR_CODES.RESOURCE_CONFLICT).toBe('RESOURCE_CONFLICT');
        expect(ERROR_CODES.DATES_NOT_AVAILABLE).toBe('DATES_NOT_AVAILABLE');
        expect(ERROR_CODES.BOOKING_ALREADY_EXISTS).toBe('BOOKING_ALREADY_EXISTS');
    });

    test('contains all expected server error codes', () => {
        expect(ERROR_CODES.INTERNAL_SERVER_ERROR).toBe('INTERNAL_SERVER_ERROR');
        expect(ERROR_CODES.DATABASE_ERROR).toBe('DATABASE_ERROR');
        expect(ERROR_CODES.PAYMENT_ERROR).toBe('PAYMENT_ERROR');
        expect(ERROR_CODES.EMAIL_ERROR).toBe('EMAIL_ERROR');
        expect(ERROR_CODES.EXTERNAL_API_ERROR).toBe('EXTERNAL_API_ERROR');
    });
});

// ---------------------------------------------------------------------------
// sendError
// ---------------------------------------------------------------------------
describe('sendError', () => {
    function createMockRes() {
        const res = {
            statusCode: null,
            body: null,
            status(code) {
                res.statusCode = code;
                return res;
            },
            json(data) {
                res.body = data;
                return res;
            }
        };
        return res;
    }

    test('sets the correct HTTP status code', () => {
        const res = createMockRes();
        sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'Bad input');
        expect(res.statusCode).toBe(400);
    });

    test('returns a response with success === false', () => {
        const res = createMockRes();
        sendError(res, 404, ERROR_CODES.RESOURCE_NOT_FOUND, 'Not found');
        expect(res.body.success).toBe(false);
    });

    test('includes the error code in the response', () => {
        const res = createMockRes();
        sendError(res, 500, ERROR_CODES.DATABASE_ERROR, 'DB failure');
        expect(res.body.error.code).toBe('DATABASE_ERROR');
    });

    test('includes the error message in the response', () => {
        const res = createMockRes();
        sendError(res, 401, ERROR_CODES.INVALID_CREDENTIALS, 'Wrong password');
        expect(res.body.error.message).toBe('Wrong password');
    });

    test('includes a timestamp in the response', () => {
        const res = createMockRes();
        sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'err');
        expect(res.body.error.timestamp).toBeDefined();
        // Should be a valid ISO date string
        expect(() => new Date(res.body.error.timestamp)).not.toThrow();
    });

    test('includes details when provided', () => {
        const res = createMockRes();
        sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'err', { field: 'email' });
        expect(res.body.error.details).toEqual({ field: 'email' });
    });

    test('omits details when not provided', () => {
        const res = createMockRes();
        sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'err');
        expect(res.body.error.details).toBeUndefined();
    });

    test('includes requestId when provided', () => {
        const res = createMockRes();
        sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, 'err', null, 'req-123');
        expect(res.body.error.requestId).toBe('req-123');
    });
});

// ---------------------------------------------------------------------------
// sendSuccess
// ---------------------------------------------------------------------------
describe('sendSuccess', () => {
    function createMockRes() {
        const res = {
            statusCode: null,
            body: null,
            status(code) {
                res.statusCode = code;
                return res;
            },
            json(data) {
                res.body = data;
                return res;
            }
        };
        return res;
    }

    test('sets status code to 200 by default', () => {
        const res = createMockRes();
        sendSuccess(res, { items: [] });
        expect(res.statusCode).toBe(200);
    });

    test('returns a response with success === true', () => {
        const res = createMockRes();
        sendSuccess(res, { id: 1 });
        expect(res.body.success).toBe(true);
    });

    test('includes data when provided', () => {
        const res = createMockRes();
        sendSuccess(res, { id: 1, name: 'Test' });
        expect(res.body.data).toEqual({ id: 1, name: 'Test' });
    });

    test('includes message when provided', () => {
        const res = createMockRes();
        sendSuccess(res, null, 'Created successfully', 201);
        expect(res.body.message).toBe('Created successfully');
        expect(res.statusCode).toBe(201);
    });

    test('includes a timestamp in the response', () => {
        const res = createMockRes();
        sendSuccess(res);
        expect(res.body.timestamp).toBeDefined();
        expect(() => new Date(res.body.timestamp)).not.toThrow();
    });

    test('omits data when not provided', () => {
        const res = createMockRes();
        sendSuccess(res);
        expect(res.body.data).toBeUndefined();
    });

    test('omits message when not provided', () => {
        const res = createMockRes();
        sendSuccess(res, { x: 1 });
        expect(res.body.message).toBeUndefined();
    });

    test('allows custom status codes', () => {
        const res = createMockRes();
        sendSuccess(res, { id: 5 }, 'Resource created', 201);
        expect(res.statusCode).toBe(201);
    });
});
