import type { ResearchType } from "./types";

export type Env = {
	RESEARCH_WORKFLOW: Workflow<ResearchType>;
	DB: D1Database;
	GOOGLE_API_KEY: string;
	FIRECRAWL_API_KEY: string;
};
