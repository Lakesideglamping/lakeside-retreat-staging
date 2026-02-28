/**
 * Tests for chatbot-service.js
 *
 * Covers: constructor / knowledge base loading, matchIntent, matchFAQ,
 *         processMessage response shape, session cleanup
 */

// The ChatbotService constructor starts a setInterval for session cleanup.
// We use fake timers to control it and prevent open handles.
beforeAll(() => {
    jest.useFakeTimers();
});

afterAll(() => {
    jest.useRealTimers();
});

const ChatbotService = require('../chatbot-service');

// ---------------------------------------------------------------------------
// Helper: build a fresh ChatbotService for isolation
// ---------------------------------------------------------------------------
function createService() {
    // Ensure no OPENAI_API_KEY so AI mode is off (deterministic only)
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const service = new ChatbotService();
    // Restore in case it was set
    if (originalKey !== undefined) {
        process.env.OPENAI_API_KEY = originalKey;
    }
    return service;
}

// ---------------------------------------------------------------------------
// Constructor / knowledge base
// ---------------------------------------------------------------------------
describe('constructor', () => {
    test('loads the knowledge base from disk', () => {
        const service = createService();
        expect(service.knowledgeBase).not.toBeNull();
        expect(service.knowledgeBase).toHaveProperty('business');
        expect(service.knowledgeBase).toHaveProperty('intents');
        expect(service.knowledgeBase).toHaveProperty('faqs');
        expect(service.knowledgeBase).toHaveProperty('accommodations');
        expect(service.knowledgeBase).toHaveProperty('fallback');
    });

    test('initialises empty conversation history', () => {
        const service = createService();
        expect(service.conversationHistory).toBeInstanceOf(Map);
        expect(service.conversationHistory.size).toBe(0);
    });

    test('sets aiEnabled to false when OPENAI_API_KEY is not set', () => {
        const service = createService();
        expect(service.aiEnabled).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// matchIntent
// ---------------------------------------------------------------------------
describe('matchIntent', () => {
    let service;

    beforeAll(() => {
        service = createService();
    });

    test('matches a greeting intent', () => {
        const response = service.matchIntent('hello there');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('welcome');
    });

    test('matches a booking intent', () => {
        const response = service.matchIntent('i want to book a stay');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('book');
    });

    test('matches a pricing intent', () => {
        const response = service.matchIntent('how much does it cost');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('rate');
    });

    test('matches a thanks intent', () => {
        const response = service.matchIntent('thank you very much');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('welcome');
    });

    test('matches a goodbye intent', () => {
        const response = service.matchIntent('goodbye');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('thank');
    });

    test('returns null when no intent matches', () => {
        const response = service.matchIntent('supercalifragilisticexpialidocious');
        expect(response).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// matchFAQ
// ---------------------------------------------------------------------------
describe('matchFAQ', () => {
    let service;

    beforeAll(() => {
        service = createService();
    });

    test('matches a FAQ about pets', () => {
        const response = service.matchFAQ('can i bring my dog');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('pet');
    });

    test('matches a FAQ about wineries', () => {
        const response = service.matchFAQ('tell me about the wineries nearby');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('vineyard');
    });

    test('matches a FAQ about check-in times', () => {
        const response = service.matchFAQ('what time is check-in');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('check-in');
    });

    test('matches a FAQ about the security deposit', () => {
        const response = service.matchFAQ('tell me about the deposit');
        expect(response).not.toBeNull();
        expect(response.toLowerCase()).toContain('deposit');
    });

    test('returns null when no FAQ matches', () => {
        const response = service.matchFAQ('xyzzy plugh');
        expect(response).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// processMessage – response shape
// ---------------------------------------------------------------------------
describe('processMessage', () => {
    let service;

    beforeAll(() => {
        service = createService();
    });

    test('returns an object with success, response, source, and aiEnabled', async () => {
        const result = await service.processMessage('session-1', 'hello');

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('response');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('aiEnabled');
    });

    test('success is true for a valid message', async () => {
        const result = await service.processMessage('session-2', 'what is the price');
        expect(result.success).toBe(true);
    });

    test('response is a non-empty string', async () => {
        const result = await service.processMessage('session-3', 'hi');
        expect(typeof result.response).toBe('string');
        expect(result.response.length).toBeGreaterThan(0);
    });

    test('source is "intent" when an intent matches', async () => {
        const result = await service.processMessage('session-4', 'hello');
        expect(result.source).toBe('intent');
    });

    test('source is "faq" when a FAQ matches and no intent matches', async () => {
        // Use a query that triggers FAQ but not an intent
        const result = await service.processMessage('session-5', 'what time is check-in');
        expect(result.source).toBe('faq');
    });

    test('source is "fallback" for unrecognised messages (AI disabled)', async () => {
        const result = await service.processMessage('session-6', 'xyzzy plugh abracadabra');
        expect(result.source).toBe('fallback');
    });

    test('stores conversation history for the session', async () => {
        const sessionId = 'session-history-test';
        await service.processMessage(sessionId, 'hello');
        await service.processMessage(sessionId, 'what is the price');

        const history = service.getSessionHistory(sessionId);
        // Each processMessage adds a user entry and an assistant entry
        expect(history.length).toBe(4); // 2 user + 2 assistant
        expect(history[0].role).toBe('user');
        expect(history[1].role).toBe('assistant');
    });

    test('returns error response when knowledge base is null', async () => {
        const brokenService = createService();
        brokenService.knowledgeBase = null;

        const result = await brokenService.processMessage('s1', 'hello');
        expect(result.success).toBe(false);
        expect(result.source).toBe('error');
    });
});

// ---------------------------------------------------------------------------
// Session cleanup
// ---------------------------------------------------------------------------
describe('session cleanup', () => {
    test('clearSession removes conversation history and last activity', async () => {
        const service = createService();

        await service.processMessage('cleanup-test', 'hello');
        expect(service.conversationHistory.has('cleanup-test')).toBe(true);
        expect(service.sessionLastActivity.has('cleanup-test')).toBe(true);

        service.clearSession('cleanup-test');

        expect(service.conversationHistory.has('cleanup-test')).toBe(false);
        expect(service.sessionLastActivity.has('cleanup-test')).toBe(false);
    });

    test('getSessionHistory returns empty array for unknown session', () => {
        const service = createService();
        expect(service.getSessionHistory('nonexistent')).toEqual([]);
    });

    test('stale sessions are evicted after SESSION_TTL', async () => {
        const service = createService();

        await service.processMessage('stale-session', 'hello');
        expect(service.conversationHistory.has('stale-session')).toBe(true);

        // SESSION_TTL is 30 minutes = 1800000ms
        // Advance past TTL and trigger the cleanup interval (5 min = 300000ms)
        jest.advanceTimersByTime(1800001);
        // The internal _evictStaleSessions runs on CLEANUP_INTERVAL (5 min)
        // Since we already advanced 30 min, the interval has fired multiple times
        service._evictStaleSessions(); // call directly to be sure

        expect(service.conversationHistory.has('stale-session')).toBe(false);
        expect(service.sessionLastActivity.has('stale-session')).toBe(false);
    });
});
