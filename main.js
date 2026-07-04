import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();

function parseJsonEnv(name) {
    try {
        return JSON.parse(process.env[name]);
    } catch (err) {
        throw new Error(`Failed to parse ${name}: ${err.message}`, { cause: err });
    }
}

function loadProfile(profilePath) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    if (!profile.name) {
        throw new Error(`Profile ${profilePath} is missing required "name".`);
    }
    return profile;
}

function parsePortEnv(name) {
    const port = Number.parseInt(process.env[name], 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`${name} must be an integer TCP port between 1 and 65535.`);
    }
    return port;
}

function assertUniqueProfileNames(profiles) {
    const seen = new Set();
    for (const profile of profiles) {
        if (seen.has(profile.name)) {
            throw new Error(`Duplicate agent profile name "${profile.name}". Agent names must be unique.`);
        }
        seen.add(profile.name);
    }
}

async function main() {
    if (args.profiles) {
        settings.profiles = args.profiles;
    }
    if (args.task_path) {
        let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
        if (args.task_id) {
            settings.task = tasks[args.task_id];
            if (!settings.task) {
                throw new Error(`Task "${args.task_id}" was not found in ${args.task_path}.`);
            }
            settings.task.task_id = args.task_id;
        }
        else {
            throw new Error('task_id is required when task_path is provided');
        }
    }

    // these environment variables override certain settings
    if (process.env.MINECRAFT_PORT) {
        settings.port = parsePortEnv('MINECRAFT_PORT');
    }
    if (process.env.MINDSERVER_PORT) {
        settings.mindserver_port = parsePortEnv('MINDSERVER_PORT');
    }
    if (process.env.PROFILES) {
        const profiles = parseJsonEnv('PROFILES');
        if (!Array.isArray(profiles)) {
            throw new Error('PROFILES must be a JSON array of profile paths.');
        }
        if (profiles.length > 0) {
            settings.profiles = profiles;
        }
    }
    if (process.env.INSECURE_CODING) {
        settings.allow_insecure_coding = true;
    }
    if (process.env.BLOCKED_ACTIONS) {
        const blockedActions = parseJsonEnv('BLOCKED_ACTIONS');
        if (!Array.isArray(blockedActions)) {
            throw new Error('BLOCKED_ACTIONS must be a JSON array of command names.');
        }
        settings.blocked_actions = blockedActions;
    }
    if (process.env.MAX_MESSAGES) {
        settings.max_messages = Number.parseInt(process.env.MAX_MESSAGES, 10);
    }
    if (process.env.NUM_EXAMPLES) {
        settings.num_examples = Number.parseInt(process.env.NUM_EXAMPLES, 10);
    }
    if (process.env.LOG_ALL) {
        settings.log_all_prompts = process.env.LOG_ALL;
    }
    if (process.env.SETTINGS_JSON) {
        Object.assign(settings, parseJsonEnv('SETTINGS_JSON'));
    }

    const profiles = settings.profiles.map(loadProfile);
    assertUniqueProfileNames(profiles);

    await Mindcraft.init(Boolean(settings.host_public), settings.mindserver_port, settings.auto_open_ui);

    for (let profile of profiles) {
        settings.profile = profile;
        await Mindcraft.createAgent(settings);
    }
}

void main().catch((err) => {
    console.error(err.message);
    console.error(err.stack);
    process.exit(1);
});
