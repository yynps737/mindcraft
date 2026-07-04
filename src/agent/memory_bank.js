export class MemoryBank {
	constructor() {
		this.memory = {};
	}

	rememberPlace(name, x, y, z) {
		this.memory[name] = [x, y, z];
	}

	recallPlace(name) {
		return this.memory[name];
	}

	getJson() {
		return JSON.parse(JSON.stringify(this.memory));
	}

	loadJson(json) {
		if (json && typeof json === 'object' && !Array.isArray(json)) {
			this.memory = JSON.parse(JSON.stringify(json));
		}
		else {
			this.memory = {};
		}
	}

	getKeys() {
		return Object.keys(this.memory).join(', ');
	}
}
