import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

function getZaiKeyName() {
    if (hasKey('ZAI_API_KEY')) {
        return 'ZAI_API_KEY';
    }
    if (hasKey('ZHIPU_API_KEY')) {
        return 'ZHIPU_API_KEY';
    }
    return 'ZAI_API_KEY';
}

function getZaiCodingKeyName() {
    if (hasKey('ZAICODING_API_KEY')) {
        return 'ZAICODING_API_KEY';
    }
    if (hasKey('ZAI_CODING_API_KEY')) {
        return 'ZAI_CODING_API_KEY';
    }
    return 'ZAICODING_API_KEY';
}

function extractText(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => part?.text || part?.content || '')
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    return content == null ? '' : String(content);
}

function cloneTextTurns(turns) {
    return turns.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : extractText(msg.content),
    }));
}

class ZAIBase {
    constructor(model_name, url, params, options) {
        this.model_name = model_name;
        this.params = params;
        this.default_model = options.defaultModel;
        this.provider_label = options.providerLabel;

        const config = {
            baseURL: url || process.env[options.baseURLEnv] || options.defaultBaseURL,
            apiKey: getKey(options.keyName),
        };

        this.openai = new OpenAIApi(config);
    }

    createPack(messages, stop_seq='***') {
        const pack = {
            model: this.model_name || this.default_model,
            messages,
            stream: false,
            ...(this.params || {}),
        };
        if (stop_seq) {
            pack.stop = Array.isArray(stop_seq) ? stop_seq : [stop_seq];
        }
        return pack;
    }

    async createCompletion(pack) {
        console.log(`Awaiting ${this.provider_label} api response...`);
        const completion = await this.openai.chat.completions.create(pack);
        if (completion.choices[0].finish_reason === 'length') {
            throw new Error('Context length exceeded');
        }
        console.log('Received.');
        return extractText(completion.choices[0].message.content);
    }

    async sendRequest(turns, systemMessage, stop_seq='***') {
        const messages = [
            {'role': 'system', 'content': systemMessage},
            ...strictFormat(cloneTextTurns(turns)),
        ];

        let res = null;
        try {
            res = await this.createCompletion(this.createPack(messages, stop_seq));
        }
        catch (err) {
            if ((err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            }
            console.log(err);
            res = 'My brain disconnected, try again.';
        }
        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const textMessages = strictFormat(cloneTextTurns(messages));
        const imageMessages = [
            {'role': 'system', 'content': systemMessage},
            ...textMessages,
        ];
        imageMessages.push({
            role: 'user',
            content: [
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
                    },
                },
                { type: 'text', text: systemMessage },
            ],
        });

        let res = null;
        try {
            res = await this.createCompletion(this.createPack(imageMessages, null));
        }
        catch (err) {
            if ((err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') && messages.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendVisionRequest(messages.slice(1), systemMessage, imageBuffer);
            }
            if (String(err.message || err).includes('image')) {
                console.log(err);
                return 'Vision is only supported by certain models.';
            }
            console.log(err);
            res = 'My brain disconnected, try again.';
        }
        return res;
    }

    async embed(text) {
        throw new Error(`Embeddings are not supported by the ${this.provider_label} provider.`);
    }
}

// General Z.ai pay-as-you-go API. This is separate from GLM Coding Plan keys.
export class ZAI extends ZAIBase {
    static prefix = 'zai';

    constructor(model_name, url, params) {
        super(model_name, url, params, {
            defaultBaseURL: 'https://api.z.ai/api/paas/v4',
            baseURLEnv: 'ZAI_BASE_URL',
            keyName: getZaiKeyName(),
            defaultModel: 'glm-5v-turbo',
            providerLabel: 'z.ai',
        });
    }
}

// GLM Coding Plan API. Coding Plan keys are not interchangeable with general Z.ai API keys.
export class ZAICoding extends ZAIBase {
    static prefix = 'zaicoding';

    constructor(model_name, url, params) {
        super(model_name, url, params, {
            defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4',
            baseURLEnv: 'ZAI_CODING_BASE_URL',
            keyName: getZaiCodingKeyName(),
            defaultModel: 'glm-5.2',
            providerLabel: 'z.ai coding plan',
        });
    }
}
