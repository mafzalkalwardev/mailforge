const axios = require('axios');

const MERGE_FIELDS = '{Name}, {Email}, {State}, {SENDER_NAME}, {SENDER_EMAIL}, {COMPANY_NAME}';

const SYSTEM_PROMPT = `You are an expert cold-email copywriter focused on deliverability and inbox placement.
Write professional B2B outreach that avoids spam triggers.

Rules:
- No ALL CAPS, excessive exclamation marks, or spam words (free, guarantee, act now, limited time, click here, buy now)
- Plain, conversational tone — short paragraphs, no HTML
- Personalize with merge fields: ${MERGE_FIELDS}
- Subject lines: 4-8 words, no misleading clickbait
- Body: 80-150 words, one clear soft CTA (reply or short call)
- Include {SENDER_NAME} and {COMPANY_NAME} in signature
- Return ONLY valid JSON, no markdown fences`;

function buildUserPrompt({ companyName, industry, goal, tone, count }) {
    return `Generate ${count || 3} email subject lines and ${count || 3} body variants for cold outreach.

Company: ${companyName || 'Your Company'}
Industry/niche: ${industry || 'general B2B'}
Goal: ${goal || 'start a conversation and book a call'}
Tone: ${tone || 'professional and friendly'}

Return JSON exactly like:
{"name":"Template name","subjectTemplates":["..."],"bodyTemplates":["..."]}

Each body must use merge fields where appropriate. Separate body variants should differ in opening hook.`;
}

function parseAiJson(text) {
    const trimmed = String(text || '').trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI did not return valid JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subjectTemplates?.length || !parsed.bodyTemplates?.length) {
        throw new Error('AI response missing subjectTemplates or bodyTemplates');
    }
    return {
        name: String(parsed.name || 'AI Generated Outreach').trim(),
        subjectTemplates: parsed.subjectTemplates.map(s => String(s).trim()).filter(Boolean),
        bodyTemplates: parsed.bodyTemplates.map(s => String(s).trim()).filter(Boolean),
        companyName: String(parsed.companyName || '').trim(),
    };
}

async function generateEmailTemplates(apiKey, options = {}) {
    if (!apiKey) {
        throw new Error(
            'OpenAI API key not configured. Add OPENAI_API_KEY to .env or Settings → AI Templates.'
        );
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const { data } = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model,
            temperature: 0.8,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildUserPrompt(options) },
            ],
        },
        {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        }
    );

    const content = data?.choices?.[0]?.message?.content;
    const result = parseAiJson(content);
    if (options.companyName && !result.companyName) {
        result.companyName = options.companyName;
    }
    return result;
}

module.exports = { generateEmailTemplates, MERGE_FIELDS };
