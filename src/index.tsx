import { generateObject } from "ai";
import { Hono } from "hono";
import { html } from "hono/html";
import type { FC } from "hono/jsx";
import { marked } from "marked";
import { D1QB } from "workers-qb";
import { z } from "zod";
import type { Env } from "./bindings";
import { FOLLOWUP_QUESTIONS_PROMPT } from "./prompts";
import type { ResearchType } from "./types";
import { getModel } from "./utils";

export { ResearchWorkflow } from "./workflows";

const Layout: FC = (props) => {
	return (
		<html lang="en">
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<link
					rel="stylesheet"
					href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.2/css/bootstrap.min.css"
				/>
				<title>Research Dashboard</title>
			</head>
			<body>
				<div className="container py-4">{props.children}</div>
				<script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.2/js/bootstrap.bundle.min.js" />
			</body>
		</html>
	);
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
	const qb = new D1QB(c.env.DB);
	const researches = await qb
		.select<ResearchType>("researches")
		.orderBy("created_at desc")
		.all();

	return c.html(
		<Layout>
			<h1 className="mb-4">Researches</h1>

			<div className="table-responsive mb-4">
				<table className="table table-striped table-hover">
					<thead className="table-dark">
						<tr>
							<th>ID</th>
							<th>Query</th>
							<th>Depth</th>
							<th>Breadth</th>
							<th>Status</th>
							<th>Created At</th>
							<th>Actions</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{(researches.results as ResearchType[]).map((obj) => (
							<tr>
								<td>{obj.id}</td>
								<td>{obj.query}</td>
								<td>{obj.depth}</td>
								<td>{obj.breadth}</td>
								<td>
									<span
										className={`badge ${obj.status === 1 ? "bg-warning" : "bg-success"}`}
									>
										{obj.status === 1 ? "Running" : "Complete"}
									</span>
								</td>
								<td>{obj.created_at}</td>
								<td className="">
									<form action="/re-run" method="post">
										<input name="id" value={obj.id} type="hidden" />
										<button
											className="btn btn-outline-primary btn-sm"
											type="submit"
										>
											🔄
										</button>
									</form>
								</td>
								<td>
									{obj.status === 2 && (
										<a
											href={"/read/" + obj.id}
											className="btn btn-outline-success btn-sm"
										>
											Read
										</a>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<hr className="my-4" />

			<div className="card">
				<div className="card-header">
					<h5 className="card-title mb-0">Create New Research</h5>
				</div>
				<div className="card-body">
					<form action="/create" method="get">
						<div className="mb-3">
							<label htmlFor="query" className="form-label">
								Query:
							</label>
							<input name="query" className="form-control" required />
						</div>
						<div className="mb-3">
							<label htmlFor="depth" className="form-label">
								Depth:
							</label>
							<input
								value="3"
								name="depth"
								type="number"
								className="form-control"
								required
							/>
						</div>
						<div className="mb-3">
							<label htmlFor="breadth" className="form-label">
								Breadth:
							</label>
							<input
								value="4"
								name="breadth"
								type="number"
								className="form-control"
								required
							/>
						</div>
						<button type="submit" className="btn btn-primary">
							Continue with creation
						</button>
					</form>
				</div>
			</div>
		</Layout>,
	);
});

app.get("/create", async (c) => {
	const url = new URL(c.req.url);

	const obj = {
		query: url.searchParams.get("query") as string,
		depth: url.searchParams.get("depth") as string,
		breadth: url.searchParams.get("breadth") as string,
	};

	const { object } = await generateObject({
		model: getModel(c.env),
		messages: [
			{ role: "system", content: FOLLOWUP_QUESTIONS_PROMPT() },
			{
				role: "user",
				content: obj.query,
			},
		],
		schema: z.object({
			questions: z
				.string()
				.array()
				.describe(
					`Follow up questions to clarify the research direction, max of 5`,
				),
		}),
	});

	const questions = object.questions.slice(0, 5);

	return c.html(
		<Layout>
			<div className="card">
				<div className="card-header">
					<h5 className="card-title mb-0">New Research</h5>
				</div>
				<div className="card-body">
					<p className="card-text mb-4">
						Initial Query: <strong>{obj.query}</strong>
					</p>

					<form action="/create" method="post">
						<input name="query" value={obj.query} type="hidden" />
						<input name="breadth" value={obj.breadth} type="hidden" />
						<input name="depth" value={obj.depth} type="hidden" />

						{questions.map((obj) => (
							<div className="mb-3">
								<label for="answer" className="form-label">
									{obj}
								</label>
								<input name="question" value={obj} type="hidden" />
								<input name="answer" className="form-control" required />
							</div>
						))}

						<button type="submit" className="btn btn-primary">
							Create new Research
						</button>
					</form>
				</div>
			</div>
		</Layout>,
	);
});

app.post("/create", async (c) => {
	const id = crypto.randomUUID();
	const form = await c.req.formData();

	const questions = form.getAll("question") as string[];
	const answers = form.getAll("answer") as string[];

	const processedQuestions = questions.map((question, i) => ({
		question,
		answer: answers[i],
	}));

	const obj: ResearchType = {
		id,
		query: form.get("query") as string,
		depth: form.get("depth") as string,
		breadth: form.get("breadth") as string,
		questions: processedQuestions,
		status: 1,
	};

	await c.env.RESEARCH_WORKFLOW.create({
		id,
		params: obj,
	});

	const qb = new D1QB(c.env.DB);
	await qb
		.insert({
			tableName: "researches",
			data: {
				...obj,
				questions: JSON.stringify(obj.questions),
			},
		})
		.execute();

	return c.redirect("/");
});

app.post("/re-run", async (c) => {
	const form = await c.req.formData();

	const qb = new D1QB(c.env.DB);
	const resp = await qb
		.fetchOne<ResearchType>({
			tableName: "researches",
			where: {
				conditions: "id = ?",
				params: form.get("id") as string,
			},
		})
		.execute();

	if (!resp) {
		throw new Error("404");
	}

	const obj: ResearchType = {
		id: crypto.randomUUID(),
		query: resp.results.query,
		depth: resp.results.depth,
		breadth: resp.results.breadth,
		questions: JSON.parse(resp.results.questions as unknown as string),
		status: 1,
	};

	await c.env.RESEARCH_WORKFLOW.create({
		id: obj.id,
		params: obj,
	});

	await qb
		.insert({
			tableName: "researches",
			data: {
				...obj,
				questions: JSON.stringify(obj.questions),
			},
		})
		.execute();

	return c.redirect("/");
});

app.get("/read/:id", async (c) => {
	const id = c.req.param("id");

	const qb = new D1QB(c.env.DB);
	const resp = await qb
		.fetchOne<ResearchType>({
			tableName: "researches",
			where: {
				conditions: "id = ?",
				params: id,
			},
		})
		.execute();

	if (!resp || !resp.results.result) {
		throw new Error("404");
	}

	const content = resp.results.result
		.replaceAll("```markdown", "")
		.replaceAll("```", "");

	// @ts-ignore
	return c.html(<Layout>{html(marked.parse(content))}</Layout>);
});

export default app;
