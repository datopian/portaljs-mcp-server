import { PortalJSAPIClient, createResponse } from "./portaljs-client";

interface Env {
	PORTALJS_API_URL?: string;
	PORTALJS_API_KEY?: string;
	CORS_ALLOWED_ORIGIN?: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const allowedOrigin = env.CORS_ALLOWED_ORIGIN || '*';
		const corsHeaders = {
			'Access-Control-Allow-Origin': allowedOrigin,
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		const portalUrl = env.PORTALJS_API_URL || "https://api.cloud.portaljs.com";
		const apiKey = env.PORTALJS_API_KEY;
		const portalClient = new PortalJSAPIClient(portalUrl, apiKey);
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

			if (request.method === "POST") {
				try {
					const body = await request.json() as any;

					// Handle notifications/initialized first
					if (body.method === "notifications/initialized") {
						return new Response(null, {
							status: 200,
							headers: { ...corsHeaders, 'Content-Type': 'application/json' }
						});
					}

					if (body.method === "tools/list") {
						const tools = [
							{
								name: "search",
								description: "Search for datasets, organizations, and resources in PortalJS",
								inputSchema: {
									type: "object",
									properties: {
										query: {
											type: "string",
											description: "Search query to find datasets, organizations, or resources"
										},
										type: {
											type: "string",
											enum: ["datasets", "organizations", "groups", "resources", "all"],
											description: "Type of content to search for"
										},
										limit: {
											type: "number",
											description: "Maximum number of results to return"
										}
									},
									required: ["query"]
								}
							},
							{
								name: "fetch",
								description: "Fetch detailed information about a specific dataset, organization, or resource",
								inputSchema: {
									type: "object",
									properties: {
										id: {
											type: "string",
											description: "ID or name of the item to fetch"
										},
										type: {
											type: "string",
											enum: ["dataset", "organization", "group", "resource"],
											description: "Type of item to fetch (defaults to 'dataset' if not specified)"
										}
									},
									required: ["id"]
								}
							},
							{
								name: "portaljs_package_search",
								description: "Search for packages using PortalJS queries",
								inputSchema: {
									type: "object",
									properties: {
										q: { type: "string", description: "Search query" },
										fq: { type: "string", description: "Filter query" },
										sort: { type: "string", description: "Sort order" },
										rows: { type: "number", description: "Number of results" },
										start: { type: "number", description: "Offset for pagination" }
									}
								}
							}
						];

						return new Response(JSON.stringify({
							jsonrpc: "2.0",
							id: body.id,
							result: { tools }
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
							case "portaljs_package_search":
								result = await handlePackageSearch(portalClient, args);
								break;
							default:
								throw new Error(`Unknown tool: ${name}`);
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

async function handleSearch(portalClient: PortalJSAPIClient, args: any) {
	const searchQuery = args.query || "";
	const searchType = args.type || "all";
	const limit = args.limit || 10;

	let results: any[] = [];

	const datasetsLimit = searchType === "all" ? Math.ceil(limit / 2) : limit;
	const orgsLimit = searchType === "all" ? Math.floor(limit / 2) : limit;

	if (searchType === "datasets" || searchType === "all") {
		const datasets = await portalClient.makeRequest("GET", `package_search?q=${encodeURIComponent(searchQuery)}&rows=${datasetsLimit}`);
		if (datasets.results) {
			results = results.concat(
				datasets.results.map((item: any) => ({
					type: "dataset",
					id: item.id,
					name: item.name,
					title: item.title,
					description: item.notes,
					url: `${portalClient.baseUrl}/dataset/${item.name}`,
					metadata: {
						organization: item.organization?.name,
						tags: item.tags?.map((tag: any) => tag.name),
						created: item.metadata_created,
						modified: item.metadata_modified,
					}
				}))
			);
		}
	}

	if (searchType === "organizations" || searchType === "all") {
		const orgs = await portalClient.makeRequest("GET", "organization_list?all_fields=true");
		if (orgs) {
			const filteredOrgs = orgs.filter((org: any) =>
				org.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
				org.description?.toLowerCase().includes(searchQuery.toLowerCase())
			).slice(0, orgsLimit);

			results = results.concat(
				filteredOrgs.map((item: any) => ({
					type: "organization",
					id: item.id,
					name: item.name,
					title: item.display_name,
					description: item.description,
					url: `${portalClient.baseUrl}/organization/${item.name}`,
					metadata: {
						package_count: item.package_count,
						created: item.created,
					}
				}))
			);
		}
	}

	return {
		query: searchQuery,
		type: searchType,
		total_results: results.length,
		results: results
	};
}

async function handleFetch(portalClient: PortalJSAPIClient, args: any) {
	let result: any = null;
	let endpoint = "";

	const itemType = args.type || "dataset";

	switch (itemType) {
		case "dataset":
			endpoint = `package_show?id=${args.id}`;
			break;
		case "organization":
			endpoint = `organization_show?id=${args.id}&include_datasets=true`;
			break;
		case "group":
			endpoint = `group_show?id=${args.id}&include_datasets=true`;
			break;
		case "resource":
			endpoint = `resource_show?id=${args.id}`;
			break;
	}

	result = await portalClient.makeRequest("GET", endpoint);

	if (!result || !result.id) {
		throw new Error(`Item not found: ${args.id}`);
	}

	let formattedResult: any = {
		type: itemType,
		id: result.id,
		name: result.name,
		title: result.title || result.display_name,
		description: result.notes || result.description,
	};

	if (itemType === "dataset") {
		formattedResult = {
			...formattedResult,
			url: `${portalClient.baseUrl}/dataset/${result.name}`,
			organization: result.organization,
			tags: result.tags,
			resources: result.resources,
			groups: result.groups,
			metadata: {
				created: result.metadata_created,
				modified: result.metadata_modified,
				license: result.license_title,
				maintainer: result.maintainer,
				author: result.author,
				state: result.state,
			}
		};
	} else if (itemType === "organization") {
		formattedResult = {
			...formattedResult,
			url: `${portalClient.baseUrl}/organization/${result.name}`,
			image_url: result.image_url,
			package_count: result.package_count,
			packages: result.packages,
			metadata: {
				created: result.created,
				state: result.state,
				approval_status: result.approval_status,
			}
		};
	}

	return formattedResult;
}

async function handlePackageSearch(portalClient: PortalJSAPIClient, args: any) {
	const queryParams = [];
	if (args.q) queryParams.push(`q=${encodeURIComponent(args.q)}`);
	if (args.fq) queryParams.push(`fq=${encodeURIComponent(args.fq)}`);
	if (args.sort) queryParams.push(`sort=${encodeURIComponent(args.sort)}`);
	if (args.rows) queryParams.push(`rows=${args.rows}`);
	if (args.start) queryParams.push(`start=${args.start}`);

	const queryString = queryParams.length > 0 ? queryParams.join("&") : "q=*:*";
	return await portalClient.makeRequest("GET", `package_search?${queryString}`);
}