import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { getKey, hasKey } from '../utils/keys.js';
import { stringifyTurns } from '../utils/text.js';

const DEFAULT_PACKAGE = '@z_ai/mcp-server@0.1.4';
const DEFAULT_TOOL = 'analyze_image';
const DEFAULT_TIMEOUT_MS = 120000;

function getZaiCodingKeyName() {
    if (hasKey('ZAICODING_API_KEY')) {
        return 'ZAICODING_API_KEY';
    }
    if (hasKey('ZAI_CODING_API_KEY')) {
        return 'ZAI_CODING_API_KEY';
    }
    return 'ZAICODING_API_KEY';
}

function extractMcpText(result) {
    const content = result?.content || [];
    const text = content
        .map(item => item?.type === 'text' ? item.text : '')
        .filter(Boolean)
        .join('\n')
        .trim();
    if (!text) {
        throw new Error(`Z.ai Vision MCP returned no text content: ${JSON.stringify(result)}`);
    }
    return text;
}

function localMcpBin() {
    const binName = process.platform === 'win32' ? 'zai-mcp-server.cmd' : 'zai-mcp-server';
    return path.resolve(process.cwd(), 'node_modules', '.bin', binName);
}

export class ZAIVisionMCP {
    static get prefix() {
        return 'zaivisionmcp';
    }

    constructor(model_name, url, params) {
        this.model_name = model_name || 'glm-4.6v';
        this.params = params || {};
        this.toolName = this.params.tool || DEFAULT_TOOL;
        this.timeoutMs = this.params.timeout_ms || DEFAULT_TIMEOUT_MS;
        this.child = null;
        this.buffer = '';
        this.stderr = '';
        this.nextId = 1;
        this.pending = new Map();
        this.readyPromise = null;
        this.closed = false;
    }

    sendRequest() {
        throw new Error('Z.ai Vision MCP only supports image analysis; use another model for text generation.');
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer, imagePath) {
        if (!imagePath) {
            throw new Error('Z.ai Vision MCP requires a screenshot file path.');
        }
        await this._ensureReady();
        const prompt = this._buildPrompt(messages, systemMessage);
        const result = await this._request('tools/call', {
            name: this.toolName,
            arguments: {
                image_source: path.resolve(imagePath),
                prompt,
            },
        }, this.timeoutMs);
        if (result?.isError) {
            throw new Error(extractMcpText(result));
        }
        return extractMcpText(result);
    }

    embed() {
        throw new Error('Embeddings are not supported by Z.ai Vision MCP.');
    }

    close() {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Z.ai Vision MCP process closed.'));
        }
        this.pending.clear();
        if (this.child && !this.child.killed) {
            this.child.kill('SIGTERM');
        }
        this.child = null;
        this.readyPromise = null;
    }

    async _ensureReady() {
        if (this.readyPromise) {
            return await this.readyPromise;
        }
        this.readyPromise = this._start();
        return await this.readyPromise;
    }

    async _start() {
        this.closed = false;
        const { command, args } = this._serverCommand();
        this.child = spawn(command, args, {
            cwd: process.cwd(),
            env: {
                ...process.env,
                Z_AI_API_KEY: getKey(getZaiCodingKeyName()),
                Z_AI_MODE: process.env.Z_AI_MODE || 'ZAI',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.child.stdout.on('data', data => this._handleStdout(data));
        this.child.stderr.on('data', data => {
            this.stderr += data.toString();
            this.stderr = this.stderr.slice(-8000);
        });
        this.child.on('exit', (code, signal) => this._handleExit(code, signal));

        await this._request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mindcraft-zai-vision-mcp', version: '1.0.0' },
        }, 30000);
        this._notify('notifications/initialized', {});

        const tools = await this._request('tools/list', {}, 30000);
        const toolNames = new Set((tools?.tools || []).map(tool => tool.name));
        if (!toolNames.has(this.toolName)) {
            throw new Error(`Z.ai Vision MCP tool "${this.toolName}" was not found. Available tools: ${Array.from(toolNames).join(', ')}`);
        }
    }

    _serverCommand() {
        if (this.params.command) {
            return {
                command: this.params.command,
                args: Array.isArray(this.params.args) ? this.params.args : [],
            };
        }

        const bin = localMcpBin();
        if (existsSync(bin)) {
            return { command: bin, args: [] };
        }

        return { command: 'npx', args: ['-y', DEFAULT_PACKAGE] };
    }

    _buildPrompt(messages, systemMessage) {
        const recent = messages?.length ? stringifyTurns(messages.slice(-8)) : '';
        const parts = [
            systemMessage,
            'Analyze this Minecraft bot screenshot for immediate gameplay use.',
            'Focus on visible terrain, blocks, entities, obstacles, landmarks, and practical next actions.',
        ];
        if (recent) {
            parts.push(`Recent conversation context:\n${recent}`);
        }
        return parts.filter(Boolean).join('\n\n');
    }

    _request(method, params, timeoutMs) {
        if (!this.child || !this.child.stdin || this.child.killed) {
            throw new Error('Z.ai Vision MCP process is not running.');
        }
        const id = this.nextId++;
        const payload = { jsonrpc: '2.0', id, method, params };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Timed out waiting for Z.ai Vision MCP ${method}. stderr: ${this.stderr.slice(-1200)}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.child.stdin.write(JSON.stringify(payload) + '\n');
        });
    }

    _notify(method, params) {
        if (!this.child || !this.child.stdin || this.child.killed) {
            throw new Error('Z.ai Vision MCP process is not running.');
        }
        this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }

    _handleStdout(data) {
        this.buffer += data.toString();
        let idx;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx + 1);
            if (!line) continue;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                continue;
            }
            if (!msg.id || !this.pending.has(msg.id)) {
                continue;
            }
            const pending = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.error) {
                pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
                pending.resolve(msg.result);
            }
        }
    }

    _handleExit(code, signal) {
        if (this.closed) {
            return;
        }
        const error = new Error(`Z.ai Vision MCP exited unexpectedly. code=${code} signal=${signal} stderr=${this.stderr.slice(-1200)}`);
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
        this.child = null;
        this.readyPromise = null;
    }
}
