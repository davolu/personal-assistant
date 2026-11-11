import type { Proposal } from "./types";

/** A Composio action the host listed. No user OAuth is required to list these. */
export type CatalogAction = { slug: string; description?: string };

export type QuestionCard = {
  id: string;
  prompt: string;
  choices: string[];
  required: boolean;
  allowSkip: boolean;
};

export type MappedStep = {
  goal: string;
  tool: string;
  toolkit: string;
  app: string;
  connected: boolean;
};

export type PlanningState = {
  brief: string;
  kind: "video" | "apps" | "general";
  answers: Record<string, string>;
  status: "asking" | "ready" | "unsupported";
  question?: QuestionCard | null;
  proposal?: Proposal | null;
};

export type PlanningTurn = {
  state: PlanningState;
  reply: string;
  question: QuestionCard | null;
  proposal: Proposal | null;
};

const APP_NAMES: Record<string, string> = {
  heygen: "HeyGen",
  elevenlabs: "ElevenLabs",
  runway: "Runway",
  descript: "Descript",
  youtube: "YouTube",
  googledrive: "Google Drive",
};

export function advancePlanning(input: {
  brief: string;
  text: string;
  state: PlanningState | null;
  catalog: CatalogAction[];
  connections: { toolkit: string; status: string }[];
}): PlanningTurn {
  const brief = (input.state?.brief || input.brief || input.text).trim();
  const kind = input.state?.kind ?? detectKind(brief);
  const answers = { ...(input.state?.answers ?? {}) };
  if (input.state) recordAnswer(kind, answers, input.text, input.catalog);
  const state: PlanningState = { brief, kind, answers, status: "asking" };
  if (kind === "video") return videoTurn(state, input.catalog, input.connections);
  if (kind === "apps") return appsTurn(state, input.catalog, input.connections);
  return generalTurn(state, input.catalog, input.connections);
}

export function catalogSlugsFor(text: string): string[] {
  const slugs = ["heygen", "elevenlabs", "runway", "descript", "youtube", "googledrive"];
  const tokens = new Set(text.toLowerCase().split(/[^a-z0-9]+/));
  if (tokens.has("canvas") || tokens.has("canva")) slugs.push("canva", "canvas");
  if (tokens.has("notion")) slugs.push("notion");
  return [...new Set(slugs)];
}

function detectKind(brief: string): PlanningState["kind"] {
  if (/\b(canva|canvas|notion)\b/i.test(brief) && !/\bagent\b/i.test(brief)) return "apps";
  if (/\b(video|videos)\b/i.test(brief)) return "video";
  return "general";
}

function recordAnswer(kind: PlanningState["kind"], answers: Record<string, string>, text: string, catalog: CatalogAction[]) {
  const value = text.trim();
  if (!value || value === answers._brief) return;
  if (/^skip$/i.test(value)) {
    if (!answers.path && kind === "video") return;
    if (answers.path && !answers.destination) answers.destination = "skip";
    else if (!answers.path) answers.path = "skip";
    return;
  }
  if (kind === "apps" && !answers.app) {
    const picked = matchChoice(value, ["Canva", "Canvas LMS"]);
    if (picked) answers.app = picked;
    else if (/canvas lms/i.test(value)) answers.app = "Canvas LMS";
    else if (/\bcanva\b/i.test(value)) answers.app = "Canva";
    return;
  }
  if (kind === "video" && (!answers.path || answers.path === "no")) {
    const choices = videoChoices(catalog);
    const picked = matchChoice(value, choices.map((choice) => choice.label));
    if (picked) answers.path = picked;
    else if (/^(yes|yeah|yep|ok|okay)$/i.test(value) && choices[0]) answers.path = choices[0].label;
    else if (/^(no|stop|none)$/i.test(value)) answers.path = "no";
    else answers.path = value;
    return;
  }
  if (kind === "video" && !answers.destination) {
    answers.destination = value;
    return;
  }
  if (!answers.path) answers.path = value;
}

function videoTurn(state: PlanningState, catalog: CatalogAction[], connections: { toolkit: string; status: string }[]): PlanningTurn {
  const choices = videoChoices(catalog);
  if (choices.length === 0) {
    return {
      state: { ...state, status: "unsupported", question: null, proposal: null },
      reply: "Composio has no tool that makes a 5-minute video with characters, and the catalog I can see has no HeyGen, ElevenLabs, Runway, or Descript action. I can't plan that, and searching the web will not add a tool.",
      question: null,
      proposal: null,
    };
  }
  if (!state.answers.path || state.answers.path === "skip") {
    const prompt = videoQuestion(choices);
    return ask(state, { id: "path", prompt, choices: choices.map((choice) => choice.label), required: true, allowSkip: false });
  }
  if (state.answers.path === "no") {
    const prompt = `The closest supported version is still ${choices[0].label}. I can't make the full 5-minute character film. Want to go with that?`;
    return ask(state, { id: "path", prompt, choices: choices.map((choice) => choice.label), required: true, allowSkip: false });
  }
  const chosen = choices.find((choice) => choice.label === state.answers.path) ?? choices.find((choice) => state.answers.path.toLowerCase().includes(choice.label.toLowerCase()));
  if (!chosen) {
    const prompt = `That isn't a tool I can run. ${videoQuestion(choices)}`;
    return ask({ ...state, answers: { ...state.answers, path: "" } }, { id: "path", prompt, choices: choices.map((choice) => choice.label), required: true, allowSkip: false });
  }
  const uploads = uploadChoices(catalog);
  if (uploads.length > 0 && !state.answers.destination) {
    return ask(state, {
      id: "destination",
      prompt: "Where should the finished video go?",
      choices: [...uploads.map((item) => item.label), "Nowhere yet"],
      required: false,
      allowSkip: true,
    });
  }
  const steps = stepsFor(chosen, state.answers.destination, catalog, connections);
  const proposal = proposalFrom(state.brief, steps);
  return {
    state: { ...state, status: "ready", proposal, question: null },
    reply: "This plan only uses actions that exist in the Composio catalog. Say \"Looks good, go\" when you want me to start.",
    question: null,
    proposal,
  };
}

function appsTurn(state: PlanningState, catalog: CatalogAction[], connections: { toolkit: string; status: string }[]): PlanningTurn {
  const hasCanva = catalog.some((action) => toolkitOf(action.slug) === "canva");
  const hasLms = catalog.some((action) => toolkitOf(action.slug) === "canvas");
  const saidCanvas = /\bcanvas\b/i.test(state.brief);
  const saidCanva = /\bcanva\b/i.test(state.brief);
  if (!state.answers.app && saidCanvas && !saidCanva && hasCanva && hasLms) {
    return ask(state, {
      id: "app",
      prompt: "Did you mean Canva designs, or Canvas LMS?",
      choices: ["Canva", "Canvas LMS"],
      required: true,
      allowSkip: false,
    });
  }
  const app = state.answers.app || (saidCanva || hasCanva ? "Canva" : hasLms ? "Canvas LMS" : "");
  if (!app || (app === "Canva" && !hasCanva) || (app === "Canvas LMS" && !hasLms)) {
    return {
      state: { ...state, status: "unsupported", question: null, proposal: null },
      reply: "I don't see Canva or Canvas in the Composio catalog, so I can't read those designs. I won't search the web for what's in your account.",
      question: null,
      proposal: null,
    };
  }
  const read = rankActions(catalog, app === "Canvas LMS" ? "canvas" : "canva", "read");
  const write = /\bnotion\b/i.test(state.brief) ? rankActions(catalog, "notion", "create") : undefined;
  if (!read) {
    return {
      state: { ...state, status: "unsupported", question: null, proposal: null },
      reply: `${app} is in the catalog, but I don't see an action that lists your work. I won't look for it on the web.`,
      question: null,
      proposal: null,
    };
  }
  const steps: MappedStep[] = [
    {
      goal: app === "Canva" ? "List your Canva designs" : "List your Canvas courses",
      tool: read.slug,
      toolkit: toolkitOf(read.slug),
      app,
      connected: isConnected(connections, toolkitOf(read.slug)),
    },
  ];
  if (write) {
    steps.push({
      goal: "Add the summary to your Notion list",
      tool: write.slug,
      toolkit: "notion",
      app: "Notion",
      connected: isConnected(connections, "notion"),
    });
  } else if (/\bnotion\b/i.test(state.brief)) {
    return {
      state: { ...state, status: "unsupported", question: null, proposal: null },
      reply: "I can see the design app, but Notion has no create or update action in the catalog I checked. I can't invent that step.",
      question: null,
      proposal: null,
    };
  }
  const proposal = proposalFrom(state.brief, steps);
  const missing = steps.filter((step) => !step.connected).map((step) => step.app);
  const reply = missing.length
    ? `I can do this with ${steps.map((step) => step.app).join(" and ")} once ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} connected. I won't search the web for your account data.`
    : `I can read ${app} and write the summary to Notion.`;
  return { state: { ...state, answers: { ...state.answers, app }, status: "ready", proposal, question: null }, reply, question: null, proposal };
}

function generalTurn(state: PlanningState, catalog: CatalogAction[], connections: { toolkit: string; status: string }[]): PlanningTurn {
  const grouped = groupByToolkit(catalog).slice(0, 4);
  if (grouped.length === 0) {
    return {
      state: { ...state, status: "unsupported", question: null, proposal: null },
      reply: "Nothing in the Composio catalog matches that request. I can't invent a tool for it, and I won't search the web to discover one.",
      question: null,
      proposal: null,
    };
  }
  if (!state.answers.path || state.answers.path === "skip") {
    const labels = grouped.map((item) => item.app);
    return ask(state, {
      id: "path",
      prompt: `I can't do all of that with one tool. The closest apps in the catalog are ${labels.join(", ")}. Which should I use?`,
      choices: labels,
      required: true,
      allowSkip: false,
    });
  }
  const picked = grouped.find((item) => item.app.toLowerCase() === state.answers.path.toLowerCase()) ?? grouped[0];
  const steps: MappedStep[] = [
    {
      goal: `Use ${picked.app} for the part it can actually do`,
      tool: picked.slug,
      toolkit: picked.toolkit,
      app: picked.app,
      connected: isConnected(connections, picked.toolkit),
    },
  ];
  const proposal = proposalFrom(state.brief, steps);
  return {
    state: { ...state, status: "ready", proposal, question: null },
    reply: `I can do the ${picked.app} part. The rest is not in the catalog.`,
    question: null,
    proposal,
  };
}

function ask(state: PlanningState, question: QuestionCard): PlanningTurn {
  return {
    state: { ...state, status: "asking", question, proposal: null },
    reply: question.prompt,
    question,
    proposal: null,
  };
}

function videoQuestion(choices: { label: string }[]): string {
  const both = choices.find((choice) => /heygen/i.test(choice.label) && /elevenlabs/i.test(choice.label));
  if (both) {
    return "Composio has no tool that makes a 5-minute video with characters, but HeyGen can make an avatar video from your script and ElevenLabs can do the voiceover. Want to go with that?";
  }
  return `Composio has no tool that makes a 5-minute video with characters. The closest I can run is ${choices[0].label}. Want to go with that?`;
}

function videoChoices(catalog: CatalogAction[]): { label: string; tools: string[] }[] {
  const heygen = rankActions(catalog, "heygen", "create");
  const voice = rankActions(catalog, "elevenlabs", "voice");
  const runway = rankActions(catalog, "runway", "create");
  const descript = rankActions(catalog, "descript", "create");
  const choices: { label: string; tools: string[] }[] = [];
  if (heygen && voice) choices.push({ label: "HeyGen avatar and ElevenLabs voice", tools: [heygen.slug, voice.slug] });
  else if (heygen) choices.push({ label: "HeyGen avatar video", tools: [heygen.slug] });
  if (runway && !choices.some((choice) => choice.tools.includes(runway.slug))) choices.push({ label: "A short Runway clip", tools: [runway.slug] });
  if (descript) choices.push({ label: "Edit in Descript", tools: [descript.slug] });
  return choices;
}

function uploadChoices(catalog: CatalogAction[]): { label: string; slug: string; toolkit: string }[] {
  const youtube = rankActions(catalog, "youtube", "upload");
  const drive = rankActions(catalog, "googledrive", "upload");
  const choices = [];
  if (youtube) choices.push({ label: "YouTube", slug: youtube.slug, toolkit: "youtube" });
  if (drive) choices.push({ label: "Google Drive", slug: drive.slug, toolkit: "googledrive" });
  return choices;
}

function stepsFor(
  chosen: { label: string; tools: string[] },
  destination: string | undefined,
  catalog: CatalogAction[],
  connections: { toolkit: string; status: string }[]
): MappedStep[] {
  const steps: MappedStep[] = chosen.tools.map((slug) => {
    const toolkit = toolkitOf(slug);
    return {
      goal: goalFor(slug),
      tool: slug,
      toolkit,
      app: APP_NAMES[toolkit] ?? toolkit,
      connected: isConnected(connections, toolkit),
    };
  });
  const uploads = uploadChoices(catalog);
  const dest = uploads.find((item) => destination && item.label.toLowerCase() === destination.toLowerCase());
  if (dest) {
    steps.push({
      goal: `Upload the file to ${dest.label}`,
      tool: dest.slug,
      toolkit: dest.toolkit,
      app: dest.label,
      connected: isConnected(connections, dest.toolkit),
    });
  }
  return steps;
}

function goalFor(slug: string): string {
  if (slug.startsWith("HEYGEN_")) return "Create an avatar video from the script";
  if (slug.startsWith("ELEVENLABS_")) return "Make a voiceover from the script";
  if (slug.startsWith("RUNWAY_")) return "Generate a short clip";
  if (slug.startsWith("DESCRIPT_")) return "Edit the video from a prompt";
  if (slug.startsWith("YOUTUBE_")) return "Upload the video to YouTube";
  if (slug.startsWith("GOOGLEDRIVE_")) return "Upload the file to Google Drive";
  return `Run ${slug}`;
}

function proposalFrom(brief: string, steps: MappedStep[]): Proposal {
  return {
    understanding: brief.replace(/\s+/g, " ").trim().slice(0, 240),
    questions: [],
    steps: steps.map((step) => step.goal),
    mapped: steps,
    status: "proposed",
  };
}

export type ActionIntent = "create" | "read" | "upload" | "voice";

/** Prefer the action whose slug and description match the step, not the first loose hit. */
export function rankActions(actions: CatalogAction[], toolkit: string, intent: ActionIntent): CatalogAction | undefined {
  const hits = actions.filter((action) => toolkitOf(action.slug) === toolkit);
  let best: { action: CatalogAction; score: number } | undefined;
  for (const action of hits) {
    const slug = action.slug;
    const description = (action.description ?? "").toLowerCase();
    let score = 0;
    if (intent === "create" || intent === "voice") {
      if (/GENERATE|CREATE|CONVERT|TEXT_TO_SPEECH|TTS|TEMPLATE/.test(slug)) score += 40;
      if (intent === "voice" && /TEXT_TO_SPEECH|TTS|SPEECH|VOICE/.test(slug)) score += 50;
      if (intent === "create" && /TEMPLATE_GENERATE|GENERATE_VIDEO|CREATE_VIDEO|VIDEO_GENERATE|V2_TEMPLATE_GENERATE/.test(slug)) score += 35;
      if (/RETRIEVE|STATUS|LIST_|GET_|FETCH|DELETE|REMOVE|POLL|DETAIL/.test(slug)) score -= 60;
      if (/generat|create|avatar|voice|speech|convert/.test(description)) score += 15;
      if (/status|retrieve|delete|list /.test(description)) score -= 20;
    }
    if (intent === "read") {
      if (/LIST|FETCH|GET_|SEARCH|FIND/.test(slug)) score += 40;
      if (/SEND_|DRAFT|DELETE|CREATE/.test(slug)) score -= 30;
    }
    if (intent === "upload") {
      if (/UPLOAD/.test(slug)) score += 50;
      if (/DELETE|LIST/.test(slug)) score -= 20;
    }
    if (!best || score > best.score) best = { action, score };
  }
  return best?.action;
}

function groupByToolkit(catalog: CatalogAction[]): { toolkit: string; app: string; slug: string }[] {
  const seen = new Set<string>();
  const grouped = [];
  for (const action of catalog) {
    if (action.slug.startsWith("COMPOSIO_") || action.slug.startsWith("builtin.")) continue;
    const toolkit = toolkitOf(action.slug);
    if (!toolkit || seen.has(toolkit)) continue;
    seen.add(toolkit);
    grouped.push({ toolkit, app: APP_NAMES[toolkit] ?? toolkit, slug: action.slug });
  }
  return grouped;
}

function toolkitOf(slug: string): string {
  return slug.split("_")[0]?.toLowerCase() ?? "";
}

function matchChoice(text: string, choices: string[]): string | null {
  const wanted = text.trim().toLowerCase();
  return choices.find((choice) => choice.toLowerCase() === wanted) ?? null;
}

function isConnected(connections: { toolkit: string; status: string }[], toolkit: string): boolean {
  return connections.some((connection) => connection.status === "active" && connection.toolkit.toLowerCase().replace(/[\s_-]+/g, "") === toolkit.replace(/[\s_-]+/g, ""));
}

export function isWebSearchTool(name: string): boolean {
  return name === "builtin.web.search" || name.startsWith("COMPOSIO_SEARCH");
}
