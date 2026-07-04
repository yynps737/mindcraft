import settings from '../settings.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const EventEmitter = require('events');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { setupRoutes } = require('prismarine-viewer/lib/common.js');
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView.js');

export function addBrowserViewer(bot, count_id) {
    if (settings.render_bot_view || settings.allow_vision) {
        return startBrowserViewer(bot, { port: 3000 + count_id, firstPerson: true });
    }
    return null;
}

function startBrowserViewer(bot, { viewDistance = 6, firstPerson = false, port = 3000, prefix = '' }) {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { path: prefix + '/socket.io' });

    setupRoutes(app, prefix);

    const sockets = [];
    const primitives = {};

    bot.viewer = new EventEmitter();
    bot.viewer.ready = new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
            console.log(`Prismarine viewer web server running on *:${port}`);
            resolve();
        });
    });

    bot.viewer.erase = (id) => {
        delete primitives[id];
        for (const socket of sockets) {
            socket.emit('primitive', { id });
        }
    };

    bot.viewer.drawBoxGrid = (id, start, end, color = 'aqua') => {
        primitives[id] = { type: 'boxgrid', id, start, end, color };
        for (const socket of sockets) {
            socket.emit('primitive', primitives[id]);
        }
    };

    bot.viewer.drawLine = (id, points, color = 0xff0000) => {
        primitives[id] = { type: 'line', id, points, color };
        for (const socket of sockets) {
            socket.emit('primitive', primitives[id]);
        }
    };

    bot.viewer.drawPoints = (id, points, color = 0xff0000, size = 5) => {
        primitives[id] = { type: 'points', id, points, color, size };
        for (const socket of sockets) {
            socket.emit('primitive', primitives[id]);
        }
    };

    io.on('connection', (socket) => {
        socket.emit('version', bot.version);
        sockets.push(socket);

        const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, socket);
        void worldView.init(bot.entity.position).catch((error) => {
            console.error('Failed to initialize prismarine world view:', error);
            socket.disconnect(true);
        });

        worldView.on('blockClicked', (block, face, button) => {
            bot.viewer.emit('blockClicked', block, face, button);
        });

        for (const id in primitives) {
            socket.emit('primitive', primitives[id]);
        }

        function botPosition() {
            const packet = { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true };
            if (firstPerson) {
                packet.pitch = bot.entity.pitch;
            }
            socket.emit('position', packet);
            void worldView.updatePosition(bot.entity.position).catch((error) => {
                console.error('Failed to update prismarine world view:', error);
                socket.disconnect(true);
            });
        }

        bot.on('move', botPosition);
        worldView.listenToBot(bot);
        socket.on('disconnect', () => {
            bot.removeListener('move', botPosition);
            worldView.removeListenersFromBot(bot);
            const socketIndex = sockets.indexOf(socket);
            if (socketIndex !== -1) {
                sockets.splice(socketIndex, 1);
            }
        });
    });

    bot.viewer.close = () => {
        io.close();
        server.close();
        for (const socket of sockets) {
            socket.disconnect(true);
        }
    };

    return bot.viewer;
}
