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

const AI_PROVIDERS = {
    groq: {
        label: 'Groq (free tier)',
        baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
        defaultModel: 'llama-3.3-70b-versatile',
        envKey: 'GROQ_API_KEY',
    },
    openai: {
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-4o-mini',
        envKey: 'OPENAI_API_KEY',
    },
    openrouter: {
        label: 'OpenRouter (free models)',
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        defaultModel: 'google/gemma-2-9b-it:free',
        envKey: 'OPENROUTER_API_KEY',
    },
};

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

function resolveAiConfig(settings = {}) {
    const provider = String(settings.aiProvider || process.env.AI_PROVIDER || 'groq').toLowerCase();
    const def = AI_PROVIDERS[provider] || AI_PROVIDERS.groq;

    const keyByProvider = {
        groq: settings.groqApiKey || process.env.GROQ_API_KEY,
        openai: settings.openaiApiKey || process.env.OPENAI_API_KEY,
        openrouter: settings.openrouterApiKey || process.env.OPENROUTER_API_KEY,
    };

    const apiKey = keyByProvider[provider] || settings.openaiApiKey || process.env.OPENAI_API_KEY;
    const model =
        settings.aiModel ||
        process.env.AI_MODEL ||
        (provider === 'openai' ? process.env.OPENAI_MODEL : null) ||
        def.defaultModel;

    const baseUrl = settings.aiBaseUrl || def.baseUrl;

    return { provider, apiKey, model, baseUrl, label: def.label };
}

async function generateEmailTemplates(settings = {}, options = {}) {
    const { apiKey, model, baseUrl, provider, label } = resolveAiConfig(settings);

    if (!apiKey) {
        throw new Error(
            `No API key for ${label}. Add a key in Settings → AI & workflow, or set ` +
            `${AI_PROVIDERS[provider]?.envKey || 'GROQ_API_KEY'} in .env. ` +
            'Groq offers a free tier at console.groq.com.'
        );
    }

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
    if (provider === 'openrouter') {
        headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:5000';
        headers['X-Title'] = 'MailForge';
    }

    const { data } = await axios.post(
        baseUrl,
        {
            model,
            temperature: 0.8,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: buildUserPrompt(options) },
            ],
        },
        { headers, timeout: 90000 }
    );

    const content = data?.choices?.[0]?.message?.content;
    const result = parseAiJson(content);
    if (options.companyName && !result.companyName) {
        result.companyName = options.companyName;
    }
    return result;
}

module.exports = {
    generateEmailTemplates,
    resolveAiConfig,
    AI_PROVIDERS,
    MERGE_FIELDS,
};
