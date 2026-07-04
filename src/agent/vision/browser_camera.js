import { chromium } from 'playwright-core';
import fs from 'fs/promises';

const CHROMIUM_CANDIDATES = [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
].filter(Boolean);

export class BrowserCamera {
    constructor(bot, fp, viewerPort) {
        this.bot = bot;
        this.fp = fp;
        this.viewerPort = viewerPort;
        this.width = 800;
        this.height = 512;
        this.browser = null;
        this.page = null;
        this.pageErrors = [];
        this.ready = this._init();
    }

    async _init() {
        try {
            await this._ensureScreenshotDirectory();
            const executablePath = await this._findChromium();

            this.browser = await chromium.launch({
                executablePath,
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--enable-webgl',
                    '--ignore-gpu-blocklist',
                    '--use-gl=angle',
                    '--use-angle=swiftshader',
                ],
            });

            this.page = await this.browser.newPage({
                viewport: { width: this.width, height: this.height },
                deviceScaleFactor: 1,
            });
            this.page.on('pageerror', error => {
                this.pageErrors.push(error);
            });

            await this._openViewer();
            await this._waitForCanvas();
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    async _findChromium() {
        for (const executablePath of CHROMIUM_CANDIDATES) {
            try {
                await fs.access(executablePath);
                return executablePath;
            } catch {
                // Try the next candidate.
            }
        }
        throw new Error(`Chromium executable not found. Tried: ${CHROMIUM_CANDIDATES.join(', ')}`);
    }

    async _openViewer() {
        const url = `http://127.0.0.1:${this.viewerPort}`;
        let lastError = null;

        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 3000 });
                return;
            } catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        throw new Error(`Could not open prismarine viewer at ${url}: ${lastError?.message || lastError}`);
    }

    async _waitForCanvas() {
        await this.page.waitForSelector('canvas', { state: 'attached', timeout: 10000 });
        await this.page.waitForFunction(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
            return !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        }, { timeout: 10000 });
        await this.page.waitForTimeout(1500);
        this._throwPageErrors();
    }

    async capture() {
        await this.ready;
        this._throwPageErrors();
        await this.page.evaluate(() => new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        this._throwPageErrors();

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `screenshot_${timestamp}`;
        await this.page.screenshot({
            path: `${this.fp}/${filename}.jpg`,
            type: 'jpeg',
            quality: 95,
        });
        return filename;
    }

    _throwPageErrors() {
        if (this.pageErrors.length > 0) {
            const message = this.pageErrors.map(error => error.stack || error.message || String(error)).join('\n');
            throw new Error(`Vision browser page error:\n${message}`);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }

    async _ensureScreenshotDirectory() {
        await fs.mkdir(this.fp, { recursive: true });
    }
}
