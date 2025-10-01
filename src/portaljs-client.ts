const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 300000;

function getCacheKey(endpoint: string, params?: any): string {
	const sortedParams = params ? JSON.stringify(params, Object.keys(params).sort()) : '{}';
	return `${endpoint}:${sortedParams}`;
}

function isCacheValid(timestamp: number): boolean {
	return Date.now() - timestamp < CACHE_TTL;
}

export interface StandardResponse {
	success: boolean;
	data?: any;
	error?: {
		type: string;
		message: string;
		tool?: string;
		arguments?: any;
	};
	metadata: {
		timestamp: string;
		execution_time_ms: number;
		api_version: string;
	};
}

export function createResponse(success: boolean, data?: any, error?: any): StandardResponse {
	return {
		success,
		data,
		error,
		metadata: {
			timestamp: new Date().toISOString(),
			execution_time_ms: 0,
			api_version: "2.0.0",
		},
	};
}

interface PortalJSResponse {
	success: boolean;
	result?: any;
	error?: any;
}

export class PortalJSAPIClient {
	public baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
	}

	private getHeaders(): Record<string, string> {
		return {
			"Content-Type": "application/json",
			"User-Agent": "MCP-PortalJS-Server/1.0",
		};
	}

	async makeRequest(method: string, endpoint: string, data?: any, useCache = true): Promise<any> {
		const cacheKey = getCacheKey(endpoint, data);

		if (useCache && method === "GET") {
			const cached = cache.get(cacheKey);
			if (cached && isCacheValid(cached.timestamp)) {
				return cached.data;
			}
		}

		const url = `${this.baseUrl}/api/3/action/${endpoint}`;
		const options: RequestInit = {
			method,
			headers: this.getHeaders(),
		};

		if (data && method !== "GET") {
			options.body = JSON.stringify(data);
		}

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`PortalJS API HTTP Error: ${response.status} ${response.statusText}`);
		}

		const result = await response.json() as PortalJSResponse;

		if (!result.success) {
			throw new Error(`PortalJS API Error: ${JSON.stringify(result.error)}`);
		}

		const resultData = result.result || {};

		if (useCache && method === "GET") {
			cache.set(cacheKey, {
				data: resultData,
				timestamp: Date.now(),
			});
		}

		return resultData;
	}

}