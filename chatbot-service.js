const fs = require('fs');
const path = require('path');

const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

class ChatbotService {
    constructor() {
        this.knowledgeBase = this.loadKnowledgeBase();
        this.conversationHistory = new Map();
        this.sessionLastActivity = new Map();
        this.aiEnabled = !!process.env.OPENAI_API_KEY;

        // Periodically evict stale sessions to prevent memory leaks
        this._cleanupTimer = setInterval(() => {
            this._evictStaleSessions();
        }, CLEANUP_INTERVAL);
        // Allow the timer to not prevent Node from exiting
        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }

        if (this.aiEnabled) {
            console.log('ChatbotService: AI enhancement enabled (OpenAI API key detected)');
        } else {
            console.log('ChatbotService: Running in deterministic mode (no AI API key)');
        }
    }

    _evictStaleSessions() {
        const now = Date.now();
        let evicted = 0;
        for (const [sessionId, lastActivity] of this.sessionLastActivity) {
            if (now - lastActivity > SESSION_TTL) {
                this.conversationHistory.delete(sessionId);
                this.sessionLastActivity.delete(sessionId);
                evicted++;
            }
        }
        if (evicted > 0) {
            console.log(`ChatbotService: Evicted ${evicted} stale session(s). Active sessions: ${this.conversationHistory.size}`);
        }
    }

    loadKnowledgeBase() {
        try {
            const kbPath = path.join(__dirname, 'chatbot-knowledge-base.json');
            const data = fs.readFileSync(kbPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to load knowledge base:', error.message);
            return null;
        }
    }

    async processMessage(sessionId, userMessage) {
        if (!this.knowledgeBase) {
            return {
                success: false,
                response: 'Sorry, I\'m having trouble accessing my knowledge base. Please contact us directly at info@lakesideretreat.co.nz',
                source: 'error'
            };
        }

        const normalizedMessage = userMessage.toLowerCase().trim();

        // Track last activity for session TTL eviction
        this.sessionLastActivity.set(sessionId, Date.now());

        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        const history = this.conversationHistory.get(sessionId);
        history.push({ role: 'user', content: userMessage, timestamp: new Date() });

        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }

        let response;
        let source = 'deterministic';

        const intentResponse = this.matchIntent(normalizedMessage);
        if (intentResponse) {
            response = intentResponse;
            source = 'intent';
        } else {
            const faqResponse = this.matchFAQ(normalizedMessage);
            if (faqResponse) {
                response = faqResponse;
                source = 'faq';
            } else {
                const accommodationResponse = this.matchAccommodation(normalizedMessage);
                if (accommodationResponse) {
                    response = accommodationResponse;
                    source = 'accommodation';
                } else if (this.aiEnabled) {
                    try {
                        response = await this.getAIResponse(userMessage, history);
                        source = 'ai';
                    } catch (error) {
                        console.error('AI response failed, using fallback:', error.message);
                        response = this.knowledgeBase.fallback.response;
                        source = 'fallback';
                    }
                } else {
                    response = this.knowledgeBase.fallback.response;
                    source = 'fallback';
                }
            }
        }

        history.push({ role: 'assistant', content: response, timestamp: new Date() });

        return {
            success: true,
            response: response,
            source: source,
            aiEnabled: this.aiEnabled
        };
    }

    matchIntent(message) {
        const intents = this.knowledgeBase.intents;
        
        for (const [_intentName, intentData] of Object.entries(intents)) {
            for (const pattern of intentData.patterns) {
                if (message.includes(pattern.toLowerCase())) {
                    return intentData.response;
                }
            }
        }
        
        return null;
    }

    matchFAQ(message) {
        const faqs = this.knowledgeBase.faqs;
        let bestMatch = null;
        let bestScore = 0;

        for (const faq of faqs) {
            let score = 0;
            
            for (const keyword of faq.keywords) {
                if (message.includes(keyword.toLowerCase())) {
                    score += 2;
                }
            }

            const questionWords = faq.question.toLowerCase().split(/\s+/);
            for (const word of questionWords) {
                if (word.length > 3 && message.includes(word)) {
                    score += 1;
                }
            }

            if (score > bestScore && score >= 2) {
                bestScore = score;
                bestMatch = faq.answer;
            }
        }

        return bestMatch;
    }

    matchAccommodation(message) {
        const accommodations = this.knowledgeBase.accommodations;
        
        for (const acc of accommodations) {
            const nameVariants = [
                acc.name.toLowerCase(),
                acc.id.toLowerCase(),
                acc.id.replace('-', ' ').toLowerCase()
            ];
            
            for (const variant of nameVariants) {
                if (message.includes(variant)) {
                    return this.formatAccommodationResponse(acc);
                }
            }
        }

        if (message.includes('compare') || message.includes('difference') || 
            message.includes('which') || message.includes('recommend')) {
            return this.formatComparisonResponse();
        }

        return null;
    }

    formatAccommodationResponse(acc) {
        let response = `**${acc.name}** - ${acc.type}\n\n`;
        response += `${acc.description}\n\n`;
        response += `**Size:** ${acc.size}\n`;
        response += `**Max Guests:** ${acc.maxGuests}\n`;
        response += `**Price:** $${acc.price.base} NZD per night\n`;
        response += `**Views:** ${acc.views}\n\n`;
        response += `**Amenities include:** ${acc.amenities.slice(0, 5).join(', ')}, and more.\n\n`;
        
        if (acc.petFriendly) {
            response += `This accommodation is pet-friendly. ${acc.petPolicy}\n\n`;
        }
        
        response += `Would you like to book ${acc.name} or learn more about our other options?`;
        
        return response;
    }

    formatComparisonResponse() {
        const accommodations = this.knowledgeBase.accommodations;
        let response = "Here's a comparison of our accommodations:\n\n";
        
        for (const acc of accommodations) {
            response += `**${acc.name}** (${acc.size})\n`;
            response += `- Price: $${acc.price.base} NZD/night\n`;
            response += `- Max guests: ${acc.maxGuests}\n`;
            response += `- Best for: ${acc.maxGuests <= 2 ? 'Couples' : 'Families/Groups'}\n`;
            response += `- Pet-friendly: ${acc.petFriendly ? 'Yes' : 'No'}\n\n`;
        }
        
        response += "The domes are perfect for romantic getaways with spa access and breakfast included. ";
        response += "The cottage is ideal for families with full kitchen, lake access, and pet-friendly options.\n\n";
        response += "Which accommodation interests you most?";
        
        return response;
    }

    async getAIResponse(userMessage, history) {
        const systemPrompt = this.buildSystemPrompt();
        
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-6).map(h => ({ role: h.role, content: h.content }))
        ];

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: messages,
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    buildSystemPrompt() {
        const kb = this.knowledgeBase;
        
        return `You are a helpful assistant for Lakeside Retreat, a luxury glamping accommodation in Central Otago, New Zealand.

IMPORTANT RULES:
1. Only answer questions about Lakeside Retreat and its services
2. Never invent prices, policies, or information not provided below
3. If unsure, suggest contacting Stephen & Sandy at +64-21-368-682 or info@lakesideretreat.co.nz
4. Be friendly, helpful, and concise
5. Encourage bookings when appropriate

BUSINESS INFO:
- Location: ${kb.business.location.address}
- Hosts: ${kb.business.hosts}
- Phone: ${kb.business.contact.phone}
- Email: ${kb.business.contact.email}
- Rating: ${kb.business.rating.score}/5 from ${kb.business.rating.reviews} reviews

ACCOMMODATIONS:
${kb.accommodations.map(a => `- ${a.name}: ${a.size}, $${a.price.base}/night, max ${a.maxGuests} guests, ${a.petFriendly ? 'pet-friendly' : 'no pets'}`).join('\n')}

POLICIES:
- Check-in: ${kb.policies.checkIn.time} (early check-in often available)
- Check-out: ${kb.policies.checkOut.time} (late check-out by arrangement)
- Security deposit: $${kb.policies.securityDeposit.amount} (authorization hold, released 48h after checkout)
- Pets: ${kb.policies.pets}

DISTANCES:
- Queenstown Airport: ${kb.business.location.distances.queenstown_airport}
- Wanaka: ${kb.business.location.distances.wanaka}
- Cromwell: ${kb.business.location.distances.cromwell}
- Cycle trail: ${kb.business.location.distances.cycle_trail}

SUSTAINABILITY:
- ${kb.business.features.solar_system}
- ${kb.business.features.battery}

Keep responses concise and helpful. If the question is not about Lakeside Retreat, politely redirect to relevant topics.`;
    }

    async generateEmailReply(emailContent, context = {}) {
        const emailLower = emailContent.toLowerCase();
        let suggestedReply = '';

        if (emailLower.includes('availability') || emailLower.includes('book') || emailLower.includes('available')) {
            suggestedReply = `Dear Guest,

Thank you for your interest in staying at Lakeside Retreat!

We'd be delighted to check availability for you. Could you please let us know:
- Your preferred dates
- Number of guests
- Which accommodation interests you (Dome Pinot, Dome Rose, or Lakeside Cottage)

You can also check availability and book directly on our website at lakesideretreat.co.nz.

Our accommodations:
- Dome Pinot (50sqm luxury dome): $530/night, perfect for couples
- Dome Rosé (40sqm romantic dome): $510/night, ideal for romantic getaways
- Lakeside Cottage: $295/night, great for families (pet-friendly)

We look forward to hosting you in beautiful Central Otago!

Warm regards,
Stephen & Sandy
Lakeside Retreat
+64-21-368-682`;
        } else if (emailLower.includes('price') || emailLower.includes('cost') || emailLower.includes('rate')) {
            suggestedReply = `Dear Guest,

Thank you for your enquiry about our rates at Lakeside Retreat.

Our current nightly rates are:
- Dome Pinot (50sqm luxury dome): $530 NZD - includes continental breakfast, private spa
- Dome Rosé (40sqm romantic dome): $510 NZD - includes continental breakfast, outdoor spa
- Lakeside Cottage: $295 NZD - full kitchen, wood-fired hot tub, direct lake access
  (Extra guest fee: $100, Pet fee: $25)

All rates include:
- Free WiFi and parking
- Access to our solar system tours
- Local winery recommendations
- Stephen & Sandy's personal hosting

A $350 security deposit (authorization hold only) is required and automatically released 48 hours after checkout.

Would you like to proceed with a booking? You can book directly at lakesideretreat.co.nz or reply to this email with your preferred dates.

Warm regards,
Stephen & Sandy
Lakeside Retreat`;
        } else if (emailLower.includes('cancel') || emailLower.includes('refund')) {
            suggestedReply = `Dear Guest,

Thank you for contacting us regarding your booking.

We understand that plans can change. Please provide your booking reference number and we'll be happy to discuss your options.

For urgent matters, please call us directly at +64-21-368-682.

Kind regards,
Stephen & Sandy
Lakeside Retreat`;
        } else if (emailLower.includes('direction') || emailLower.includes('location') || emailLower.includes('find')) {
            suggestedReply = `Dear Guest,

Thank you for your enquiry about our location.

Lakeside Retreat is located at:
96 Smiths Way, Mount Pisa
Cromwell, Central Otago 9310
New Zealand

We're positioned directly on Lake Dunstan in the heart of Central Otago wine country.

Distances:
- 45 minutes from Queenstown Airport
- 35 minutes from Wanaka
- 5 minutes from Cromwell town centre
- 300 metres from the Otago Rail Trail

We'll send detailed arrival instructions with GPS coordinates 48 hours before your check-in.

Looking forward to welcoming you!

Warm regards,
Stephen & Sandy
Lakeside Retreat`;
        } else {
            suggestedReply = `Dear Guest,

Thank you for contacting Lakeside Retreat.

We appreciate your message and will respond to your enquiry shortly.

In the meantime, you can find more information about our luxury glamping accommodation at lakesideretreat.co.nz, or feel free to call us at +64-21-368-682.

Warm regards,
Stephen & Sandy
Lakeside Retreat
96 Smiths Way, Mount Pisa, Cromwell
Central Otago, New Zealand`;
        }

        if (this.aiEnabled && process.env.OPENAI_API_KEY) {
            try {
                const enhancedReply = await this.enhanceEmailWithAI(emailContent, suggestedReply, context);
                return {
                    success: true,
                    suggestedReply: enhancedReply,
                    source: 'ai-enhanced',
                    originalTemplate: suggestedReply
                };
            } catch (error) {
                console.error('AI email enhancement failed:', error.message);
            }
        }

        return {
            success: true,
            suggestedReply: suggestedReply,
            source: 'template'
        };
    }

    async enhanceEmailWithAI(originalEmail, templateReply, context) {
        const prompt = `You are helping draft an email reply for Lakeside Retreat, a luxury glamping accommodation in Central Otago, New Zealand.

Original customer email:
"""
${originalEmail}
"""

Template reply:
"""
${templateReply}
"""

${context.guestName ? `Guest name: ${context.guestName}` : ''}
${context.bookingId ? `Booking ID: ${context.bookingId}` : ''}

Please enhance the template reply to:
1. Address any specific questions in the original email
2. Personalize the greeting if a name is available
3. Keep the professional, warm tone
4. Include all relevant information from the template
5. Keep it concise but helpful

Return only the enhanced email reply, nothing else.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 800,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    clearSession(sessionId) {
        this.conversationHistory.delete(sessionId);
        this.sessionLastActivity.delete(sessionId);
    }

    getSessionHistory(sessionId) {
        return this.conversationHistory.get(sessionId) || [];
    }
}

module.exports = ChatbotService;
