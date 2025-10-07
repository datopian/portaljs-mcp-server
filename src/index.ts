import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Env {
	API_URL?: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "PortalJS MCP Server",
		version: "1.0.0",
	});

	private apiKey?: string;

	async init() {
		const apiUrl = this.props?.env?.API_URL || "https://api.cloud.portaljs.com";

		// Extract API key from custom header (example: http://mcp.portaljs.com/sse?apiKey=1234...)
		const apiKeyHeader = this.props?.request?.headers?.get?.("X-PortalJS-API-Key");
		if (apiKeyHeader) {
			this.apiKey = apiKeyHeader;
		}

		// Search tool
		this.server.tool(
			"search",
			"Search for datasets in PortalJS",
			{
				query: z.string().describe("Search query to find datasets"),
				limit: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)")
			},
			async ({ query, limit }) => {
				const endpoint = `${apiUrl}/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=${limit}`;

				const headers: Record<string, string> = {
					"Content-Type": "application/json",
					"User-Agent": "MCP-PortalJS-Server/1.0"
				};

				if (this.apiKey) {
					headers["Authorization"] = this.apiKey;
				}

				const response = await fetch(endpoint, {
					method: "GET",
					headers
				});

				if (!response.ok) {
					return {
						content: [{
							type: "text",
							text: `Error: API returned ${response.status} ${response.statusText}`
						}]
					};
				}

				const data = await response.json();

				if (!data.success) {
					return {
						content: [{
							type: "text",
							text: `Error: ${JSON.stringify(data.error)}`
						}]
					};
				}

				const results = data.result && data.result.results ? data.result.results.map((item: any) => ({
					id: item.id,
					name: item.name,
					title: item.title,
					description: item.notes,
					url: `${apiUrl}/dataset/${item.name}`,
					organization: item.organization?.name,
					tags: item.tags?.map((tag: any) => tag.name),
					created: item.metadata_created,
					modified: item.metadata_modified,
				})) : [];

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							query,
							total_results: results.length,
							results
						}, null, 2)
					}]
				};
			}
		);

		// Fetch tool
		this.server.tool(
			"fetch",
			"Fetch detailed information about a specific dataset",
			{
				id: z.string().describe("ID or name of the dataset to fetch")
			},
			async ({ id }) => {
				const endpoint = `${apiUrl}/api/3/action/package_show?id=${encodeURIComponent(id)}`;

				const headers: Record<string, string> = {
					"Content-Type": "application/json",
					"User-Agent": "MCP-PortalJS-Server/1.0"
				};

				if (this.apiKey) {
					headers["Authorization"] = this.apiKey;
				}

				const response = await fetch(endpoint, {
					method: "GET",
					headers
				});

				if (!response.ok) {
					return {
						content: [{
							type: "text",
							text: `Error: API returned ${response.status} ${response.statusText}`
						}]
					};
				}

				const data = await response.json();

				if (!data.success) {
					return {
						content: [{
							type: "text",
							text: `Error: ${JSON.stringify(data.error)}`
						}]
					};
				}

				if (!data.result) {
					return {
						content: [{
							type: "text",
							text: `Error: Missing result for request: ${id}`
						}]
					};
				}

				const result = data.result;

				if (!result.id) {
					return {
						content: [{
							type: "text",
							text: `Error: Dataset not found: ${id}`
						}]
					};
				}

				const dataset = {
					id: result.id,
					name: result.name,
					title: result.title || null,
					description: result.notes || null,
					url: `${apiUrl}/dataset/${result.name}`,
					organization: result.organization || null,
					tags: Array.isArray(result.tags) ? result.tags : [],
					resources: Array.isArray(result.resources) ? result.resources : [],
					groups: Array.isArray(result.groups) ? result.groups : [],
					created: result.metadata_created,
					modified: result.metadata_modified,
					license: result.license_title || null,
					maintainer: result.maintainer || null,
					author: result.author || null,
					state: result.state,
				};

				return {
					content: [{
						type: "text",
						text: JSON.stringify(dataset, null, 2)
					}]
				};
			}
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Inject API key from URL parameter as custom header if present
		const apiKey = url.searchParams.get("apiKey");
		const requestWithAuth = apiKey
			? new Request(request, {
					headers: new Headers({
						...Object.fromEntries(request.headers),
						"X-PortalJS-API-Key": apiKey,
					}),
			  })
			: request;

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(requestWithAuth, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(requestWithAuth, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
