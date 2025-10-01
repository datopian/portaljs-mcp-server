import { PortalJSAPIClient, createResponse } from "./portaljs-client";

interface Env {
	API_URL?: string;
}

interface JsonRpcRequest {
	jsonrpc: string;
	id?: string | number | null;
	method: string;
	params?: any;
}

const MCP_TOOLS = [
	{
		name: "search",
		description: "Search for datasets in PortalJS",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query to find datasets"
				},
				limit: {
					type: "number",
					description: "Maximum number of results to return (default: 10)"
				}
			},
			required: ["query"]
		}
	},
	{
		name: "fetch",
		description: "Fetch detailed information about a specific dataset",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "ID or name of the dataset to fetch"
				}
			},
			required: ["id"]
		}
	}
];

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const portalUrl = env.API_URL || "https://api.cloud.portaljs.com";
		const portalClient = new PortalJSAPIClient(portalUrl);
		if (url.pathname === "/") {
			return new Response("PortalJS MCP Server - Use /sse for MCP connections", {
				status: 200,
				headers: corsHeaders
			});
		}

		if (url.pathname === "/sse") {
			if (request.method === "GET") {
				return new Response(null, {
					status: 200,
					headers: {
						...corsHeaders,
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						'Connection': 'keep-alive',
					}
				});
			}

			/*
			-----Explanation why we have the == "POST" bellow:
			1. MCP Protocol (requires POST)

			The /sse endpoint must accept POST because:
			- MCP/JSON-RPC protocol sends commands via POST requests
			- ChatGPT and Claude send POST requests with JSON-RPC payloads
			- Commands like tools/list, tools/call come as POST

			2. PortalJS API Calls (GET-only)

			All our calls to PortalJS API are GET:
			- handleSearch → GET request to package_search
			- handleFetch → GET request to package_show
			*/
			if (request.method === "POST") {
				try {
					const body = await request.json() as JsonRpcRequest;


					if (body.jsonrpc !== "2.0") {
						return new Response(JSON.stringify({
							jsonrpc: "2.0",
							id: body.id,
							error: {
								code: -32600,
								message: "Invalid Request: JSON-RPC version must be 2.0"
							}
						}), {
							status: 400,
							headers: { ...corsHeaders, 'Content-Type': 'application/json' }
						});
					}

					if (body.method === "notifications/initialized") {
						return new Response(null, {
							status: 200,
							headers: { ...corsHeaders, 'Content-Type': 'application/json' }
						});
					}

					if (body.method === "tools/list") {
						return new Response(JSON.stringify({
							jsonrpc: "2.0",
							id: body.id,
							result: { tools: MCP_TOOLS }
						}), {
							headers: { ...corsHeaders, 'Content-Type': 'application/json' }
						});
					}

					if (body.method === "tools/call") {
						const { name, arguments: args } = body.params;
						const startTime = Date.now();

						let result: any;

						switch (name) {
							case "search":
								result = await handleSearch(portalClient, args);
								break;
							case "fetch":
								result = await handleFetch(portalClient, args);
								break;
							default:
								return new Response(JSON.stringify({
									jsonrpc: "2.0",
									id: body.id,
									error: {
										code: -32601,
										message: `Unknown tool: ${name}`
									}
								}), {
									status: 404,
									headers: { ...corsHeaders, 'Content-Type': 'application/json' }
								});
						}

						const response = createResponse(true, result);
						response.metadata.execution_time_ms = Date.now() - startTime;

						return new Response(JSON.stringify({
							jsonrpc: "2.0",
							id: body.id,
							result: {
								content: [
									{
										type: "text",
										text: JSON.stringify(response, null, 2)
									}
								]
							}
						}), {
							headers: { ...corsHeaders, 'Content-Type': 'application/json' }
						});
					}

					if (body.method === "initialize") {
						return new Response(JSON.stringify({
							jsonrpc: "2.0",
							id: body.id,
							result: {
								protocolVersion: "2024-11-05",
								capabilities: {
									tools: {
										listChanged: true
									}
								},
								serverInfo: {
									name: "portaljs-mcp-server",
									version: "1.0.0"
								}
							}
						}), {
							headers: { ...corsHeaders, 'Content-Type': 'application/json' }
						});
					}


					return new Response(JSON.stringify({
						jsonrpc: "2.0",
						id: body.id,
						error: {
							code: -32601,
							message: `Method not found: ${body.method}`
						}
					}), {
						status: 404,
						headers: { ...corsHeaders, 'Content-Type': 'application/json' }
					});

				} catch (error) {
					return new Response(JSON.stringify({
						jsonrpc: "2.0",
						id: null,
						error: {
							code: -32603,
							message: `Internal error: ${(error as Error).message}`
						}
					}), {
						status: 500,
						headers: { ...corsHeaders, 'Content-Type': 'application/json' }
					});
				}
			}
		}

		return new Response("Not Found", {
			status: 404,
			headers: corsHeaders
		});
	},
};

function ensureArray(value: any): any[] {
	return Array.isArray(value) ? value : [];
}

async function handleSearch(portalClient: PortalJSAPIClient, args: any) {
	const searchQuery = args.query || "";
	const limit = args.limit || 10;

	const queryParams = [`q=${encodeURIComponent(searchQuery)}`, `rows=${limit}`];
	const datasets = await portalClient.makeRequest("GET", `package_search?${queryParams.join("&")}`);

	const results = datasets.results ? datasets.results.map((item: any) => ({
		id: item.id,
		name: item.name,
		title: item.title,
		description: item.notes,
		url: `${portalClient.baseUrl}/dataset/${item.name}`,
		organization: item.organization?.name,
		tags: item.tags?.map((tag: any) => tag.name),
		created: item.metadata_created,
		modified: item.metadata_modified,
	})) : [];

	return {
		query: searchQuery,
		total_results: results.length,
		results: results
	};
}

async function handleFetch(portalClient: PortalJSAPIClient, args: any) {
	const result = await portalClient.makeRequest("GET", `package_show?id=${args.id}`);

	if (!result || !result.id) {
		throw new Error(`Dataset not found: ${args.id}`);
	}

	if (!result.name) {
		throw new Error(`Invalid dataset data: missing name field for ${args.id}`);
	}

	return {
		id: result.id,
		name: result.name,
		title: result.title || null,
		description: result.notes || null,
		url: `${portalClient.baseUrl}/dataset/${result.name}`,
		organization: result.organization || null,
		tags: ensureArray(result.tags),
		resources: ensureArray(result.resources),
		groups: ensureArray(result.groups),
		created: result.metadata_created,
		modified: result.metadata_modified,
		license: result.license_title || null,
		maintainer: result.maintainer || null,
		author: result.author || null,
		state: result.state,
	};
}